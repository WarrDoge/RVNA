import { Server } from "../build/server/index.js";
import { manifest } from "../build/server/manifest.js";

export type InjectOptions = {
	method?: string;
	url: string;
	headers?: Record<string, string | string[]>;
	cookies?: Record<string, string>;
	payload?: unknown;
	remoteAddress?: string;
};

export type InjectResponse = {
	statusCode: number;
	headers: Record<string, string | string[]> & { location?: string };
	body: string;
	rawPayload: Buffer;
	// biome-ignore lint/suspicious/noExplicitAny: tests read fields of whatever the route answered
	json: () => any;
};

let server: InstanceType<typeof Server> | null = null;
let ready: Promise<void> | null = null;

async function start() {
	server = new Server(manifest);
	await server.init({ env: process.env, read: () => null });
}

function headersFrom(options: InjectOptions) {
	const headers = new Headers();
	for (const [name, value] of Object.entries(options.headers ?? {})) {
		if (Array.isArray(value)) {
			for (const item of value) headers.append(name, item);
		} else {
			headers.set(name, value);
		}
	}
	if (options.cookies && Object.keys(options.cookies).length > 0) {
		const cookie = Object.entries(options.cookies)
			.map(([name, value]) => `${name}=${value}`)
			.join("; ");
		const existing = headers.get("cookie");
		headers.set("cookie", existing ? `${existing}; ${cookie}` : cookie);
	}
	return headers;
}

function requestBody(payload: unknown) {
	if (payload === undefined) return { body: undefined, contentType: undefined };
	if (Buffer.isBuffer(payload)) {
		return {
			body: new Uint8Array(payload),
			contentType: "application/octet-stream",
		};
	}
	if (typeof payload === "string") {
		return { body: payload, contentType: "text/plain;charset=utf-8" };
	}
	return { body: JSON.stringify(payload), contentType: "application/json" };
}

async function inject(options: InjectOptions): Promise<InjectResponse> {
	if (!ready) ready = start();
	await ready;
	const method = (options.method ?? "GET").toUpperCase();
	const headers = headersFrom(options);
	const withBody = method !== "GET" && method !== "HEAD";
	const { body, contentType } = withBody
		? requestBody(options.payload)
		: { body: undefined, contentType: undefined };
	if (body !== undefined && !headers.has("content-type") && contentType) {
		headers.set("content-type", contentType);
	}

	const target = options.url.startsWith("http")
		? options.url
		: `http://127.0.0.1:3000${options.url}`;
	const request = new Request(target, {
		method,
		headers,
		body,
	});
	const active = server;
	if (!active) throw new Error("The built SvelteKit server is not initialised");
	const response = await active.respond(request, {
		getClientAddress: () => options.remoteAddress ?? "127.0.0.1",
		platform: {},
	});

	const rawPayload = Buffer.from(await response.arrayBuffer());
	const responseHeaders: Record<string, string | string[]> = {};
	for (const [name, value] of response.headers) {
		if (name !== "set-cookie") responseHeaders[name] = value;
	}
	const setCookie = response.headers.getSetCookie();
	if (setCookie.length > 0) responseHeaders["set-cookie"] = setCookie;

	return {
		statusCode: response.status,
		headers: responseHeaders,
		body: rawPayload.toString("utf8"),
		rawPayload,
		json: () => JSON.parse(rawPayload.toString("utf8")),
	};
}

/** The handle the tests use: requests go straight into the built SvelteKit server. */
export type TestApp = {
	inject: (options: InjectOptions) => Promise<InjectResponse>;
	ready: () => Promise<void>;
	close: () => Promise<void>;
};

export function buildServer(): TestApp {
	return {
		inject,
		ready: async () => {
			if (!ready) ready = start();
			await ready;
		},
		close: async () => {},
	};
}
