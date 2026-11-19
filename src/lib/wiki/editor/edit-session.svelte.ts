// Hooks of the edit screen that talk to the server in the background: the edit lock and
// the draft autosave. Svelte runes class; the page starts and stops it in an $effect.

import { ApiError, errorMessageFromBody, redirectToLogin } from "#lib/api.ts";
import type { LockInfo, SaveDraftInput } from "#lib/shared/wiki/index.ts";
import { clearLocalDraft, writeLocalDraft } from "./helpers.ts";

const HEARTBEAT_MS = 30_000;
const WAIT_POLL_MS = 10_000;
const AUTOSAVE_MS = 3_000;

const enc = encodeURIComponent;

/** An error response with its JSON body: 409 carries `currentVersion`, 423 and the lock 409 carry `lock`. */
export class WikiApiError extends ApiError {
	body: {
		error?: string;
		message?: string;
		currentVersion?: number;
		lock?: LockInfo | null;
	};

	constructor(status: number, message: string, body: WikiApiError["body"]) {
		super(status, message);
		this.body = body;
	}
}

const json = (method: string, value: unknown): RequestInit => ({
	method,
	body: JSON.stringify(value),
});

// The lock routes' errors carry data (`currentVersion`, `lock`), so this keeps the
// parsed body; the session-expired and message rules come from `#lib/api.ts`.
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
	const headers = new Headers(init.headers);
	headers.set("X-Requested-With", "rvna");
	if (init.body !== undefined && !headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}
	const response = await fetch(path, { ...init, headers });
	if (response.status === 401) {
		redirectToLogin();
		throw new ApiError(401, "Unauthorized");
	}
	if (!response.ok) {
		let body: WikiApiError["body"] = {};
		try {
			body = (await response.json()) as WikiApiError["body"];
		} catch {
			// not JSON; the status text stands
		}
		throw new WikiApiError(
			response.status,
			errorMessageFromBody(body, response.statusText),
			body,
		);
	}
	if (response.status === 204) return undefined as T;
	return (await response.json()) as T;
}

export const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : "Something went wrong";

export const acquireLock = (pageId: string, takeOver = false) =>
	call<{ acquired: boolean; lock: LockInfo | null }>(
		`/api/wiki/pages/${enc(pageId)}/lock`,
		json("POST", { takeOver }),
	).catch((error: unknown) => {
		if (error instanceof WikiApiError && error.status === 409) {
			return {
				acquired: false,
				lock: error.body.lock ?? null,
			};
		}
		throw error;
	});

export const heartbeat = (pageId: string) =>
	call<{ status: "ok" | "lost" | "expired"; lock: LockInfo | null }>(
		`/api/wiki/pages/${enc(pageId)}/lock/heartbeat`,
		{ method: "POST" },
	);

export const releaseLock = (pageId: string, keepalive = false) =>
	call<void>(`/api/wiki/pages/${enc(pageId)}/lock`, {
		method: "DELETE",
		keepalive,
	});

export const saveDraft = (pageId: string, input: SaveDraftInput) =>
	call<{ id: string; updatedAt: string }>(
		`/api/wiki/pages/${enc(pageId)}/draft`,
		json("PUT", input),
	);

export const discardDraft = (pageId: string) =>
	call<void>(`/api/wiki/pages/${enc(pageId)}/draft`, { method: "DELETE" });

export type LockState =
	| { kind: "acquiring" }
	| { kind: "held" }
	| { kind: "blocked"; lock: LockInfo | null }
	| { kind: "lost"; lock: LockInfo | null }
	| { kind: "error"; message: string };

const ignore = () => undefined;

export class EditLock {
	state = $state<LockState>({ kind: "acquiring" });
	waiting = $state(false);

	readonly #pageId: string;
	#held = false;
	#cancelled = false;
	#queue: Promise<unknown> = Promise.resolve();
	#heartbeat: ReturnType<typeof setInterval> | undefined;
	#waitTimer: ReturnType<typeof setInterval> | undefined;

	constructor(pageId: string) {
		this.#pageId = pageId;
	}

	get holding() {
		return this.state.kind === "held";
	}

	start() {
		this.#cancelled = false;
		this.#queue = this.#queue.then(async () => {
			if (this.#cancelled) return;
			try {
				const result = await acquireLock(this.#pageId);
				if (result.acquired) this.#held = true;
				if (this.#cancelled) return;
				if (result.acquired) this.#acquired();
				else this.state = { kind: "blocked", lock: result.lock };
			} catch (error) {
				if (!this.#cancelled) {
					this.state = { kind: "error", message: errorMessage(error) };
				}
			}
		});
	}

	stop() {
		this.#cancelled = true;
		this.#stopHeartbeat();
		this.#stopWait();
		this.#queue = this.#queue.then(() => {
			if (!this.#held) return;
			this.#held = false;
			return releaseLock(this.#pageId).catch(ignore);
		});
	}

	#acquired() {
		this.#held = true;
		this.waiting = false;
		this.state = { kind: "held" };
		this.#startHeartbeat();
		this.#stopWait();
	}

	#startHeartbeat() {
		this.#stopHeartbeat();
		this.#heartbeat = setInterval(async () => {
			try {
				const result = await heartbeat(this.#pageId);
				if (result.status === "ok") return;
				const again =
					result.status === "expired" ? await acquireLock(this.#pageId) : null;
				if (again?.acquired) return;
				this.#held = false;
				this.#stopHeartbeat();
				this.state = { kind: "lost", lock: again?.lock ?? result.lock };
			} catch {
				// a failed beat is retried at the next tick
			}
		}, HEARTBEAT_MS);
	}

	#stopHeartbeat() {
		if (this.#heartbeat !== undefined) {
			clearInterval(this.#heartbeat);
			this.#heartbeat = undefined;
		}
	}

	#startWait() {
		this.#stopWait();
		this.#waitTimer = setInterval(() => {
			acquireLock(this.#pageId).then((result) => {
				if (result.acquired) this.#acquired();
			}, ignore);
		}, WAIT_POLL_MS);
	}

	#stopWait() {
		if (this.#waitTimer !== undefined) {
			clearInterval(this.#waitTimer);
			this.#waitTimer = undefined;
		}
	}

	setWaiting(next: boolean) {
		this.waiting = next;
		if (next && this.state.kind === "blocked") this.#startWait();
		else this.#stopWait();
	}

	async takeOver() {
		try {
			const result = await acquireLock(this.#pageId, true);
			if (result.acquired) this.#acquired();
			else this.state = { kind: "blocked", lock: result.lock };
		} catch (error) {
			this.state = { kind: "error", message: errorMessage(error) };
		}
	}

	/** Another editor holds the lock (a write was refused with 423). */
	markLost(lock: LockInfo | null) {
		this.#held = false;
		this.#stopHeartbeat();
		this.#stopWait();
		this.state = { kind: "lost", lock };
	}

	releaseOnPageHide() {
		if (this.#held) void releaseLock(this.#pageId, true).catch(ignore);
	}
}

export type SaveStatus =
	| { kind: "idle" }
	| { kind: "saving" }
	| { kind: "saved"; at: Date }
	| { kind: "error" };

/**
 * Saves the draft about three seconds after the last change, one request at a time. A failed
 * request leaves a copy in localStorage and keeps the changes marked unsaved.
 */
export class Autosave {
	status = $state<SaveStatus>({ kind: "idle" });

	readonly #pageId: string;
	readonly #getPayload: () => SaveDraftInput;
	#dirty = false;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#inflight: Promise<boolean> | null = null;

	constructor(pageId: string, getPayload: () => SaveDraftInput) {
		this.#pageId = pageId;
		this.#getPayload = getPayload;
	}

	run = async (): Promise<boolean> => {
		clearTimeout(this.#timer);
		while (this.#inflight) await this.#inflight;
		if (!this.#dirty) return true;
		const payload = this.#getPayload();
		this.#dirty = false;
		this.status = { kind: "saving" };
		const request = saveDraft(this.#pageId, payload)
			.then(
				() => {
					if (!this.#dirty) clearLocalDraft(localStorage, this.#pageId);
					this.status = { kind: "saved", at: new Date() };
					return true;
				},
				() => {
					this.#dirty = true;
					writeLocalDraft(localStorage, this.#pageId, payload);
					this.status = { kind: "error" };
					return false;
				},
			)
			.finally(() => {
				this.#inflight = null;
			});
		this.#inflight = request;
		return request;
	};

	touch = () => {
		this.#dirty = true;
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.run(), AUTOSAVE_MS);
	};

	/** Cancel the pending save and wait for the one in flight (before a publish). */
	settle = async () => {
		clearTimeout(this.#timer);
		while (this.#inflight) await this.#inflight;
	};

	/** Forget pending changes (after a publish or a discard). */
	reset = () => {
		clearTimeout(this.#timer);
		this.#dirty = false;
		clearLocalDraft(localStorage, this.#pageId);
	};

	isDirty = () => this.#dirty || this.#inflight !== null;

	keepLocalCopy = () => {
		if (this.#dirty) {
			writeLocalDraft(localStorage, this.#pageId, this.#getPayload());
		}
	};

	dispose() {
		clearTimeout(this.#timer);
		this.keepLocalCopy();
	}
}
