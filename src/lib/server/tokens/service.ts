import { and, desc, eq } from "drizzle-orm";
import { type CurrentUser, randomValue, sha256 } from "../auth.ts";
import { db } from "../db.ts";
import { HttpError } from "../http.ts";
import { apiTokens } from "../schema.ts";

export type TokenView = {
	id: string;
	name: string;
	createdAt: string;
	lastUsedAt: string | null;
	expiresAt: string | null;
};

export type CreatedToken = TokenView & { token: string };

function view(row: typeof apiTokens.$inferSelect): TokenView {
	return {
		id: row.id,
		name: row.name,
		createdAt: row.createdAt.toISOString(),
		lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
		expiresAt: row.expiresAt?.toISOString() ?? null,
	};
}

export async function listTokens(actor: CurrentUser): Promise<TokenView[]> {
	const rows = await db
		.select()
		.from(apiTokens)
		.where(eq(apiTokens.userId, actor.id))
		.orderBy(desc(apiTokens.createdAt));
	return rows.map(view);
}

export async function createToken(
	actor: CurrentUser,
	input: { name: string; expiresInDays?: number },
): Promise<CreatedToken> {
	const value = `rvna_${randomValue()}`;
	const expiresAt = input.expiresInDays
		? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
		: null;

	const [row] = await db
		.insert(apiTokens)
		.values({
			userId: actor.id,
			name: input.name,
			tokenHash: sha256(value),
			expiresAt,
		})
		.returning();

	return { ...view(row), token: value };
}

export async function revokeToken(
	actor: CurrentUser,
	id: string,
): Promise<void> {
	const [deleted] = await db
		.delete(apiTokens)
		.where(and(eq(apiTokens.id, id), eq(apiTokens.userId, actor.id)))
		.returning({ id: apiTokens.id });
	if (!deleted) throw new HttpError(404, "Not found");
}
