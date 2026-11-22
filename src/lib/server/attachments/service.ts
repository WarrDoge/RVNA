import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { maxAttachmentBytes, maxUploadRequestBytes } from "../attachments.ts";
import type { CurrentUser } from "../auth.ts";
import { userAvatarSql } from "../avatars.ts";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { HttpError } from "../http.ts";
import { recordIssueEvent } from "../notifications.ts";
import { requireIssuePermission } from "../projects/access.ts";
import { attachments, issues, users } from "../schema.ts";
import { canViewRequestIssue, isRequester } from "../servicedesk/access.ts";
import {
	tooManyFiles,
	type UploadedForm,
	type UploadLimits,
} from "../uploads.ts";

export const issueParams = z.object({ key: z.string().min(1).max(100) });
export const attachmentParams = z.object({ id: z.string().min(1) });

const inlineTypes = ["application/pdf", "text/plain"];
const activeTypes = [
	"text/html",
	"text/xml",
	"application/xml",
	"application/javascript",
	"application/x-javascript",
	"text/javascript",
	"text/xsl",
];

function baseType(mimeType: string | null) {
	return (mimeType ?? "application/octet-stream")
		.split(";")[0]
		?.trim()
		.toLowerCase();
}

function isInline(mimeType: string | null) {
	const type = baseType(mimeType);
	if (activeTypes.includes(type) || type.endsWith("+xml")) return false;
	return (
		type.startsWith("image/") ||
		type.startsWith("audio/") ||
		type.startsWith("video/") ||
		inlineTypes.includes(type)
	);
}

export function contentDisposition(
	kind: "inline" | "attachment",
	fileName: string,
) {
	const fallback = fileName
		.replace(/[^\x20-\x7e]/g, "_")
		.replace(/["\\]/g, "_");
	const encoded = encodeURIComponent(fileName).replace(
		/['()*]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
	);
	return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function safeFileName(value: string | undefined) {
	const name = [...basename((value ?? "attachment").replace(/\\/g, "/"))]
		.filter((character) => {
			const code = character.charCodeAt(0);
			return code > 31 && code !== 127;
		})
		.join("")
		.trim();
	return (name === "" ? "attachment" : name).slice(0, 255);
}

async function loadAttachment(id: string) {
	if (z.uuid().safeParse(id).success) {
		const [row] = await db
			.select()
			.from(attachments)
			.where(eq(attachments.id, id))
			.limit(1);
		if (row) return row;
	}

	const [row] = await db
		.select()
		.from(attachments)
		.where(eq(attachments.sourceId, id))
		.limit(1);
	return row ?? null;
}

function storageRoot() {
	return resolve(env.ATTACHMENTS_DIR);
}

function storagePathFor(root: string, sha256: string, id: string) {
	return join(root, sha256, id);
}

type Staged = {
	id: string;
	temporary: string;
	finalPath: string;
	sha256: string;
	fileName: string;
	mimeType: string;
	size: number;
};

export type AttachmentIssue = {
	id: string;
	key: string;
	summary: string;
	reporterId: string | null;
	assigneeId: string | null;
};

export async function hashFile(path: string) {
	const hash = createHash("sha256");
	await pipeline(createReadStream(path), hash);
	return hash.digest("hex");
}

export const MAX_UPLOAD_FILES = 20;

/** The attachment upload limits and the messages the endpoint has always answered with. */
export function attachmentUploadLimits(): UploadLimits {
	return {
		directory: storageRoot(),
		maxFileBytes: maxAttachmentBytes(),
		maxFiles: MAX_UPLOAD_FILES,
		maxTotalBytes: maxUploadRequestBytes(),
		fileTooLargeMessage: `Attachment is larger than ${env.MAX_ATTACHMENT_MB} MB`,
		totalTooLargeMessage: `Upload is larger than ${env.MAX_UPLOAD_REQUEST_MB} MB`,
		tooManyFilesMessage: "reach files limit",
	};
}

/** The issue and permission check that must run before the request body is read. */
export async function prepareAttachmentUpload(
	actor: CurrentUser,
	key: string,
): Promise<AttachmentIssue> {
	const [issue] = await db
		.select({
			id: issues.id,
			key: issues.key,
			summary: issues.summary,
			reporterId: issues.reporterId,
			assigneeId: issues.assigneeId,
		})
		.from(issues)
		.where(eq(issues.key, key.toUpperCase()))
		.limit(1);
	if (!issue) throw new HttpError(404, "Issue not found");
	if (!(await isRequester(actor, issue.id))) {
		await requireIssuePermission(actor, key, "CREATE_ATTACHMENTS");
	}
	return issue;
}

/**
 * Stores files that the shared upload helper has already written to temporary paths.
 * The permission check and the file cap are here, not in the caller.
 */
export async function saveAttachmentUpload(
	actor: CurrentUser,
	key: string,
	upload: UploadedForm,
) {
	const root = storageRoot();
	const staged: Staged[] = [];
	const moved: string[] = [];
	let created: (typeof attachments.$inferSelect)[];
	let issue: AttachmentIssue;

	try {
		issue = await prepareAttachmentUpload(actor, key);
		if (upload.files.length > MAX_UPLOAD_FILES) {
			throw tooManyFiles(attachmentUploadLimits().tooManyFilesMessage);
		}
		if (upload.files.length === 0) {
			throw new HttpError(400, "No files were uploaded");
		}
		for (const file of upload.files) {
			const id = randomUUID();
			const sha256 = await hashFile(file.path);
			staged.push({
				id,
				temporary: file.path,
				finalPath: storagePathFor(root, sha256, id),
				sha256,
				fileName: safeFileName(file.fileName),
				mimeType: file.mimeType,
				size: file.size,
			});
		}

		for (const item of staged) {
			await mkdir(join(root, item.sha256), { recursive: true });
			await rename(item.temporary, item.finalPath);
			moved.push(item.finalPath);
		}

		created = await db.transaction(async (tx) => {
			const now = new Date();
			const rows = await tx
				.insert(attachments)
				.values(
					staged.map((item) => ({
						sourceId: `local:${item.id}`,
						issueId: issue.id,
						fileName: item.fileName,
						mimeType: item.mimeType,
						size: item.size,
						authorId: actor.id,
						created: now,
						storagePath: join(item.sha256, item.id),
						sha256: item.sha256,
					})),
				)
				.returning();
			await tx
				.update(issues)
				.set({ updated: now })
				.where(eq(issues.id, issue.id));
			return rows;
		});
	} catch (error) {
		for (const file of upload.files) {
			await unlink(file.path).catch(() => undefined);
		}
		for (const path of moved) {
			await unlink(path).catch(() => undefined);
		}
		throw error;
	}

	for (const row of created) {
		await recordIssueEvent({
			issue,
			actor,
			kind: "attachment_added",
			attachmentName: row.fileName,
		});
	}

	const [author] = await db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			avatarUrl: userAvatarSql(users.id),
		})
		.from(users)
		.where(eq(users.id, actor.id))
		.limit(1);
	return created.map((row) => ({
		id: row.id,
		fileName: row.fileName,
		mimeType: row.mimeType,
		size: row.size,
		author: author ?? null,
		created: row.created?.toISOString() ?? null,
	}));
}

export async function attachmentDownload(actor: CurrentUser, id: string) {
	const row = await loadAttachment(id);
	if (!row) throw new HttpError(404, "Attachment not found");
	// A portal participant sees the request page, so the same check admits the download.
	if (!(await canViewRequestIssue(actor, row.issueId))) {
		await requireIssuePermission(actor, row.issueId, "BROWSE_PROJECTS");
	}

	const root = storageRoot();
	const filePath = resolve(root, row.storagePath);
	if (filePath !== root && !filePath.startsWith(root + sep)) {
		throw new HttpError(404, "Attachment not found");
	}

	let size: number;
	try {
		size = (await stat(filePath)).size;
	} catch {
		throw new HttpError(404, "Attachment file is missing");
	}

	return {
		filePath,
		size,
		mimeType: row.mimeType ?? "application/octet-stream",
		fileName: row.fileName,
		inline: isInline(row.mimeType),
	};
}

export async function deleteAttachment(actor: CurrentUser, id: string) {
	const row = await loadAttachment(id);
	if (!row) throw new HttpError(404, "Attachment not found");
	const permission =
		row.authorId === actor.id
			? "DELETE_OWN_ATTACHMENTS"
			: "DELETE_ALL_ATTACHMENTS";
	try {
		await requireIssuePermission(actor, row.issueId, permission);
	} catch (error) {
		if (
			row.authorId !== actor.id ||
			!(error instanceof HttpError) ||
			error.status !== 403
		) {
			throw error;
		}
		await requireIssuePermission(actor, row.issueId, "DELETE_ALL_ATTACHMENTS");
	}

	const now = new Date();
	await db.transaction(async (tx) => {
		await tx.delete(attachments).where(eq(attachments.id, row.id));
		await tx
			.update(issues)
			.set({ updated: now })
			.where(eq(issues.id, row.issueId));
	});

	const root = storageRoot();
	const filePath = resolve(root, row.storagePath);
	if (filePath.startsWith(root + sep)) {
		await unlink(filePath).catch(() => undefined);
	}
}
