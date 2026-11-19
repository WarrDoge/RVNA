import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { error, fail, redirect } from "@sveltejs/kit";
import { isEditorEmpty } from "#lib/editor/editor-html.ts";
import {
	attachmentUploadLimits,
	MAX_UPLOAD_FILES,
	saveAttachmentUpload,
} from "#lib/server/attachments/service.ts";
import { HttpError } from "#lib/server/http.ts";
import { pageAction, pageLoad } from "#lib/server/http-svelte.ts";
import { formParams } from "#lib/server/servicedesk/schemas.ts";
import {
	createPortalRequest,
	portalRequestTypeForm,
} from "#lib/server/servicedesk/service.ts";
import { tooManyFiles, type UploadedForm } from "#lib/server/uploads.ts";
import type { Actions, PageServerLoad } from "./$types";

/** A native multipart post carries the chosen files; stage them like the upload endpoint. */
async function stageNativeFiles(files: File[]): Promise<UploadedForm> {
	const limits = attachmentUploadLimits();
	if (files.length > MAX_UPLOAD_FILES) {
		throw tooManyFiles(limits.tooManyFilesMessage);
	}
	await mkdir(limits.directory, { recursive: true });
	const staged: UploadedForm["files"] = [];
	let total = 0;
	try {
		for (const file of files) {
			if (file.size > limits.maxFileBytes) {
				throw new HttpError(
					413,
					limits.fileTooLargeMessage ?? "File is too large",
				);
			}
			total += file.size;
			if (total > limits.maxTotalBytes) {
				throw new HttpError(
					413,
					limits.totalTooLargeMessage ?? "Upload is too large",
				);
			}
			const path = join(limits.directory, `.upload-${randomUUID()}`);
			await writeFile(path, Buffer.from(await file.arrayBuffer()), {
				flag: "wx",
			});
			staged.push({
				field: "attachment",
				path,
				fileName: file.name,
				mimeType: file.type || "application/octet-stream",
				size: file.size,
			});
		}
	} catch (cause) {
		await Promise.all(
			staged.map((file) => unlink(file.path).catch(() => undefined)),
		);
		throw cause;
	}
	return { fields: {}, files: staged };
}

export const load = pageLoad(async (event, actor) => {
	event.depends("app:portal");
	if (!formParams.safeParse(event.params).success) {
		error(404, "Request type not found");
	}
	return {
		form: await portalRequestTypeForm(
			actor,
			event.params.id,
			event.params.requestTypeId,
		),
		portalId: event.params.id,
	};
}) satisfies PageServerLoad;

export const actions = {
	default: pageAction(async ({ event, form }, actor) => {
		if (!formParams.safeParse(event.params).success) {
			return fail(404, { error: "Request type not found" });
		}
		const data = await portalRequestTypeForm(
			actor,
			event.params.id,
			event.params.requestTypeId,
		);

		const headers = event.request.headers;
		const native =
			headers.get("x-sveltekit-action") !== "true" &&
			(headers.get("sec-fetch-mode") === "navigate" ||
				(headers.get("accept") ?? "").includes("text/html"));
		const nativeFiles = native
			? form
					.getAll("attachment")
					.filter(
						(value): value is File =>
							value instanceof File && value.name !== "",
					)
			: [];

		const values = new Map<string, string | string[]>();
		for (const field of data.fields) {
			if (field.hidden || field.fieldId === "attachment") continue;
			if (field.kind === "components" || field.kind === "array") {
				const selected = form
					.getAll(field.fieldId)
					.filter((value): value is string => typeof value === "string");
				if (selected.length > 0) values.set(field.fieldId, selected);
			} else {
				const value = form.get(field.fieldId);
				if (typeof value === "string") values.set(field.fieldId, value);
			}
		}

		const fields: Record<string, string | string[] | null> = {};
		let summary = "";
		let description: string | null = null;
		const attachmentCount =
			nativeFiles.length > 0
				? nativeFiles.length
				: Number(form.get("attachmentCount") ?? 0);

		for (const field of data.fields) {
			if (field.hidden) continue;
			if (field.fieldId === "attachment") {
				if (field.required && attachmentCount === 0) {
					return fail(400, { error: `${field.label} is required` });
				}
				continue;
			}
			const value = values.get(field.fieldId);

			if (field.fieldId === "summary") {
				summary = typeof value === "string" ? value.trim() : "";
				continue;
			}
			if (field.fieldId === "description") {
				const html = typeof value === "string" ? value : "";
				description = isEditorEmpty(html) ? null : html;
				if (description === null && field.required) {
					return fail(400, { error: `${field.label} is required` });
				}
				continue;
			}
			if (
				value === undefined ||
				(typeof value === "string" && value.trim() === "")
			) {
				if (field.required) {
					return fail(400, { error: `${field.label} is required` });
				}
				continue;
			}
			if (Array.isArray(value)) {
				if (value.length === 0) continue;
				fields[field.fieldId] = value;
				continue;
			}
			if (value.trim() === "") continue;
			if (field.kind === "datetime") {
				const date = new Date(value);
				if (Number.isNaN(date.getTime())) {
					return fail(400, {
						error: `${field.label} must be a date and time`,
					});
				}
				fields[field.fieldId] = date.toISOString();
				continue;
			}
			fields[field.fieldId] = value;
		}

		if (summary === "") return fail(400, { error: "Summary is required" });

		const created = await createPortalRequest(actor, event.params.id, {
			requestTypeId: event.params.requestTypeId,
			summary,
			description,
			fields,
			attachmentCount,
		});
		if (!native) return { created };

		let attachmentError: string | null = null;
		let attachmentNotice: number | null = null;
		if (nativeFiles.length > 0) {
			try {
				await saveAttachmentUpload(
					actor,
					created.key,
					await stageNativeFiles(nativeFiles),
				);
				attachmentNotice = nativeFiles.length;
			} catch (cause) {
				if (!(cause instanceof HttpError)) console.error(cause);
				attachmentError =
					cause instanceof HttpError
						? cause.message
						: "Could not upload the attachments";
			}
		}
		const query = new URLSearchParams();
		if (attachmentError) query.set("attachmentError", attachmentError);
		if (attachmentNotice)
			query.set("attachmentNotice", String(attachmentNotice));
		redirect(
			303,
			`/servicedesk/customer/portal/${event.params.id}/${created.key}${query.size > 0 ? `?${query}` : ""}`,
		);
	}),
} satisfies Actions;
