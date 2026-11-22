import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { storageToDoc } from "../../shared/wiki/index.ts";
import { resolveDocRefs } from "../../shared/wiki/refs.ts";
import { db, pool, runMigrations } from "../db.ts";
import { pageAttachments, pages, pageVersions, spaces } from "../schema.ts";

const unknown = new Map<string, number>();
const report = { unknown };

const spaceKeyById = new Map<string, string>();
const pageIdByTitle = new Map<string, string>();
const attachmentIdByFile = new Map<string, string>();
const pageById = new Map<string, { spaceKey: string; title: string }>();

const lookupKey = (...parts: string[]) => parts.join("\u0000");

async function loadLookups() {
	for (const space of await db.select().from(spaces)) {
		spaceKeyById.set(space.id, space.key);
	}
	for (const page of await db
		.select({
			id: pages.id,
			spaceId: pages.spaceId,
			title: pages.title,
			status: pages.status,
		})
		.from(pages)) {
		const spaceKey = spaceKeyById.get(page.spaceId) ?? "";
		pageById.set(page.id, { spaceKey, title: page.title });
		if (page.status === "current") {
			pageIdByTitle.set(lookupKey(spaceKey, page.title), page.id);
		}
	}
	for (const file of await db
		.select({
			id: pageAttachments.id,
			pageId: pageAttachments.pageId,
			fileName: pageAttachments.fileName,
			version: pageAttachments.version,
		})
		.from(pageAttachments)
		.orderBy(pageAttachments.version)) {
		attachmentIdByFile.set(lookupKey(file.pageId, file.fileName), file.id);
	}
}

function convert(storage: string, pageId: string) {
	const here = pageById.get(pageId);
	const doc = storageToDoc(storage, report);
	return resolveDocRefs(doc, {
		defaultSpaceKey: here?.spaceKey,
		pageHref: (ref) => {
			const id = pageIdByTitle.get(
				lookupKey(ref.spaceKey ?? here?.spaceKey ?? "", ref.title),
			);
			return id ? `/pages/viewpage.action?pageId=${id}` : null;
		},
		attachmentHref: (ref) => {
			let owner: string | undefined = pageId;
			if (ref.title) {
				owner = pageIdByTitle.get(
					lookupKey(ref.spaceKey ?? here?.spaceKey ?? "", ref.title),
				);
			}
			const id =
				owner && attachmentIdByFile.get(lookupKey(owner, ref.fileName));
			return id ? `/api/wiki/attachments/${id}` : null;
		},
	});
}

async function main() {
	await runMigrations();
	await loadLookups();
	let pageCount = 0;
	let versionCount = 0;
	let failed = 0;

	const pageRows = await db
		.select({ id: pages.id, storage: pages.bodyStorage })
		.from(pages)
		.where(and(isNotNull(pages.bodyStorage), isNull(pages.bodyDoc)));
	for (const row of pageRows) {
		try {
			const doc = convert(row.storage ?? "", row.id);
			await db.update(pages).set({ bodyDoc: doc }).where(eq(pages.id, row.id));
			pageCount++;
		} catch {
			failed++;
		}
	}

	const versionIds = await db
		.select({ id: pageVersions.id })
		.from(pageVersions)
		.where(
			and(isNotNull(pageVersions.bodyStorage), isNull(pageVersions.bodyDoc)),
		);
	for (const { id } of versionIds) {
		const [row] = await db
			.select({
				pageId: pageVersions.pageId,
				storage: pageVersions.bodyStorage,
			})
			.from(pageVersions)
			.where(eq(pageVersions.id, id));
		if (!row) continue;
		try {
			const doc = convert(row.storage ?? "", row.pageId);
			await db
				.update(pageVersions)
				.set({ bodyDoc: doc })
				.where(eq(pageVersions.id, id));
			versionCount++;
		} catch {
			failed++;
		}
	}

	console.log(
		`converted ${pageCount} pages and ${versionCount} versions, ${failed} failed`,
	);
	if (unknown.size === 0) {
		console.log("unknown elements and macros: none");
	} else {
		console.log("unknown elements and macros (name: count):");
		for (const [name, count] of [...unknown].sort((a, b) => b[1] - a[1])) {
			console.log(`  ${name}: ${count}`);
		}
	}
	await pool.end();
	if (failed > 0) process.exitCode = 1;
}

await main();
