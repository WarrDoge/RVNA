import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { CurrentUser } from "../auth.ts";
import { randomValue } from "../auth.ts";
import { db } from "../db.ts";
import { HttpError } from "../http.ts";
import {
	can,
	issuePermissionContext,
	requireAdminActor,
} from "../permissions.ts";
import { gitlabDeliveries } from "../schema-gitlab.ts";
import { testConnection } from "./client.ts";
import {
	clearAccessToken,
	gitlabSettings,
	publicGitlabSettings,
	saveAccessToken,
	saveBaseUrl,
	saveWebhookSecret,
} from "./config.ts";
import { constantTimeEqual, encryptionAvailable } from "./crypto.ts";
import { issueDevelopment } from "./development.ts";
import {
	projectByKey,
	projectGitlabSettings,
	saveProjectGitlabSettings,
} from "./project-settings.ts";
import { enqueueGitlabDelivery } from "./queue.ts";

function payloadObject(payload: unknown) {
	return (
		typeof payload === "object" && payload !== null && !Array.isArray(payload)
	);
}

export const gitlabSettingsSchema = z.object({
	baseUrl: z.string(),
	webhookUrl: z.string(),
	hasWebhookSecret: z.boolean(),
	hasAccessToken: z.boolean(),
	lastDeliveryAt: z.string().nullable(),
	lastDeliveryStatus: z.string().nullable(),
	secretsKeyConfigured: z.boolean(),
});

export const projectGitlabSchema = z.object({
	repositories: z.array(
		z.object({
			id: z.uuid(),
			path: z.string(),
			webUrl: z.string(),
			linked: z.boolean(),
		}),
	),
	linkedRepositoryIds: z.array(z.uuid()),
	defaultRepositoryId: z.uuid().nullable(),
	smartCommitsEnabled: z.boolean(),
	mergeRequestOpenedEnabled: z.boolean(),
	mergeRequestOpenedTransitions: z.array(z.string()),
	mergeRequestMergedEnabled: z.boolean(),
	mergeRequestMergedTransitions: z.array(z.string()),
	availableTransitions: z.array(z.string()),
});

const transitionList = z.array(z.string().trim().min(1).max(200)).max(20);

export const projectGitlabBody = z.object({
	linkedRepositoryIds: z.array(z.uuid()).max(100),
	defaultRepositoryId: z.uuid().nullable(),
	smartCommitsEnabled: z.boolean(),
	mergeRequestOpenedEnabled: z.boolean(),
	mergeRequestOpenedTransitions: transitionList,
	mergeRequestMergedEnabled: z.boolean(),
	mergeRequestMergedTransitions: transitionList,
});

const repositoryRef = z.object({
	id: z.uuid(),
	path: z.string(),
	webUrl: z.string(),
});

export const developmentSchema = z.object({
	counts: z.object({
		branches: z.number().int(),
		commits: z.number().int(),
		mergeRequests: z.number().int(),
	}),
	mergeRequestState: z.enum(["OPEN", "MERGED", "DECLINED"]).nullable(),
	latestPipeline: z
		.object({
			id: z.uuid(),
			status: z.string(),
			ref: z.string().nullable(),
			webUrl: z.string().nullable(),
			createdAt: z.iso.datetime(),
		})
		.nullable(),
	latestCommit: z
		.object({
			sha: z.string(),
			title: z.string(),
			webUrl: z.string().nullable(),
			committedAt: z.iso.datetime().nullable(),
		})
		.nullable(),
	createBranch: z.object({ name: z.string(), url: z.string() }).nullable(),
	branches: z.array(
		z.object({
			id: z.uuid(),
			name: z.string(),
			webUrl: z.string().nullable(),
			updatedAt: z.iso.datetime(),
			repository: repositoryRef,
		}),
	),
	commits: z.array(
		z.object({
			id: z.uuid(),
			sha: z.string(),
			title: z.string(),
			webUrl: z.string().nullable(),
			authorName: z.string().nullable(),
			committedAt: z.iso.datetime().nullable(),
			repository: repositoryRef,
		}),
	),
	mergeRequests: z.array(
		z.object({
			id: z.uuid(),
			iid: z.number().int(),
			title: z.string(),
			state: z.string(),
			lozenge: z.enum(["OPEN", "MERGED", "DECLINED"]).nullable(),
			approvals: z.number().int(),
			authorName: z.string().nullable(),
			webUrl: z.string().nullable(),
			updatedAt: z.iso.datetime(),
			repository: repositoryRef,
		}),
	),
});

export const projectParams = z.object({ key: z.string().min(1).max(100) });
export const issueParams = z.object({ key: z.string().min(1).max(100) });

export const gitlabBaseUrlBody = z.object({
	baseUrl: z
		.url()
		.refine(
			(value) => value.startsWith("http://") || value.startsWith("https://"),
			"Must be an HTTP or HTTPS URL",
		),
});

export const gitlabTokenBody = z.object({
	token: z.string().trim().min(1).max(500),
});

export const gitlabSecretSchema = gitlabSettingsSchema.extend({
	secret: z.string(),
});

export const gitlabVersionSchema = z.object({ version: z.string() });

export type ProjectGitlabInput = z.infer<typeof projectGitlabBody>;

export async function getIssueDevelopment(actor: CurrentUser, key: string) {
	const context = await issuePermissionContext(key);
	if (!context) throw new HttpError(404, "Issue not found");
	if (!(await can(actor, "BROWSE_PROJECTS", context.project, context))) {
		throw new HttpError(404, "Issue not found");
	}
	const development = await issueDevelopment(key);
	if (!development) throw new HttpError(404, "Issue not found");
	return development;
}

export async function acceptGitlabWebhook(
	_actor: null,
	input: {
		token: string | null;
		event: string;
		providedKey: string | null;
		payload: unknown;
	},
) {
	const settings = await gitlabSettings();
	const token = input.token;
	if (
		!settings.webhookSecret ||
		!token ||
		!constantTimeEqual(token, settings.webhookSecret)
	) {
		throw new HttpError(401, "Unauthorized");
	}

	const payload = input.payload;
	if (!payloadObject(payload)) {
		throw new HttpError(400, "Invalid payload");
	}

	const event = input.event;
	const idempotencyKey =
		input.providedKey ??
		`body:${event}:${createHash("sha256")
			.update(JSON.stringify(payload))
			.digest("hex")}`;

	const [created] = await db
		.insert(gitlabDeliveries)
		.values({ idempotencyKey, event, payload })
		.onConflictDoNothing()
		.returning({ id: gitlabDeliveries.id });

	if (!created) {
		const [existing] = await db
			.select()
			.from(gitlabDeliveries)
			.where(eq(gitlabDeliveries.idempotencyKey, idempotencyKey))
			.limit(1);
		if (
			existing &&
			existing.status !== "processed" &&
			existing.status !== "ignored"
		) {
			try {
				await enqueueGitlabDelivery(existing.id);
			} catch {
				throw new HttpError(503, "The webhook queue is unavailable");
			}
		}
		return { status: 202 as const, body: { status: "accepted" as const } };
	}

	try {
		await enqueueGitlabDelivery(created.id);
	} catch (error) {
		await db
			.update(gitlabDeliveries)
			.set({
				status: "failed",
				reason: error instanceof Error ? error.message : String(error),
			})
			.where(eq(gitlabDeliveries.id, created.id));
		throw new HttpError(503, "The webhook queue is unavailable");
	}

	return { status: 202 as const, body: { status: "accepted" as const } };
}

export async function getGitlabSettings(actor: CurrentUser) {
	requireAdminActor(actor);
	return publicGitlabSettings();
}

export async function saveGitlabBaseUrl(
	actor: CurrentUser,
	body: z.infer<typeof gitlabBaseUrlBody>,
) {
	requireAdminActor(actor);
	await saveBaseUrl(body.baseUrl);
	return publicGitlabSettings();
}

export async function createGitlabWebhookSecret(actor: CurrentUser) {
	requireAdminActor(actor);
	if (!encryptionAvailable()) {
		throw new HttpError(400, "SECRETS_KEY is not set");
	}
	const secret = randomValue();
	await saveWebhookSecret(secret);
	return { ...(await publicGitlabSettings()), secret };
}

export async function saveGitlabAccessToken(
	actor: CurrentUser,
	body: z.infer<typeof gitlabTokenBody>,
) {
	requireAdminActor(actor);
	if (!encryptionAvailable()) {
		throw new HttpError(400, "SECRETS_KEY is not set");
	}
	await saveAccessToken(body.token);
	return publicGitlabSettings();
}

export async function clearGitlabAccessToken(actor: CurrentUser) {
	requireAdminActor(actor);
	await clearAccessToken();
	return publicGitlabSettings();
}

export async function testGitlabConnection(actor: CurrentUser) {
	requireAdminActor(actor);
	const settings = await gitlabSettings();
	if (!settings.baseUrl) {
		throw new HttpError(400, "Set the GitLab base URL first");
	}
	if (!settings.accessToken) {
		throw new HttpError(400, "Set a GitLab access token first");
	}
	try {
		return await testConnection(settings.baseUrl, settings.accessToken);
	} catch (error) {
		throw new HttpError(
			502,
			error instanceof Error ? error.message : "GitLab is unreachable",
		);
	}
}

export async function getProjectGitlab(_actor: CurrentUser, key: string) {
	requireAdminActor(_actor);
	const project = await projectByKey(key);
	if (!project) throw new HttpError(404, "Project not found");
	return projectGitlabSettings(project.id);
}

export async function updateProjectGitlab(
	_actor: CurrentUser,
	key: string,
	body: ProjectGitlabInput,
) {
	requireAdminActor(_actor);
	const project = await projectByKey(key);
	if (!project) throw new HttpError(404, "Project not found");
	await saveProjectGitlabSettings(project.id, body);
	return projectGitlabSettings(project.id);
}
