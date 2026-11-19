import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";

/**
 * Opt-in against a real Synapse. Set MATRIX_LIVE_URL, MATRIX_LIVE_BOT_TOKEN,
 * MATRIX_LIVE_USER_TOKEN and MATRIX_LIVE_ROOM_ID (the bot must already be in
 * the room and the application worker must be running). CI never sets them.
 */
const url = process.env.MATRIX_LIVE_URL?.replace(/\/+$/, "");
const botToken = process.env.MATRIX_LIVE_BOT_TOKEN;
const userToken = process.env.MATRIX_LIVE_USER_TOKEN;
const roomId = process.env.MATRIX_LIVE_ROOM_ID;
const configured = Boolean(url && botToken && userToken && roomId);

function matrix(token: string, method: string, path: string, body?: unknown) {
	return fetch(`${url}${path}`, {
		method,
		headers: {
			authorization: `Bearer ${token}`,
			...(body === undefined ? {} : { "content-type": "application/json" }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(20_000),
	});
}

async function send(token: string, content: Record<string, unknown>) {
	const response = await matrix(
		token,
		"PUT",
		`/_matrix/client/v3/rooms/${encodeURIComponent(roomId as string)}/send/m.room.message/${randomUUID()}`,
		content,
	);
	expect(response.status).toBe(200);
	return (await response.json()).event_id as string;
}

async function waitForReply(
	token: string,
	since: string | null,
	commandId: string,
) {
	const started = Date.now();
	let next = since;
	while (Date.now() - started < 20_000) {
		const query = new URLSearchParams({ timeout: "1000" });
		if (next) query.set("since", next);
		const response = await matrix(
			token,
			"GET",
			`/_matrix/client/v3/sync?${query}`,
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		next = body.next_batch;
		const events = body.rooms?.join?.[roomId as string]?.timeline?.events ?? [];
		const reply = events.find(
			(event: { content?: Record<string, unknown> }) =>
				(event.content?.["m.relates_to"] as { event_id?: string } | undefined)
					?.event_id === commandId,
		);
		if (reply) return reply;
	}
	throw new Error("The bot did not answer the command");
}

describe.skipIf(!configured)("live Matrix homeserver", () => {
	test("!help answers in a real thread", async () => {
		const who = await matrix(
			botToken as string,
			"GET",
			"/_matrix/client/v3/account/whoami",
		);
		expect(who.status).toBe(200);
		const me = await who.json();
		const sync = await matrix(
			userToken as string,
			"GET",
			"/_matrix/client/v3/sync?timeout=0",
		);
		expect(sync.status).toBe(200);
		const since = (await sync.json()).next_batch as string;
		const command = await send(userToken as string, {
			msgtype: "m.text",
			body: "!help",
		});
		const reply = await waitForReply(userToken as string, since, command);
		expect(reply.sender).toBe(me.user_id);
		expect(String(reply.content.body)).toContain("!ticket");
		expect(reply.content["m.relates_to"]).toMatchObject({
			rel_type: "m.thread",
			event_id: command,
		});
	}, 40_000);

	test("!ticket answers with a request key", async () => {
		if (!process.env.MATRIX_LIVE_TICKET) return;
		const sync = await matrix(
			userToken as string,
			"GET",
			"/_matrix/client/v3/sync?timeout=0",
		);
		const since = (await sync.json()).next_batch as string;
		const command = await send(userToken as string, {
			msgtype: "m.text",
			body: `!ticket ${process.env.MATRIX_LIVE_TICKET}`,
		});
		const reply = await waitForReply(userToken as string, since, command);
		expect(String(reply.content.body)).toMatch(/^Created [A-Z]+-\d+: /);
	}, 40_000);
});
