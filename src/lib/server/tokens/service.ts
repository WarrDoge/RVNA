import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { type CurrentUser, randomValue, sha256 } from "../auth.ts";
import { db } from "../db.ts";
import { HttpError } from "../http.ts";
import { recordAudit } from "../local-auth.ts";
import { apiTokens } from "../schema.ts";

export const tokenCreateSchema = z.object({
	name: z.string().trim().min(1).max(200),
	expiresInDays: z.number().int().positive().max(3650).optional(),
});

function tokenExpiresAt(expiresInDays: number | undefined) {
	return expiresInDays
		? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
		: null;
}

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
	const expiresAt = tokenExpiresAt(input.expiresInDays);

	const [row] = await db
		.insert(apiTokens)
		.values({
			userId: actor.id,
			name: input.name,
			tokenHash: sha256(value),
			expiresAt,
		})
		.returning();

	await recordAudit(db, {
		actorId: actor.id,
		actorName: actor.displayName,
		action: "token.create",
		entityType: "api_token",
		entityId: row.id,
		summary: `Created API token "${row.name}"`,
		changes: { to: { id: row.id, name: row.name } },
	});

	return { ...view(row), token: value };
}

export async function revokeToken(
	actor: CurrentUser,
	id: string,
): Promise<void> {
	const [deleted] = await db
		.delete(apiTokens)
		.where(and(eq(apiTokens.id, id), eq(apiTokens.userId, actor.id)))
		.returning({ id: apiTokens.id, name: apiTokens.name });
	if (!deleted) throw new HttpError(404, "Not found");

	await recordAudit(db, {
		actorId: actor.id,
		actorName: actor.displayName,
		action: "token.revoke",
		entityType: "api_token",
		entityId: deleted.id,
		summary: `Revoked API token "${deleted.name}"`,
		changes: { from: { id: deleted.id, name: deleted.name }, to: null },
	});
}
