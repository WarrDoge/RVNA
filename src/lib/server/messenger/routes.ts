import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../admin/audit.ts";
import type { CurrentUser } from "../auth.ts";
import { db } from "../db.ts";
import { HttpError } from "../http.ts";
import { requireAdminActor } from "../permissions.ts";
import { projects, requestTypes, serviceDesks } from "../schema.ts";
import { matrixWhoami } from "./client.ts";
import {
	clearMessengerToken,
	matrixServerName,
	messengerSettings,
	saveMessengerIdentity,
	saveMessengerSettings as storeSettings,
	saveMessengerToken as storeToken,
} from "./config.ts";
import { encryptionAvailable } from "./crypto.ts";
import { isMessengerWorkerRunning, restartMessengerWorker } from "./worker.ts";

export const messengerSettingsSchema = z.object({
	homeserverUrl: z.string(),
	hasAccessToken: z.boolean(),
	serviceDeskId: z.uuid().nullable(),
	requestTypeId: z.uuid().nullable(),
	enabled: z.boolean(),
	botMatrixId: z.string().nullable(),
	serverName: z.string().nullable(),
	lastSyncAt: z.string().nullable(),
	lastError: z.string().nullable(),
	workerRunning: z.boolean(),
	secretsKeyConfigured: z.boolean(),
});

function isHttpUrl(value: string) {
	if (value === "") return true;
	try {
		const url = new URL(value);
		return (
			(url.protocol === "http:" || url.protocol === "https:") &&
			url.username === "" &&
			url.password === ""
		);
	} catch {
		return false;
	}
}

const httpUrl = z
	.string()
	.trim()
	.max(2000)
	.refine(
		isHttpUrl,
		"Must be an HTTP or HTTPS URL without a user name or password",
	);

export const messengerSettingsBody = z.object({
	homeserverUrl: httpUrl,
	serviceDeskId: z.uuid().nullable(),
	requestTypeId: z.uuid().nullable(),
	enabled: z.boolean(),
});

export const messengerTokenBody = z.object({
	token: z.string().trim().min(1).max(2000),
});

export const messengerTestSchema = z.object({
	userId: z.string(),
	serverName: z.string(),
});

export async function publicMessengerSettings() {
	const settings = await messengerSettings();
	return {
		homeserverUrl: settings.homeserverUrl,
		hasAccessToken: settings.accessToken !== null,
		serviceDeskId: settings.serviceDeskId,
		requestTypeId: settings.requestTypeId,
		enabled: settings.enabled,
		botMatrixId: settings.botMatrixId,
		serverName: settings.serverName,
		lastSyncAt: settings.lastSyncAt?.toISOString() ?? null,
		lastError: settings.lastError,
		workerRunning: isMessengerWorkerRunning(),
		secretsKeyConfigured: encryptionAvailable(),
	};
}

export async function getMessengerSettings(actor: CurrentUser) {
	requireAdminActor(actor);
	return publicMessengerSettings();
}

export async function getMessengerOptions(actor: CurrentUser) {
	requireAdminActor(actor);
	const [desks, types] = await Promise.all([
		db
			.select({
				id: serviceDesks.id,
				name: serviceDesks.portalName,
				projectKey: projects.key,
			})
			.from(serviceDesks)
			.innerJoin(projects, eq(projects.id, serviceDesks.projectId))
			.orderBy(asc(projects.key)),
		db
			.select({
				id: requestTypes.id,
				name: requestTypes.name,
				deskId: requestTypes.deskId,
			})
			.from(requestTypes)
			.orderBy(asc(requestTypes.name)),
	]);
	return {
		desks: desks.map((desk) => ({
			...desk,
			requestTypes: types
				.filter((type) => type.deskId === desk.id)
				.map(({ id, name }) => ({ id, name })),
		})),
	};
}

export async function saveMessengerSettings(
	actor: CurrentUser,
	body: z.infer<typeof messengerSettingsBody>,
) {
	requireAdminActor(actor);
	const before = await messengerSettings();
	if (body.enabled) {
		if (body.homeserverUrl === "") {
			throw new HttpError(400, "Set the homeserver URL first");
		}
		if (!before.accessToken) {
			throw new HttpError(400, "Set the bot's access token first");
		}
		if (!body.serviceDeskId || !body.requestTypeId) {
			throw new HttpError(400, "Choose a service desk and a request type");
		}
		const [type] = await db
			.select({ id: requestTypes.id })
			.from(requestTypes)
			.where(eq(requestTypes.id, body.requestTypeId))
			.limit(1);
		if (!type) throw new HttpError(400, "Request type not found");
		const [desk] = await db
			.select({ id: serviceDesks.id })
			.from(serviceDesks)
			.where(eq(serviceDesks.id, body.serviceDeskId))
			.limit(1);
		if (!desk) throw new HttpError(400, "Service desk not found");
		const [typeDesk] = await db
			.select({ deskId: requestTypes.deskId })
			.from(requestTypes)
			.where(eq(requestTypes.id, body.requestTypeId))
			.limit(1);
		if (!typeDesk || typeDesk.deskId !== body.serviceDeskId) {
			throw new HttpError(400, "That request type is not in the chosen desk");
		}
	}
	await storeSettings(body);
	await audit(db, actor, {
		action: "messenger.settings.save",
		entityType: "messenger_config",
		entityId: "1",
		summary: body.enabled ? "Updated Messenger settings" : "Disabled Messenger",
		changes: {
			from: {
				homeserverUrl: before.homeserverUrl,
				serviceDeskId: before.serviceDeskId,
				requestTypeId: before.requestTypeId,
				enabled: before.enabled,
			},
			to: {
				homeserverUrl: body.homeserverUrl,
				serviceDeskId: body.serviceDeskId,
				requestTypeId: body.requestTypeId,
				enabled: body.enabled,
			},
		},
	});
	await restartMessengerWorker();
	return publicMessengerSettings();
}

export async function saveMessengerAccessToken(
	actor: CurrentUser,
	body: z.infer<typeof messengerTokenBody>,
) {
	requireAdminActor(actor);
	if (!encryptionAvailable()) {
		throw new HttpError(400, "SECRETS_KEY is not set");
	}
	await storeToken(body.token);
	await audit(db, actor, {
		action: "messenger.token.save",
		entityType: "messenger_config",
		entityId: "1",
		summary: "Set the Messenger bot access token",
	});
	await restartMessengerWorker();
	return publicMessengerSettings();
}

export async function clearMessengerAccessToken(actor: CurrentUser) {
	requireAdminActor(actor);
	await clearMessengerToken();
	await audit(db, actor, {
		action: "messenger.token.clear",
		entityType: "messenger_config",
		entityId: "1",
		summary: "Removed the Messenger bot access token",
	});
	await restartMessengerWorker();
	return publicMessengerSettings();
}

export async function testMessengerConnection(actor: CurrentUser) {
	requireAdminActor(actor);
	const settings = await messengerSettings();
	if (!settings.homeserverUrl) {
		throw new HttpError(400, "Set the homeserver URL first");
	}
	if (!settings.accessToken) {
		throw new HttpError(400, "Set the bot's access token first");
	}
	try {
		const who = await matrixWhoami(settings);
		const serverName = matrixServerName(who.user_id);
		if (!serverName) throw new Error("The Matrix id has no server name");
		await saveMessengerIdentity({ userId: who.user_id, serverName });
		return { userId: who.user_id, serverName };
	} catch (error) {
		throw new HttpError(
			502,
			error instanceof Error ? error.message : "The homeserver is unreachable",
		);
	}
}
