import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { LockInfo } from "../../shared/wiki/index.ts";
import type { CurrentUser } from "../auth.ts";
import { userAvatarSql } from "../avatars.ts";
import { db } from "../db.ts";
import { users } from "../schema.ts";
import { pageLocks } from "../schema-wiki-edit.ts";
import { requireAccess } from "./access.ts";
import { type Executor, fail, loadPage } from "./common.ts";
import { lockPage } from "./content.ts";

/** The editor heartbeats every 30 seconds; keep that well below this lease. */
export const LOCK_SECONDS = 120;

export type LockState = { userId: string; live: boolean; info: LockInfo };

export async function lockState(
	ex: Executor,
	pageId: string,
): Promise<LockState | null> {
	const [row] = await ex
		.select({
			userId: pageLocks.userId,
			acquiredAt: pageLocks.acquiredAt,
			heartbeatAt: pageLocks.heartbeatAt,
			age: sql<number>`extract(epoch from now() - ${pageLocks.heartbeatAt})`.mapWith(
				Number,
			),
			username: users.username,
			displayName: users.displayName,
			avatarUrl: userAvatarSql(users.id),
		})
		.from(pageLocks)
		.innerJoin(users, eq(users.id, pageLocks.userId))
		.where(eq(pageLocks.pageId, pageId))
		.limit(1);
	if (!row) return null;
	return {
		userId: row.userId,
		live: row.age < LOCK_SECONDS,
		info: {
			holder: {
				id: row.userId,
				username: row.username,
				displayName: row.displayName,
				avatarUrl: row.avatarUrl,
			},
			acquiredAt: row.acquiredAt.toISOString(),
			heartbeatAt: row.heartbeatAt.toISOString(),
			expiresIn: Math.max(0, Math.ceil(LOCK_SECONDS - row.age)),
		},
	};
}

/** Throws 423 when another user holds a live lock on the page. */
export async function assertNotLockedByOthers(
	ex: Executor,
	pageId: string,
	userId: string,
) {
	const state = await lockState(ex, pageId);
	if (state?.live && state.userId !== userId) {
		fail(423, `${state.info.holder.displayName} is editing this page`, {
			lock: state.info,
		});
	}
}

async function claim(
	tx: Executor,
	pageId: string,
	userId: string,
	previous: LockState | null,
) {
	const takenOver = previous?.live && previous.userId !== userId;
	const values = {
		userId,
		acquiredAt: sql`now()`,
		heartbeatAt: sql`now()`,
		takenOverFrom: takenOver ? previous.userId : null,
		takenOverAt: takenOver ? sql`now()` : null,
	};
	await tx
		.insert(pageLocks)
		.values({ pageId, ...values })
		.onConflictDoUpdate({ target: pageLocks.pageId, set: values });
}

export const lockBody = z
	.object({ takeOver: z.boolean().optional() })
	.nullish();

async function readableLockPage(
	actor: CurrentUser,
	id: string,
	need: "read" | "edit" = "read",
) {
	const { page } = await loadPage(db, id);
	if (page.status === "trashed") fail(404, "Page not found");
	const access = await requireAccess(actor, page, need);
	return { page, access };
}

export async function acquireLock(
	actor: CurrentUser,
	id: string,
	input: z.infer<typeof lockBody>,
) {
	const { page } = await readableLockPage(actor, id, "edit");
	const takeOver = input?.takeOver === true;

	const outcome = await db.transaction(async (tx) => {
		const fresh = await lockPage(tx, page.id);
		if (fresh.status === "trashed") fail(404, "Page not found");
		const state = await lockState(tx, page.id);
		if (state?.live && state.userId !== actor.id && !takeOver) {
			return { acquired: false as const, lock: state.info };
		}
		if (state?.live && state.userId === actor.id) {
			await tx
				.update(pageLocks)
				.set({ heartbeatAt: sql`now()` })
				.where(eq(pageLocks.pageId, page.id));
		} else {
			await claim(tx, page.id, actor.id, state);
		}
		return {
			acquired: true as const,
			lock: (await lockState(tx, page.id))?.info ?? null,
		};
	});
	if (!outcome.acquired) {
		fail(409, "Someone else is editing this page", outcome);
	}
	return outcome;
}

export async function heartbeatLock(actor: CurrentUser, id: string) {
	const { page, access } = await readableLockPage(actor, id);

	return db.transaction(async (tx) => {
		const fresh = await lockPage(tx, page.id);
		if (fresh.status === "trashed") fail(404, "Page not found");
		const state = await lockState(tx, page.id);
		if (state?.live && state.userId !== actor.id) {
			return { status: "lost" as const, lock: state.info };
		}
		if (!access.edit) {
			return { status: "expired" as const, lock: null };
		}
		if (state?.userId === actor.id && state.live) {
			await tx
				.update(pageLocks)
				.set({ heartbeatAt: sql`now()` })
				.where(eq(pageLocks.pageId, page.id));
		} else {
			await claim(tx, page.id, actor.id, state);
		}
		return {
			status: "ok" as const,
			lock: (await lockState(tx, page.id))?.info ?? null,
		};
	});
}

export async function releaseLock(actor: CurrentUser, id: string) {
	await readableLockPage(actor, id);
	await db
		.delete(pageLocks)
		.where(and(eq(pageLocks.pageId, id), eq(pageLocks.userId, actor.id)));
}
