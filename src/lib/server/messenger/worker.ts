import { eq } from "drizzle-orm";
import { Client } from "pg";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { messengerRooms } from "../schema.ts";
import {
	MatrixClientError,
	type MatrixEvent,
	type MatrixSyncResponse,
	matrixJoin,
	matrixMessages,
	matrixSendText,
	matrixSync,
	matrixWhoami,
} from "./client.ts";
import { handleMatrixMessage } from "./commands.ts";
import {
	matrixServerName,
	messengerSettings,
	recordMessengerError,
	recordMessengerSync,
	saveMessengerIdentity,
	saveMessengerSinceToken,
} from "./config.ts";

const LOCK_SQL =
	"select pg_try_advisory_lock(hashtextextended('rvna-messenger', 0)) as locked";
const UNLOCK_SQL =
	"select pg_advisory_unlock(hashtextextended('rvna-messenger', 0))";
const INITIAL_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const LOCK_RETRY_MS = 5_000;
const ENCRYPTED_NOTICE =
	"I cannot read encrypted rooms; start an unencrypted chat with me";

function wait(ms: number, signal: AbortSignal) {
	return new Promise<void>((resolve) => {
		const timer = setTimeout(done, ms);
		signal.addEventListener("abort", done, { once: true });
		function done() {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		}
	});
}

async function ensureRoom(roomId: string) {
	const [created] = await db
		.insert(messengerRooms)
		.values({ roomId })
		.onConflictDoNothing()
		.returning();
	if (created) return { room: created, created: true };
	const [room] = await db
		.select()
		.from(messengerRooms)
		.where(eq(messengerRooms.roomId, roomId))
		.limit(1);
	return room ? { room, created: false } : null;
}

function hasEncryption(events: MatrixEvent[] | undefined) {
	return (events ?? []).some((event) => event.type === "m.room.encryption");
}

async function sendEncryptionNoticeOnce(
	settings: Awaited<ReturnType<typeof messengerSettings>>,
	roomId: string,
) {
	const stored = await ensureRoom(roomId);
	if (!stored?.room || stored.room.encryptionNoticeSent) return;
	await matrixSendText(settings, roomId, ENCRYPTED_NOTICE);
	await db
		.update(messengerRooms)
		.set({ encrypted: true, encryptionNoticeSent: true })
		.where(eq(messengerRooms.roomId, roomId));
}

async function markEncrypted(roomId: string) {
	await ensureRoom(roomId);
	await db
		.update(messengerRooms)
		.set({ encrypted: true })
		.where(eq(messengerRooms.roomId, roomId));
}

const BACKFILL_PAGE = 100;
const BACKFILL_MAX_PAGES = 100;

async function backfill(
	settings: Awaited<ReturnType<typeof messengerSettings>>,
	roomId: string,
	from: string,
) {
	let token = from;
	let failures = 0;
	for (let page = 0; page < BACKFILL_MAX_PAGES; page += 1) {
		const response = await matrixMessages(
			settings,
			roomId,
			token,
			BACKFILL_PAGE,
		);
		const events = response.chunk ?? [];
		for (const event of events) {
			if (!(await handleMatrixMessage(settings, roomId, event))) failures += 1;
		}
		if (!response.end || events.length === 0 || response.end === token) break;
		token = response.end;
	}
	return failures;
}

async function processSync(
	settings: Awaited<ReturnType<typeof messengerSettings>>,
	response: MatrixSyncResponse,
	firstSync: boolean,
	since: string | null,
) {
	let failures = 0;
	const invites = response.rooms?.invite ?? {};
	for (const [roomId, invite] of Object.entries(invites)) {
		await matrixJoin(settings, roomId);
		if (hasEncryption(invite.invite_state?.events)) {
			await markEncrypted(roomId);
			await sendEncryptionNoticeOnce(settings, roomId);
		}
	}

	const joined = response.rooms?.join ?? {};
	for (const [roomId, room] of Object.entries(joined)) {
		const stored = await ensureRoom(roomId);
		if (!stored) continue;
		if (stored.room.encrypted || hasEncryption(room.state?.events)) {
			if (!stored.room.encrypted) await markEncrypted(roomId);
			await sendEncryptionNoticeOnce(settings, roomId);
			continue;
		}
		if (firstSync) continue;
		let events = room.timeline?.events ?? [];
		if (stored.created) {
			// Synapse includes the room's recent history in the first sync of a newly
			// joined room. Everything before the bot's own join event is history.
			const join = events.findIndex(
				(event) =>
					event.type === "m.room.member" &&
					event.state_key === settings.botMatrixId &&
					event.content?.membership === "join",
			);
			if (join === -1) continue;
			events = events.slice(join + 1);
		} else if (room.timeline?.limited && since) {
			failures += await backfill(settings, roomId, since);
		}
		for (const event of events) {
			if (!(await handleMatrixMessage(settings, roomId, event))) failures += 1;
		}
	}
	return failures;
}

async function syncLoop(
	signal: AbortSignal,
	markRunning: (value: boolean) => void,
) {
	let settings = await messengerSettings();
	if (!settings.enabled || !settings.accessToken || !settings.homeserverUrl) {
		return;
	}
	markRunning(true);
	if (!settings.botMatrixId) {
		const who = await matrixWhoami(settings);
		const serverName = matrixServerName(who.user_id);
		if (!serverName) throw new Error("The bot's Matrix id has no server name");
		await saveMessengerIdentity({ userId: who.user_id, serverName });
		settings = await messengerSettings();
	}

	let backoff = INITIAL_BACKOFF_MS;
	// A failed chat message leaves its error in place; only a transport recovery clears it.
	let clearError = true;
	while (!signal.aborted) {
		try {
			const current = await messengerSettings();
			if (!current.enabled) return;
			const firstSync = current.sinceToken === null;
			const response = await matrixSync(current, current.sinceToken, signal);
			const failures = await processSync(
				current,
				response,
				firstSync,
				current.sinceToken,
			);
			await saveMessengerSinceToken(response.next_batch);
			await recordMessengerSync(new Date(), clearError && failures === 0);
			clearError = false;
			backoff = INITIAL_BACKOFF_MS;
		} catch (error) {
			if (signal.aborted) return;
			const message = error instanceof Error ? error.message : String(error);
			await recordMessengerError(message).catch(() => undefined);
			clearError = true;
			if (error instanceof MatrixClientError && error.status === 401) return;
			await wait(backoff, signal);
			backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
		}
	}
}

async function session(
	signal: AbortSignal,
	markRunning: (value: boolean) => void,
) {
	const client = new Client({
		connectionString: env.DATABASE_URL,
		application_name: "rvna-messenger",
	});
	// The advisory lock lives on this connection: when it drops, stop syncing so
	// another worker can take the lock without two workers processing at once.
	const lost = new AbortController();
	const onError = (error: Error) => lost.abort(error);
	client.on("error", onError);
	await client.connect();
	const combined = AbortSignal.any([signal, lost.signal]);
	let locked = false;
	try {
		while (!combined.aborted) {
			const result = await client.query<{ locked: boolean }>(LOCK_SQL);
			if (result.rows[0]?.locked) {
				locked = true;
				break;
			}
			await wait(LOCK_RETRY_MS, combined);
		}
		if (locked) await syncLoop(combined, markRunning);
	} finally {
		markRunning(false);
		if (locked) await client.query(UNLOCK_SQL).catch(() => undefined);
		await client.end().catch(() => undefined);
	}
	if (lost.signal.aborted && !signal.aborted) throw lost.signal.reason;
}

async function run(signal: AbortSignal, markRunning: (value: boolean) => void) {
	while (!signal.aborted) {
		try {
			await session(signal, markRunning);
			return;
		} catch (error) {
			if (signal.aborted) return;
			const message = error instanceof Error ? error.message : String(error);
			await recordMessengerError(message).catch(() => undefined);
			if (error instanceof MatrixClientError && error.status === 401) return;
			await wait(INITIAL_BACKOFF_MS, signal);
		}
	}
}

export function createMessengerWorker() {
	let running = false;
	let loop: Promise<void> | null = null;
	let controller: AbortController | null = null;

	function start() {
		if (loop) return;
		const abort = new AbortController();
		controller = abort;
		running = false;
		loop = run(abort.signal, (value) => {
			running = value;
		})
			.catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				console.error("messenger worker:", message);
			})
			.finally(() => {
				running = false;
				loop = null;
			});
	}

	async function stop() {
		controller?.abort();
		controller = null;
		const pending = loop;
		loop = null;
		if (pending) await pending;
		running = false;
	}

	return {
		start,
		stop,
		isRunning: () => running,
	};
}

const defaultWorker = createMessengerWorker();

export function isMessengerWorkerRunning() {
	return defaultWorker.isRunning();
}

export function startMessengerWorker() {
	defaultWorker.start();
}

export async function stopMessengerWorker() {
	await defaultWorker.stop();
}

export async function restartMessengerWorker() {
	await defaultWorker.stop();
	defaultWorker.start();
}
