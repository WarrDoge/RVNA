import { eq } from "drizzle-orm";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { gitlabConfig } from "../schema.ts";
import { decryptSecret, encryptionAvailable, encryptSecret } from "./crypto.ts";

export interface GitlabSettings {
	baseUrl: string;
	webhookSecret: string | null;
	accessToken: string | null;
	lastDeliveryAt: Date | null;
	lastDeliveryStatus: string | null;
}

async function ensureRow() {
	const [row] = await db
		.select()
		.from(gitlabConfig)
		.where(eq(gitlabConfig.id, 1))
		.limit(1);
	if (row) return row;

	const [created] = await db
		.insert(gitlabConfig)
		.values({ id: 1 })
		.onConflictDoNothing()
		.returning();
	if (created) return created;

	const [existing] = await db
		.select()
		.from(gitlabConfig)
		.where(eq(gitlabConfig.id, 1))
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

export async function gitlabSettings(): Promise<GitlabSettings> {
	const row = await ensureRow();
	return {
		baseUrl: row.baseUrl,
		webhookSecret: decode(row.webhookSecret),
		accessToken: decode(row.accessToken),
		lastDeliveryAt: row.lastDeliveryAt,
		lastDeliveryStatus: row.lastDeliveryStatus,
	};
}

export function webhookUrl() {
	return `${env.APP_URL.replace(/\/$/, "")}/api/integrations/gitlab/webhook`;
}

export async function publicGitlabSettings() {
	const settings = await gitlabSettings();
	return {
		baseUrl: settings.baseUrl,
		webhookUrl: webhookUrl(),
		hasWebhookSecret: settings.webhookSecret !== null,
		hasAccessToken: settings.accessToken !== null,
		lastDeliveryAt: settings.lastDeliveryAt?.toISOString() ?? null,
		lastDeliveryStatus: settings.lastDeliveryStatus,
		secretsKeyConfigured: encryptionAvailable(),
	};
}

export async function saveBaseUrl(baseUrl: string) {
	await ensureRow();
	await db
		.update(gitlabConfig)
		.set({ baseUrl: baseUrl.replace(/\/+$/, ""), updatedAt: new Date() })
		.where(eq(gitlabConfig.id, 1));
}

export async function saveWebhookSecret(secret: string) {
	await ensureRow();
	await db
		.update(gitlabConfig)
		.set({ webhookSecret: encryptSecret(secret), updatedAt: new Date() })
		.where(eq(gitlabConfig.id, 1));
}

export async function saveAccessToken(token: string) {
	await ensureRow();
	await db
		.update(gitlabConfig)
		.set({ accessToken: encryptSecret(token), updatedAt: new Date() })
		.where(eq(gitlabConfig.id, 1));
}

export async function clearAccessToken() {
	await ensureRow();
	await db
		.update(gitlabConfig)
		.set({ accessToken: null, updatedAt: new Date() })
		.where(eq(gitlabConfig.id, 1));
}

export async function recordDelivery(status: string, at = new Date()) {
	await ensureRow();
	await db
		.update(gitlabConfig)
		.set({ lastDeliveryAt: at, lastDeliveryStatus: status, updatedAt: at })
		.where(eq(gitlabConfig.id, 1));
}
