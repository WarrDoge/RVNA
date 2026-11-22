import { randomUUID } from "node:crypto";
import type { MessengerSettings } from "./config.ts";

export class MatrixClientError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "MatrixClientError";
		this.status = status;
	}
}

function baseUrl(settings: Pick<MessengerSettings, "homeserverUrl">) {
	return settings.homeserverUrl.replace(/\/+$/, "");
}

async function request<T>(
	settings: Pick<MessengerSettings, "homeserverUrl" | "accessToken">,
	path: string,
	init: RequestInit = {},
	timeoutMs = 15_000,
): Promise<T> {
	const callerSignal = init.signal;
	const signal =
		callerSignal instanceof AbortSignal
			? AbortSignal.any([callerSignal, AbortSignal.timeout(timeoutMs)])
			: AbortSignal.timeout(timeoutMs);
	const response = await fetch(`${baseUrl(settings)}${path}`, {
		...init,
		signal,
		headers: {
			Authorization: `Bearer ${settings.accessToken ?? ""}`,
			...(init.body === undefined
				? {}
				: { "Content-Type": "application/json" }),
			...init.headers,
		},
	});
	const text = await response.text();
	let payload: unknown = null;
	if (text !== "") {
		try {
			payload = JSON.parse(text);
		} catch {
			payload = null;
		}
	}
	if (!response.ok) {
		const message =
			typeof payload === "object" &&
			payload !== null &&
			typeof (payload as { error?: unknown }).error === "string"
				? (payload as { error: string }).error.slice(0, 300)
				: `Matrix request failed (${response.status})`;
		throw new MatrixClientError(response.status, message);
	}
	if (payload === null) {
		throw new MatrixClientError(
			response.status,
			"Matrix returned an empty response",
		);
	}
	return payload as T;
}

export async function matrixWhoami(
	settings: Pick<MessengerSettings, "homeserverUrl" | "accessToken">,
) {
	return request<{ user_id: string }>(
		settings,
		"/_matrix/client/v3/account/whoami",
	);
}

const syncFilter = JSON.stringify({
	room: {
		timeline: { types: ["m.room.message"], limit: 100 },
		state: { types: ["m.room.encryption"] },
		ephemeral: { types: [] },
		account_data: { types: [] },
	},
	presence: { types: [] },
	account_data: { types: [] },
});

export interface MatrixSyncResponse {
	next_batch: string;
	rooms?: {
		invite?: Record<string, { invite_state?: { events?: MatrixEvent[] } }>;
		join?: Record<
			string,
			{
				state?: { events?: MatrixEvent[] };
				timeline?: {
					events?: MatrixEvent[];
					limited?: boolean;
					prev_batch?: string;
				};
			}
		>;
	};
}

export interface MatrixEvent {
	type?: string;
	event_id?: string;
	sender?: string;
	state_key?: string;
	origin_server_ts?: number;
	content?: Record<string, unknown>;
}

export async function matrixSync(
	settings: Pick<MessengerSettings, "homeserverUrl" | "accessToken">,
	since: string | null,
	signal: AbortSignal,
) {
	const query = new URLSearchParams({ timeout: "30000", filter: syncFilter });
	if (since) query.set("since", since);
	return request<MatrixSyncResponse>(
		settings,
		`/_matrix/client/v3/sync?${query.toString()}`,
		{ signal },
		45_000,
	);
}

export interface MatrixMessagesResponse {
	chunk?: MatrixEvent[];
	end?: string;
}

export async function matrixMessages(
	settings: Pick<MessengerSettings, "homeserverUrl" | "accessToken">,
	roomId: string,
	from: string,
	limit = 1000,
) {
	const query = new URLSearchParams({ from, dir: "f", limit: String(limit) });
	return request<MatrixMessagesResponse>(
		settings,
		`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?${query.toString()}`,
		{},
		30_000,
	);
}

export async function matrixJoin(
	settings: Pick<MessengerSettings, "homeserverUrl" | "accessToken">,
	roomId: string,
) {
	return request<{ room_id?: string }>(
		settings,
		`/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
		{ method: "POST", body: "{}" },
	);
}

export async function matrixSend(
	settings: Pick<MessengerSettings, "homeserverUrl" | "accessToken">,
	roomId: string,
	eventType: string,
	content: Record<string, unknown>,
) {
	return request<{ event_id: string }>(
		settings,
		`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/${encodeURIComponent(eventType)}/${randomUUID()}`,
		{ method: "PUT", body: JSON.stringify(content) },
	);
}

export function threadRelation(rootEventId: string) {
	return {
		rel_type: "m.thread",
		event_id: rootEventId,
		is_falling_back: true,
		"m.in_reply_to": { event_id: rootEventId },
	};
}

export async function matrixSendText(
	settings: Pick<MessengerSettings, "homeserverUrl" | "accessToken">,
	roomId: string,
	body: string,
	threadRoot?: string | null,
) {
	return matrixSend(settings, roomId, "m.room.message", {
		msgtype: "m.text",
		body,
		// An empty mentions object turns off the legacy body match, so `@room` in a quoted comment pings nobody.
		"m.mentions": {},
		...(threadRoot ? { "m.relates_to": threadRelation(threadRoot) } : {}),
	});
}

export async function matrixReact(
	settings: Pick<MessengerSettings, "homeserverUrl" | "accessToken">,
	roomId: string,
	eventId: string,
	key: string,
) {
	return matrixSend(settings, roomId, "m.reaction", {
		"m.relates_to": {
			rel_type: "m.annotation",
			event_id: eventId,
			key,
		},
	});
}
