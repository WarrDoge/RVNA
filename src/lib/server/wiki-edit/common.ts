import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { PageRef, WikiUserRef } from "../../shared/wiki/index.ts";
import { userAvatarSql } from "../avatars.ts";
import type { db } from "../db.ts";
import { HttpError } from "../http.ts";
import { users } from "../schema.ts";
import { pages, spaces } from "../schema-wiki.ts";

export { HttpError };

export type Executor = Pick<
	typeof db,
	"select" | "insert" | "update" | "delete" | "execute"
>;
export type PageRow = typeof pages.$inferSelect;
export type SpaceRow = typeof spaces.$inferSelect;

export function fail(
	status: number,
	message: string,
	details?: Record<string, unknown>,
): never {
	throw new HttpError(status, message, { details });
}

export function allow(ok: boolean, message = "Forbidden"): asserts ok {
	if (!ok) fail(403, message);
}

export const newSourceId = () => `fat:${randomUUID()}`;

export function pgCode(error: unknown): string | undefined {
	for (
		let cause = error as { code?: string; cause?: unknown } | undefined;
		cause;
	) {
		if (typeof cause.code === "string") return cause.code;
		cause = cause.cause as typeof cause;
	}
	return undefined;
}

/** A page id, or the source id the Confluence URLs carry. */
export const pageIdParams = z.object({ id: z.string().trim().min(1).max(255) });
/** The default JSON body limit is 1 MiB; routes that carry a whole document raise it to this. */
export const docBodyLimit = 32 * 1024 * 1024;

/** The wiki editor's own validation body: the first issue, with its dotted path. */
export function wikiValidationError(error: z.ZodError) {
	const first = error.issues[0];
	const where = first?.path.join(".");
	return {
		body: {
			error: where
				? `${where}: ${first?.message}`
				: (first?.message ?? "Invalid request"),
		},
	};
}

export const idParams = z.object({ id: z.uuid() });
export const keyParams = z.object({ key: z.string().min(1).max(255) });
export const titleSchema = z.string().trim().min(1).max(255);
export const docSchema = z.custom<Record<string, unknown>>(
	(value) =>
		typeof value === "object" && value !== null && !Array.isArray(value),
	"bodyDoc must be an object",
);
export const labelsSchema = z.array(z.string().max(255)).max(200);

export function normalizeLabels(labels: string[] | undefined): string[] {
	const names = (labels ?? [])
		.map((label) => label.trim().toLowerCase().replace(/\s+/g, "-"))
		.filter((label) => label !== "");
	return [...new Set(names)];
}

export function pageRef(page: PageRow, spaceKey: string): PageRef {
	return {
		id: page.id,
		spaceKey,
		title: page.title,
		parentId: page.parentId,
		status: page.status,
		version: page.versionNumber,
	};
}

export async function loadPage(
	ex: Executor,
	id: string,
): Promise<{ page: PageRow; space: SpaceRow }> {
	const [row] = await ex
		.select({ page: pages, space: spaces })
		.from(pages)
		.innerJoin(spaces, eq(spaces.id, pages.spaceId))
		.where(
			z.uuid().safeParse(id).success
				? eq(pages.id, id)
				: eq(pages.sourceId, id),
		)
		.limit(1);
	if (!row) fail(404, "Page not found");
	return row;
}

export async function loadSpace(ex: Executor, key: string): Promise<SpaceRow> {
	for (const candidate of new Set([key, key.toUpperCase()])) {
		const [space] = await ex
			.select()
			.from(spaces)
			.where(eq(spaces.key, candidate))
			.limit(1);
		if (space) return space;
	}
	return fail(404, "Space not found");
}

export async function loadUserRefs(
	ex: Executor,
	ids: (string | null)[],
): Promise<Map<string, WikiUserRef>> {
	const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
	if (wanted.length === 0) return new Map();
	const rows = await ex
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			avatarUrl: userAvatarSql(users.id),
		})
		.from(users)
		.where(inArray(users.id, wanted));
	return new Map(rows.map((row) => [row.id, row]));
}

export function assertCurrent(page: PageRow) {
	if (page.status === "trashed") fail(409, "Page is in the trash");
	if (page.status === "draft") fail(409, "Page is not published yet");
}
