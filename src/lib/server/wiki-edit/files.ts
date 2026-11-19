import { unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { inArray } from "drizzle-orm";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { pageAttachments } from "../schema-wiki.ts";

export const storageRoot = () => resolve(env.ATTACHMENTS_DIR);

/** Deletes stored files that no page attachment row refers to any more. */
export async function removeOrphanFiles(storagePaths: string[]) {
	const paths = [...new Set(storagePaths)];
	if (paths.length === 0) return;
	const stillUsed = await db
		.select({ path: pageAttachments.storagePath })
		.from(pageAttachments)
		.where(inArray(pageAttachments.storagePath, paths));
	const used = new Set(stillUsed.map((row) => row.path));
	const root = storageRoot();
	for (const path of paths) {
		if (used.has(path)) continue;
		const file = resolve(root, path);
		if (file.startsWith(root + sep)) await unlink(file).catch(() => undefined);
	}
}
