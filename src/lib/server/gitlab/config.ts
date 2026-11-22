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
	if (!existing) {
		throw new Error("GitLab configuration row is missing");
	}
	return existing;
}

function decode(value: string | null, label: string): string | null {
	if (!value) return null;
	try {
		return decryptSecret(value);
	} catch (error) {
		console.error(`GitLab ${label} could not be decrypted`, error);
		return null;
	}
}

export async function gitlabSettings(): Promise<GitlabSettings> {
	const row = await ensureRow();
	return {
		baseUrl: row.baseUrl,
		webhookSecret: decode(row.webhookSecret, "webhook secret"),
		accessToken: decode(row.accessToken, "access token"),
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

async function saveConfig(
	values: Partial<typeof gitlabConfig.$inferInsert>,
	updatedAt = new Date(),
) {
	await db
		.insert(gitlabConfig)
		.values({ id: 1, ...values, updatedAt })
		.onConflictDoUpdate({
			target: gitlabConfig.id,
			set: { ...values, updatedAt },
		});
}

export async function saveBaseUrl(baseUrl: string) {
	await saveConfig({ baseUrl: baseUrl.replace(/\/+$/, "") });
}

export async function saveWebhookSecret(secret: string) {
	await saveConfig({ webhookSecret: encryptSecret(secret) });
}

export async function saveAccessToken(token: string) {
	await saveConfig({ accessToken: encryptSecret(token) });
}

export async function clearAccessToken() {
	await saveConfig({ accessToken: null });
}

export async function recordDelivery(status: string, at = new Date()) {
	await saveConfig({ lastDeliveryAt: at, lastDeliveryStatus: status }, at);
}
