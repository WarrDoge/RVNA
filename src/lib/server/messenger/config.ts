import { eq } from "drizzle-orm";
import { db } from "../db.ts";
import { messengerConfig } from "../schema.ts";
import { decryptSecret, encryptSecret } from "./crypto.ts";

export interface MessengerSettings {
	homeserverUrl: string;
	accessToken: string | null;
	serviceDeskId: string | null;
	requestTypeId: string | null;
	enabled: boolean;
	sinceToken: string | null;
	botMatrixId: string | null;
	serverName: string | null;
	lastSyncAt: Date | null;
	lastError: string | null;
}

export interface MessengerIdentity {
	userId: string;
	serverName: string;
}

export function matrixIdParts(matrixId: string) {
	const match = /^@([^:]+):(.+)$/.exec(matrixId);
	if (!match) return null;
	return { localpart: match[1], serverName: match[2] };
}

export function matrixServerName(matrixId: string) {
	return matrixIdParts(matrixId)?.serverName ?? null;
}

async function ensureRow() {
	const [row] = await db
		.select()
		.from(messengerConfig)
		.where(eq(messengerConfig.id, 1))
		.limit(1);
	if (row) return row;

	const [created] = await db
		.insert(messengerConfig)
		.values({ id: 1 })
		.onConflictDoNothing()
		.returning();
	if (created) return created;

	const [existing] = await db
		.select()
		.from(messengerConfig)
		.where(eq(messengerConfig.id, 1))
		.limit(1);
	return existing;
}

function decode(value: string | null): string | null {
	if (!value) return null;
	try {
		return decryptSecret(value);
	} catch {
		return null;
	}
}

export async function messengerSettings(): Promise<MessengerSettings> {
	const row = await ensureRow();
	return {
		homeserverUrl: row.homeserverUrl,
		accessToken: decode(row.accessToken),
		serviceDeskId: row.serviceDeskId,
		requestTypeId: row.requestTypeId,
		enabled: row.enabled,
		sinceToken: row.sinceToken,
		botMatrixId: row.botMatrixId,
		serverName: row.serverName,
		lastSyncAt: row.lastSyncAt,
		lastError: row.lastError,
	};
}

export async function saveMessengerSettings(input: {
	homeserverUrl: string;
	serviceDeskId: string | null;
	requestTypeId: string | null;
	enabled: boolean;
}) {
	await ensureRow();
	await db
		.update(messengerConfig)
		.set({
			homeserverUrl: input.homeserverUrl.replace(/\/+$/, ""),
			serviceDeskId: input.serviceDeskId,
			requestTypeId: input.requestTypeId,
			enabled: input.enabled,
			updatedAt: new Date(),
		})
		.where(eq(messengerConfig.id, 1));
}

export async function saveMessengerToken(token: string) {
	await ensureRow();
	await db
		.update(messengerConfig)
		.set({ accessToken: encryptSecret(token), updatedAt: new Date() })
		.where(eq(messengerConfig.id, 1));
}

export async function clearMessengerToken() {
	await ensureRow();
	await db
		.update(messengerConfig)
		.set({ accessToken: null, updatedAt: new Date() })
		.where(eq(messengerConfig.id, 1));
}

export async function saveMessengerIdentity(identity: MessengerIdentity) {
	await ensureRow();
	await db
		.update(messengerConfig)
		.set({
			botMatrixId: identity.userId,
			serverName: identity.serverName,
			updatedAt: new Date(),
		})
		.where(eq(messengerConfig.id, 1));
}

export async function saveMessengerSinceToken(token: string) {
	await ensureRow();
	await db
		.update(messengerConfig)
		.set({ sinceToken: token, updatedAt: new Date() })
		.where(eq(messengerConfig.id, 1));
}

export async function recordMessengerSync(at: Date, clearError = true) {
	await ensureRow();
	await db
		.update(messengerConfig)
		.set({
			lastSyncAt: at,
			updatedAt: at,
			...(clearError ? { lastError: null } : {}),
		})
		.where(eq(messengerConfig.id, 1));
}

export async function recordMessengerError(message: string) {
	await ensureRow();
	await db
		.update(messengerConfig)
		.set({ lastError: message.slice(0, 2000), updatedAt: new Date() })
		.where(eq(messengerConfig.id, 1));
}
