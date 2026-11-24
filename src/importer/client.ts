export interface GetOnlyClientOptions {
	baseUrl: string;
	token: string;
	concurrency?: number;
	maxAttempts?: number;
	baseDelayMs?: number;
	timeoutMs?: number;
	fetchImpl?: typeof fetch;
}

export class GetOnlyRequestError extends Error {
	readonly status: number;
	readonly path: string;

	constructor(status: number, path: string) {
		super(`request failed with status ${status}: ${path}`);
		this.name = "GetOnlyRequestError";
		this.status = status;
		this.path = path;
	}
}

export type QueryValue = string | number | boolean | undefined;

/** A single download larger than this is refused, so a server cannot fill memory and disk. */
export const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024;

export interface GetBytesOptions {
	/** Defaults to MAX_DOWNLOAD_BYTES. */
	maxBytes?: number;
	/** Time allowed to read the body once the headers arrived; defaults to the client's request timeout. */
	timeoutMs?: number;
}

async function readBounded(
	response: Response,
	path: string,
	maxBytes: number,
	timeoutMs: number,
): Promise<Buffer> {
	const tooLarge = () =>
		new Error(`download is larger than ${maxBytes} bytes: ${path}`);
	if (Number(response.headers.get("content-length")) > maxBytes) {
		await response.body?.cancel();
		throw tooLarge();
	}
	if (!response.body) return Buffer.alloc(0);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		void reader.cancel();
	}, timeoutMs);
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (timedOut) {
				throw new Error(
					`download did not finish within ${timeoutMs} ms: ${path}`,
				);
			}
			if (done) break;
			total += value.length;
			if (total > maxBytes) {
				await reader.cancel();
				throw tooLarge();
			}
			chunks.push(value);
		}
	} finally {
		clearTimeout(timer);
	}
	return Buffer.concat(chunks, total);
}

export interface GetOnlyRequestOptions {
	headers?: Record<string, string>;
}

class Semaphore {
	private active = 0;
	private readonly waiting: (() => void)[] = [];
	private readonly limit: number;

	constructor(limit: number) {
		this.limit = limit;
	}

	async acquire() {
		if (this.active < this.limit) {
			this.active++;
			return;
		}
		await new Promise<void>((resolve) => this.waiting.push(resolve));
	}

	release() {
		const waiter = this.waiting.shift();
		if (waiter) {
			waiter();
			return;
		}
		this.active--;
	}
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** An id from the remote server becomes a file name; it must not be able to leave the target directory. */
export function pathSegment(id: string | number) {
	const segment = String(id);
	if (!/^[\w-]+$/.test(segment)) {
		throw new Error(`unsafe id for a file name: ${JSON.stringify(segment)}`);
	}
	return segment;
}

/** More pages than this in one list means the server is paging for ever. */
export const MAX_PAGES = 10_000;

/**
 * The server decides where a list ends, so a loop cannot rely on it. Call the
 * returned function with the ids of each non-empty page: it fails when the
 * list passes MAX_PAGES pages or a page brings no id it has not seen yet. With
 * `onStop` it reports the reason there and returns false instead of throwing.
 */
export function pageGuard(
	what: string,
	onStop?: (reason: string) => void,
): (ids: Iterable<string | number | undefined>) => boolean {
	const seen = new Set<string | number | undefined>();
	let pages = 0;
	return (ids) => {
		let fresh = false;
		let any = false;
		for (const id of ids) {
			any = true;
			if (!seen.has(id)) {
				seen.add(id);
				fresh = true;
			}
		}
		pages++;
		let reason: string | null = null;
		if (pages > MAX_PAGES) reason = `more than ${MAX_PAGES} pages`;
		else if (any && !fresh) reason = "a page brought no new rows";
		if (reason === null) return true;
		if (!onStop) throw new Error(`paging did not finish (${reason}): ${what}`);
		console.warn(`pagination did not finish at ${what}: ${reason}`);
		onStop(reason);
		return false;
	};
}

export class GetOnlyClient {
	private readonly baseUrl: string;
	private readonly token: string;
	private readonly semaphore: Semaphore;
	private readonly maxAttempts: number;
	private readonly baseDelayMs: number;
	private readonly timeoutMs: number;
	private readonly fetchImpl: typeof fetch;

	constructor(options: GetOnlyClientOptions) {
		const concurrency = options.concurrency ?? 4;
		if (!Number.isInteger(concurrency) || concurrency <= 0) {
			throw new Error("concurrency must be a positive integer");
		}
		const maxAttempts = options.maxAttempts ?? 6;
		if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
			throw new Error("maxAttempts must be a positive integer");
		}
		const timeoutMs = options.timeoutMs ?? 120_000;
		if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
			throw new Error("timeoutMs must be a positive number");
		}
		this.baseUrl = options.baseUrl;
		this.token = options.token;
		this.semaphore = new Semaphore(concurrency);
		this.maxAttempts = maxAttempts;
		this.baseDelayMs = options.baseDelayMs ?? 500;
		this.timeoutMs = timeoutMs;
		this.fetchImpl = options.fetchImpl ?? fetch;
	}

	private retryDelay(attempt: number, retryAfter?: number) {
		if (
			retryAfter !== undefined &&
			Number.isFinite(retryAfter) &&
			retryAfter > 0
		) {
			return Math.min(30_000, retryAfter * 1000);
		}
		return Math.min(
			30_000,
			this.baseDelayMs * 2 ** attempt + Math.random() * 250,
		);
	}

	async request(
		method: string,
		path: string,
		params?: Record<string, QueryValue>,
		options: GetOnlyRequestOptions = {},
	): Promise<Response> {
		if (method !== "GET") {
			throw new Error(`client only allows GET requests, got ${method}`);
		}

		const url = new URL(path, this.baseUrl);
		// An address from a response must not carry the token to another host.
		// `fetch` itself drops the Authorization header on a redirect to another origin.
		if (url.origin !== new URL(this.baseUrl).origin) {
			throw new Error(
				`refusing to send the access token to ${url.origin}: not the configured server`,
			);
		}
		for (const name of Object.keys(options.headers ?? {})) {
			if (name.toLowerCase() === "authorization") {
				throw new Error(
					"the client sets the Authorization header; remove it from the request options",
				);
			}
		}
		for (const [key, value] of Object.entries(params ?? {})) {
			if (value !== undefined) url.searchParams.set(key, String(value));
		}

		for (let attempt = 0; ; attempt++) {
			await this.semaphore.acquire();
			let delay: number | null = null;
			try {
				const response = await this.fetchImpl(url, {
					method: "GET",
					headers: {
						Authorization: `Bearer ${this.token}`,
						Accept: "application/json",
						...options.headers,
					},
					redirect: "follow",
					signal: AbortSignal.timeout(this.timeoutMs),
				});

				if (response.status === 429 || response.status >= 500) {
					if (attempt + 1 >= this.maxAttempts) {
						await response.body?.cancel();
						throw new GetOnlyRequestError(response.status, url.pathname);
					}
					const retryAfter = Number(response.headers.get("retry-after"));
					await response.body?.cancel();
					delay = this.retryDelay(attempt, retryAfter);
				} else if (!response.ok) {
					await response.body?.cancel();
					throw new GetOnlyRequestError(response.status, url.pathname);
				} else {
					return response;
				}
			} catch (error) {
				if (error instanceof GetOnlyRequestError) throw error;
				if (attempt + 1 >= this.maxAttempts) throw error;
				delay = this.retryDelay(attempt);
			} finally {
				this.semaphore.release();
			}
			if (delay !== null) await sleep(delay);
		}
	}

	/** The request permit ends with the headers; hold a slot again while the body is read. */
	private async readBody<T>(
		response: Response,
		read: (response: Response) => Promise<T>,
	) {
		await this.semaphore.acquire();
		try {
			return await read(response);
		} finally {
			this.semaphore.release();
		}
	}

	async getJson<T>(
		path: string,
		params?: Record<string, QueryValue>,
		options: GetOnlyRequestOptions = {},
	): Promise<T> {
		const response = await this.request("GET", path, params, options);
		return this.readBody(response, async (value) => (await value.json()) as T);
	}

	async getBytes(path: string, options: GetBytesOptions = {}): Promise<Buffer> {
		const response = await this.request("GET", path);
		return this.readBody(response, (value) =>
			readBounded(
				value,
				path,
				options.maxBytes ?? MAX_DOWNLOAD_BYTES,
				options.timeoutMs ?? this.timeoutMs,
			),
		);
	}
}
