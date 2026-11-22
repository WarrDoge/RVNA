import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";

export interface FakeMatrixEvent {
	type?: string;
	event_id?: string;
	sender?: string;
	state_key?: string;
	origin_server_ts?: number;
	content?: Record<string, unknown>;
}

export interface FakeSyncResponse {
	next_batch?: string;
	rooms?: {
		invite?: Record<string, { invite_state?: { events?: FakeMatrixEvent[] } }>;
		join?: Record<
			string,
			{
				state?: { events?: FakeMatrixEvent[] };
				timeline?: {
					events?: FakeMatrixEvent[];
					limited?: boolean;
					prev_batch?: string;
				};
			}
		>;
	};
}

export interface FakeMatrixSent {
	roomId: string;
	eventType: string;
	content: Record<string, unknown>;
}

type Pending = {
	response: ServerResponse;
	timer: NodeJS.Timeout;
	since?: string;
};

export interface FakeMatrixOptions {
	port?: number;
	botUserId?: string;
	token?: string;
}

/**
 * A tiny Matrix client-server API for tests: whoami, long-polling sync, join and
 * send. The sync queue is scripted; when it is empty a request is held until an
 * event arrives or the requested timeout (capped) passes.
 */
export class FakeMatrix {
	readonly botUserId: string;
	readonly token: string;
	readonly requests: { method: string; path: string; body: string }[] = [];
	readonly sent: FakeMatrixSent[] = [];
	readonly joins: string[] = [];
	readonly refusedSends = new Set<string>();
	syncCount = 0;
	url = "";
	revoked = false;

	private server = createServer((request, response) => {
		void this.handle(request, response);
	});
	private queue: FakeSyncResponse[] = [];
	private backfill = new Map<string, FakeMatrixEvent[]>();
	private limited = new Map<string, FakeMatrixEvent[]>();
	private pending: Pending[] = [];
	private batch = 0;
	private port: number;

	constructor(options: FakeMatrixOptions = {}) {
		this.botUserId = options.botUserId ?? "@ticket-bot:matrix.test";
		this.token = options.token ?? "test-matrix-token";
		this.port = options.port ?? 0;
	}

	async start() {
		await new Promise<void>((resolve, reject) => {
			this.server.once("error", reject);
			this.server.listen(this.port, "127.0.0.1", () => resolve());
		});
		const address = this.server.address();
		if (!address || typeof address === "string") {
			throw new Error("The fake Matrix server has no port");
		}
		this.port = address.port;
		this.url = `http://127.0.0.1:${this.port}`;
		return this;
	}

	/** Refuses sends to a room, as a homeserver refuses plaintext events in an E2EE room. */
	rejectSends(roomId: string) {
		this.refusedSends.add(roomId);
	}

	/** Makes every client API call fail with Synapse's revoked-token response. */
	revoke() {
		this.revoked = true;
		for (const item of this.pending.splice(0)) {
			clearTimeout(item.timer);
			this.writeError(
				item.response,
				401,
				"M_UNKNOWN_TOKEN",
				"Invalid access token passed.",
			);
		}
	}

	async close() {
		for (const item of this.pending.splice(0)) {
			clearTimeout(item.timer);
			item.response.destroy();
		}
		await new Promise<void>((resolve) => this.server.close(() => resolve()));
	}

	pushSync(response: FakeSyncResponse) {
		this.queue.push(response);
		this.flush();
	}

	pushTimeline(roomId: string, events: FakeMatrixEvent[]) {
		this.pushSync({ rooms: { join: { [roomId]: { timeline: { events } } } } });
	}

	private joinEvent(roomId: string): FakeMatrixEvent {
		return {
			type: "m.room.member",
			state_key: this.botUserId,
			sender: this.botUserId,
			event_id: `$join-${roomId}-${++this.batch}`,
			content: { membership: "join" },
		};
	}

	/** The first sync after joining, with the bot's join event before new messages. */
	pushJoinedTimeline(roomId: string, events: FakeMatrixEvent[]) {
		this.pushTimeline(roomId, [this.joinEvent(roomId), ...events]);
	}

	/** The first sync after joining, with messages sent before the bot joined. */
	pushHistoryOnJoin(roomId: string, history: FakeMatrixEvent[]) {
		this.pushTimeline(roomId, [...history, this.joinEvent(roomId)]);
	}

	pushInvite(roomId: string, events: FakeMatrixEvent[] = []) {
		this.pushSync({
			rooms: { invite: { [roomId]: { invite_state: { events } } } },
		});
	}

	pushJoinState(roomId: string, events: FakeMatrixEvent[]) {
		this.pushSync({ rooms: { join: { [roomId]: { state: { events } } } } });
	}

	/** A sync whose timeline is truncated, with the missing events behind prev_batch. */
	pushLimitedTimeline(
		roomId: string,
		timeline: FakeMatrixEvent[],
		earlier: FakeMatrixEvent[],
		prevBatch = `p${this.backfill.size + 1}`,
	) {
		this.limited.set(prevBatch, earlier);
		this.pushSync({
			rooms: {
				join: {
					[roomId]: {
						timeline: {
							events: timeline,
							limited: true,
							prev_batch: prevBatch,
						},
					},
				},
			},
		});
	}

	async waitFor<T>(
		read: () => T | null | undefined | false,
		timeoutMs = 10_000,
	): Promise<T> {
		const started = Date.now();
		while (Date.now() - started < timeoutMs) {
			const value = read();
			if (value) return value;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		throw new Error("Timed out waiting for the fake Matrix server");
	}

	private flush() {
		while (this.queue.length > 0 && this.pending.length > 0) {
			const next = this.queue.shift() as FakeSyncResponse;
			const item = this.pending.shift() as Pending;
			clearTimeout(item.timer);
			for (const room of Object.values(next.rooms?.join ?? {})) {
				const prevBatch = room.timeline?.prev_batch;
				if (!room.timeline?.limited || !prevBatch) continue;
				const earlier = this.limited.get(prevBatch);
				if (earlier && item.since) this.backfill.set(item.since, earlier);
			}
			this.writeSync(item.response, next);
		}
	}

	private writeError(
		response: ServerResponse,
		status: number,
		errcode: string,
		error: string,
	) {
		if (response.writableEnded) return;
		response.writeHead(status, { "content-type": "application/json" });
		response.end(JSON.stringify({ errcode, error }));
	}

	private writeSync(response: ServerResponse, body: FakeSyncResponse) {
		this.syncCount += 1;
		const payload = {
			next_batch: body.next_batch ?? `s${++this.batch}`,
			...body,
		};
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify(payload));
	}

	private async readBody(request: IncomingMessage) {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.from(chunk));
		return Buffer.concat(chunks).toString("utf8");
	}

	private async handle(request: IncomingMessage, response: ServerResponse) {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		const body = await this.readBody(request);
		this.requests.push({
			method: request.method ?? "GET",
			path: url.pathname,
			body,
		});

		if (this.revoked) {
			this.writeError(
				response,
				401,
				"M_UNKNOWN_TOKEN",
				"Invalid access token passed.",
			);
			return;
		}

		if (url.pathname === "/_matrix/client/v3/account/whoami") {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ user_id: this.botUserId }));
			return;
		}

		if (url.pathname === "/_matrix/client/v3/sync") {
			if (this.queue.length > 0) {
				this.writeSync(response, this.queue.shift() as FakeSyncResponse);
				return;
			}
			const requested = Number(url.searchParams.get("timeout") ?? "30000");
			const timeout = Number.isFinite(requested)
				? Math.min(requested, 5_000)
				: 5_000;
			const timer = setTimeout(() => {
				this.pending = this.pending.filter(
					(item) => item.response !== response,
				);
				if (!response.writableEnded) this.writeSync(response, {});
			}, timeout);
			this.pending.push({
				response,
				timer,
				since: url.searchParams.get("since") ?? undefined,
			});
			return;
		}

		if (
			request.method === "POST" &&
			url.pathname.startsWith("/_matrix/client/v3/join/")
		) {
			const roomId = decodeURIComponent(
				url.pathname.slice("/_matrix/client/v3/join/".length),
			);
			this.joins.push(roomId);
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ room_id: roomId }));
			return;
		}

		const messages = /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/messages$/.exec(
			url.pathname,
		);
		if (messages && request.method === "GET") {
			const from = url.searchParams.get("from") ?? "";
			const chunk = this.backfill.get(from) ?? [];
			this.backfill.delete(from);
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ chunk, end: null }));
			return;
		}

		const send =
			/^\/_matrix\/client\/v3\/rooms\/([^/]+)\/send\/([^/]+)\/[^/]+$/.exec(
				url.pathname,
			);
		if (send && request.method === "PUT") {
			const roomId = decodeURIComponent(send[1]);
			const eventType = decodeURIComponent(send[2]);
			if (this.refusedSends.has(roomId)) {
				this.writeError(
					response,
					400,
					"M_UNKNOWN",
					"Encrypted rooms cannot contain unencrypted events",
				);
				return;
			}
			let content: Record<string, unknown> = {};
			try {
				content = JSON.parse(body) as Record<string, unknown>;
			} catch {
				content = {};
			}
			this.sent.push({ roomId, eventType, content });
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ event_id: `$sent-${this.sent.length}` }));
			return;
		}

		response.writeHead(404, { "content-type": "application/json" });
		response.end(JSON.stringify({ error: "Not found" }));
	}
}
