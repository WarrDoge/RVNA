import { rmdir, unlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { inArray } from "drizzle-orm";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { pageAttachments } from "../schema-wiki.ts";

const storageRoot = () => resolve(env.ATTACHMENTS_DIR);
const QUERY_CHUNK = 500;

/** Deletes stored files that no page attachment row refers to any more. */
export async function removeOrphanFiles(storagePaths: string[]) {
	const paths = [...new Set(storagePaths)];
	if (paths.length === 0) return;
	const stillUsed: { path: string }[] = [];
	try {
		for (let index = 0; index < paths.length; index += QUERY_CHUNK) {
			const chunk = paths.slice(index, index + QUERY_CHUNK);
			stillUsed.push(
				...(await db
					.select({ path: pageAttachments.storagePath })
					.from(pageAttachments)
					.where(inArray(pageAttachments.storagePath, chunk))),
			);
		}
	} catch (error) {
		console.error(
			"wiki attachments: could not check for referenced files",
			error,
		);
		return;
	}
	const used = new Set(stillUsed.map((row) => row.path));
	const root = storageRoot();
	const directories = new Set<string>();
	for (const path of paths) {
		if (used.has(path)) continue;
		const file = resolve(root, path);
		if (!file.startsWith(root + sep)) continue;
		directories.add(dirname(file));
		try {
			await unlink(file);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				console.error(
					"wiki attachments: could not remove orphan file",
					path,
					error,
				);
			}
		}
	}
	for (const directory of directories) {
		await rmdir(directory).catch(() => undefined);
	}
}
