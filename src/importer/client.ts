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
		this.active++;
	}

	release() {
		this.active--;
		this.waiting.shift()?.();
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

export class GetOnlyClient {
	private readonly baseUrl: string;
	private readonly token: string;
	private readonly semaphore: Semaphore;
	private readonly maxAttempts: number;
	private readonly baseDelayMs: number;
	private readonly timeoutMs: number;
	private readonly fetchImpl: typeof fetch;

	constructor(options: GetOnlyClientOptions) {
		this.baseUrl = options.baseUrl;
		this.token = options.token;
		this.semaphore = new Semaphore(options.concurrency ?? 4);
		this.maxAttempts = options.maxAttempts ?? 6;
		this.baseDelayMs = options.baseDelayMs ?? 500;
		this.timeoutMs = options.timeoutMs ?? 120_000;
		this.fetchImpl = options.fetchImpl ?? fetch;
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
		for (const [key, value] of Object.entries(params ?? {})) {
			if (value !== undefined) url.searchParams.set(key, String(value));
		}

		for (let attempt = 0; ; attempt++) {
			await this.semaphore.acquire();
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
					const delay =
						Number.isFinite(retryAfter) && retryAfter > 0
							? Math.min(30_000, retryAfter * 1000)
							: Math.min(
									30_000,
									this.baseDelayMs * 2 ** attempt + Math.random() * 250,
								);
					await sleep(delay);
					continue;
				}

				if (!response.ok) {
					await response.body?.cancel();
					throw new GetOnlyRequestError(response.status, url.pathname);
				}

				return response;
			} catch (error) {
				if (error instanceof GetOnlyRequestError) throw error;
				if (attempt + 1 >= this.maxAttempts) throw error;
				await sleep(
					Math.min(
						30_000,
						this.baseDelayMs * 2 ** attempt + Math.random() * 250,
					),
				);
			} finally {
				this.semaphore.release();
			}
		}
	}

	async getJson<T>(
		path: string,
		params?: Record<string, QueryValue>,
		options: GetOnlyRequestOptions = {},
	): Promise<T> {
		const response = await this.request("GET", path, params, options);
		return (await response.json()) as T;
	}

	async getBytes(path: string): Promise<Buffer> {
		const response = await this.request("GET", path);
		return Buffer.from(await response.arrayBuffer());
	}
}
