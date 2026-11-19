import { randomBytes } from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import type { CurrentUser } from "../auth.ts";
import { db } from "../db.ts";
import { HttpError } from "../http.ts";
import {
	messengerLinkCodes,
	messengerUnknownSenders,
	users,
} from "../schema.ts";
import { messengerSettings } from "./config.ts";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const CODE_TTL_MS = 10 * 60 * 1000;
const UNKNOWN_NOTICE_MS = 60 * 60 * 1000;
const WRONG_CODE_LIMIT = 5;
const WRONG_CODE_WINDOW_MS = 10 * 60 * 1000;

// One process holds the worker lock and handles every chat message, so memory is enough.
const wrongCodes = new Map<string, number[]>();

function recentWrongCodes(matrixId: string, now: number) {
	const recent = (wrongCodes.get(matrixId) ?? []).filter(
		(at) => now - at < WRONG_CODE_WINDOW_MS,
	);
	if (recent.length === 0) wrongCodes.delete(matrixId);
	else wrongCodes.set(matrixId, recent);
	return recent;
}

function recordWrongCode(matrixId: string) {
	const now = Date.now();
	if (wrongCodes.size > 1000) {
		for (const id of [...wrongCodes.keys()]) recentWrongCodes(id, now);
	}
	wrongCodes.set(matrixId, [...recentWrongCodes(matrixId, now), now]);
}

export function generateLinkCode() {
	const bytes = randomBytes(CODE_LENGTH);
	return [...bytes]
		.map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length])
		.join("");
}

export async function messengerProfileInfo(actor: CurrentUser) {
	const settings = await messengerSettings();
	const [row] = await db
		.select({ matrixId: users.messengerMatrixId })
		.from(users)
		.where(eq(users.id, actor.id))
		.limit(1);
	return {
		linkedMatrixId: row?.matrixId ?? null,
		botMatrixId: settings.botMatrixId,
		serverName: settings.serverName,
		enabled: settings.enabled,
	};
}

export async function createMessengerLinkCode(actor: CurrentUser) {
	const settings = await messengerSettings();
	if (!settings.enabled || !settings.botMatrixId) {
		throw new HttpError(400, "Messenger is not connected");
	}
	const now = new Date();
	await db
		.update(messengerLinkCodes)
		.set({ usedAt: now })
		.where(
			and(
				eq(messengerLinkCodes.userId, actor.id),
				isNull(messengerLinkCodes.usedAt),
			),
		);
	const [row] = await db
		.insert(messengerLinkCodes)
		.values({
			userId: actor.id,
			code: generateLinkCode(),
			expiresAt: new Date(now.getTime() + CODE_TTL_MS),
		})
		.returning({
			code: messengerLinkCodes.code,
			expiresAt: messengerLinkCodes.expiresAt,
		});
	return {
		code: row.code,
		expiresAt: row.expiresAt.toISOString(),
		botMatrixId: settings.botMatrixId,
	};
}

export async function disconnectMessenger(actor: CurrentUser) {
	await db
		.update(users)
		.set({ messengerMatrixId: null, updatedAt: new Date() })
		.where(eq(users.id, actor.id));
	return messengerProfileInfo(actor);
}

export type LinkResult =
	| { ok: true; message: string; userId: string }
	| { ok: false; message: string };

/** One-time code from the profile, redeemed by the Matrix sender. */
export async function redeemMessengerLinkCode(
	matrixId: string,
	rawCode: string,
): Promise<LinkResult> {
	if (recentWrongCodes(matrixId, Date.now()).length >= WRONG_CODE_LIMIT) {
		return {
			ok: false,
			message: "Too many wrong codes. Try again in 10 minutes.",
		};
	}
	const wrong = (message: string): LinkResult => {
		recordWrongCode(matrixId);
		return { ok: false, message };
	};
	const code = rawCode.trim().toUpperCase();
	const [row] = await db
		.select({
			id: messengerLinkCodes.id,
			userId: messengerLinkCodes.userId,
			expiresAt: messengerLinkCodes.expiresAt,
			usedAt: messengerLinkCodes.usedAt,
			active: users.active,
			username: users.username,
		})
		.from(messengerLinkCodes)
		.innerJoin(users, eq(users.id, messengerLinkCodes.userId))
		.where(eq(messengerLinkCodes.code, code))
		.limit(1);
	if (!row) return wrong("That code is not valid.");
	if (row.usedAt) {
		return wrong(
			"That code has already been used. Generate a new one on your profile.",
		);
	}
	if (row.expiresAt.getTime() <= Date.now()) {
		return wrong("That code has expired. Generate a new one on your profile.");
	}
	if (!row.active) return wrong("That RVNA account is not active.");

	try {
		await db.transaction(async (tx) => {
			const [claimed] = await tx
				.update(messengerLinkCodes)
				.set({ usedAt: new Date() })
				.where(
					and(
						eq(messengerLinkCodes.id, row.id),
						isNull(messengerLinkCodes.usedAt),
					),
				)
				.returning({ id: messengerLinkCodes.id });
			if (!claimed) throw new Error("code already used");
			await tx
				.update(users)
				.set({ messengerMatrixId: matrixId, updatedAt: new Date() })
				.where(eq(users.id, row.userId));
		});
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { code?: string }).code === "23505"
		) {
			return {
				ok: false,
				message: "That Matrix id is already connected to another account.",
			};
		}
		if (error instanceof Error && error.message === "code already used") {
			return wrong(
				"That code has already been used. Generate a new one on your profile.",
			);
		}
		throw error;
	}
	return {
		ok: true,
		message: `Connected ${matrixId} to RVNA as ${row.username}.`,
		userId: row.userId,
	};
}

/** The unknown-sender notice is sent at most once per hour per Matrix id. */
export async function shouldSendUnknownNotice(matrixId: string) {
	const now = new Date();
	const cutoff = new Date(now.getTime() - UNKNOWN_NOTICE_MS);
	const [updated] = await db
		.update(messengerUnknownSenders)
		.set({ lastNoticeAt: now })
		.where(
			and(
				eq(messengerUnknownSenders.matrixId, matrixId),
				lt(messengerUnknownSenders.lastNoticeAt, cutoff),
			),
		)
		.returning({ matrixId: messengerUnknownSenders.matrixId });
	if (updated) return true;
	const [created] = await db
		.insert(messengerUnknownSenders)
		.values({ matrixId, lastNoticeAt: now })
		.onConflictDoNothing()
		.returning({ matrixId: messengerUnknownSenders.matrixId });
	if (created) return true;
	// A row may have been inserted between the update and the insert.
	const [retried] = await db
		.update(messengerUnknownSenders)
		.set({ lastNoticeAt: now })
		.where(
			and(
				eq(messengerUnknownSenders.matrixId, matrixId),
				lt(messengerUnknownSenders.lastNoticeAt, cutoff),
			),
		)
		.returning({ matrixId: messengerUnknownSenders.matrixId });
	return Boolean(retried);
}
