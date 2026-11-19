import { STATUS_CODES } from "node:http";
import type { RequestEvent, RequestHandler } from "@sveltejs/kit";
import type { z } from "zod";
import type { CurrentUser } from "./auth.ts";
import {
	rejectArchivedWriteFor,
	resolvePreviousKeysFor,
	routePattern,
} from "./project-keys.ts";

export class HttpError extends Error {
	readonly status: number;
	readonly headers: HeadersInit | undefined;
	readonly details: Record<string, unknown> | undefined;

	/** `details` are extra fields merged into the `{ error }` body; `headers` go on the response. */
	constructor(
		status: number,
		message: string,
		options?: { headers?: HeadersInit; details?: Record<string, unknown> },
	) {
		super(message);
		this.name = "HttpError";
		this.status = status;
		this.headers = options?.headers;
		this.details = options?.details;
	}
}

type Locals = { user: CurrentUser | null };
type Schema = z.ZodType;
type Auth = "user" | "admin" | "none";
type Output<T> = T extends Schema ? z.output<T> : undefined;
type Actor<A extends Auth> = A extends "none" ? null : CurrentUser;
/** A `response` map: the schema of each status code that has one. */
type ResponseMap = { [status: number]: Schema };
type SuccessStatus = 200 | 201 | 202 | 203;
type ResponseBody<R> = R extends Schema
	? z.output<R>
	: R extends ResponseMap
		? [Extract<keyof R, SuccessStatus>] extends [never]
			? unknown
			: z.output<R[Extract<keyof R, SuccessStatus>]>
		: unknown;
type EndpointReturn<R> =
	| Response
	| ResponseBody<R>
	| { status: number; body?: unknown };
type MaybePromise<T> = T | Promise<T>;

/** The default `bodyLimit`: a JSON body may be 1 MiB unless the route raises it. */
export const DEFAULT_BODY_LIMIT = 1024 * 1024;

const mutating = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Every request body is parsed before the handler, even on routes without a body
 * schema; a multipart body is left for the upload helper to read.
 */
async function parseBodyWithoutSchema(
	request: Request,
	options: Pick<EndpointOptions, "bodyLimit">,
) {
	const type = request.headers
		.get("content-type")
		?.split(";")[0]
		?.trim()
		.toLowerCase();
	if (type === "multipart/form-data") return undefined;
	return requestBody(request, options.bodyLimit ?? DEFAULT_BODY_LIMIT);
}

export type EndpointOptions = {
	params?: Schema;
	query?: Schema;
	body?: Schema;
	response?: Schema | ResponseMap;
	auth?: Auth;
	/** Largest request body in bytes, default `DEFAULT_BODY_LIMIT`. */
	bodyLimit?: number;
	/** `"jira"` answers errors as `{ errorMessages, errors }`, for `/rest/api/2/**`. */
	errors?: "default" | "jira";
	/** The handler reads the request body itself, so `endpoint()` leaves it untouched. */
	rawBody?: boolean;
	/** An area's own validation body, e.g. the wiki editor's `<where>: <message>`. */
	validationError?: (
		error: z.ZodError,
		context: string,
	) => { status?: number; body: unknown };
};

/** The one JSON response: `application/json; charset=utf-8`. */
export function jsonResponse(body: unknown, init: ResponseInit = {}) {
	const headers = new Headers(init.headers);
	if (!headers.has("content-type")) {
		headers.set("content-type", "application/json; charset=utf-8");
	}
	return new Response(JSON.stringify(body), { ...init, headers });
}

export function requireUser(locals: Locals): CurrentUser {
	if (!locals.user) throw new HttpError(401, "Unauthorized");
	return locals.user;
}

export function requireAdmin(locals: Locals): CurrentUser {
	const user = requireUser(locals);
	if (!user.isAdmin) throw new HttpError(403, "Forbidden");
	return user;
}

export function isBearer(request: { headers: Headers }): boolean {
	return /^Bearer .+$/i.test(request.headers.get("authorization") ?? "");
}

export function isHttpError(error: unknown): error is HttpError {
	return error instanceof HttpError;
}

function validationBody(context: string, error: z.ZodError) {
	const message = error.issues
		.map((issue) => `${context}/${issue.path.join("/")} ${issue.message}`)
		.join(", ");
	return {
		statusCode: 400,
		code: "FST_ERR_VALIDATION",
		error: "Bad Request",
		message,
	};
}

/** A request the parser or validator refused, answered with the API's validation body. */
class ValidationError {
	readonly status: number;
	readonly body: unknown;

	constructor(body: unknown, status = 400) {
		this.body = body;
		this.status = status;
	}
}

function parse<T extends Schema>(
	schema: T,
	value: unknown,
	context: string,
	format?: EndpointOptions["validationError"],
): z.output<T> {
	const result = schema.safeParse(value);
	if (!result.success) {
		if (format) {
			const formatted = format(result.error, context);
			throw new ValidationError(formatted.body, formatted.status ?? 400);
		}
		throw new ValidationError(validationBody(context, result.error));
	}
	return result.data;
}

/** A body-parser error: `endpoint()` maps it to its validation response. */
export class BodyParseError extends Error {
	readonly status: number;
	readonly body: {
		statusCode: number;
		code: string;
		error: string;
		message: string;
	};

	constructor(code: string, message: string, status = 400) {
		super(message);
		this.name = "BodyParseError";
		this.status = status;
		this.body = {
			statusCode: status,
			code,
			error: STATUS_CODES[status] ?? "Error",
			message,
		};
	}
}

function bodyParserError(code: string, message: string, status = 400) {
	return new BodyParseError(code, message, status);
}

const bodyTooLarge = () =>
	bodyParserError(
		"FST_ERR_CTP_BODY_TOO_LARGE",
		"Request body is too large",
		413,
	);

/** The body as text, refused before it is buffered when it passes `limit` bytes. */
async function readText(request: Request, limit: number) {
	if (Number(request.headers.get("content-length")) > limit) {
		throw bodyTooLarge();
	}
	if (!request.body) return "";
	const decoder = new TextDecoder();
	let received = 0;
	let text = "";
	for await (const chunk of request.body) {
		received += chunk.length;
		if (received > limit) throw bodyTooLarge();
		text += decoder.decode(chunk, { stream: true });
	}
	return text + decoder.decode();
}

/**
 * Parses like secure-json-parse: a `__proto__` key or a
 * `constructor` that holds a `prototype` is refused as invalid JSON.
 */
function secureJsonParse(text: string): unknown {
	return JSON.parse(text, (key, value) => {
		if (
			key === "__proto__" ||
			(key === "constructor" &&
				typeof value === "object" &&
				value !== null &&
				Object.hasOwn(value, "prototype"))
		) {
			throw new SyntaxError("Object contains forbidden prototype property");
		}
		return value;
	});
}

/**
 * The accepted bodies: `application/json` is JSON, `text/plain` is a string,
 * any other media type with a body is a 415, and no body at all is `null`.
 */
export function parseBodyText(
	text: string,
	contentType: string | null,
): unknown {
	const type = contentType?.split(";")[0]?.trim().toLowerCase();
	if (type === "application/json") {
		if (text === "") {
			throw bodyParserError(
				"FST_ERR_CTP_EMPTY_JSON_BODY",
				"Body cannot be empty when content-type is set to 'application/json'",
			);
		}
		try {
			return secureJsonParse(text);
		} catch {
			throw bodyParserError(
				"FST_ERR_CTP_INVALID_JSON_BODY",
				"Body is not valid JSON but content-type is set to 'application/json'",
			);
		}
	}
	if (type === "text/plain") return text;
	if (text === "" && !type) return null;
	throw bodyParserError(
		"FST_ERR_CTP_INVALID_MEDIA_TYPE",
		"Unsupported Media Type",
		415,
	);
}

async function requestBody(request: Request, limit: number): Promise<unknown> {
	try {
		return parseBodyText(
			await readText(request, limit),
			request.headers.get("content-type"),
		);
	} catch (error) {
		if (error instanceof BodyParseError) {
			throw new ValidationError(error.body, error.status);
		}
		throw error;
	}
}

function queryObject(url: URL) {
	const query = Object.create(null) as Record<string, string | string[]>;
	for (const [name, value] of url.searchParams) {
		const current = query[name];
		if (current === undefined) query[name] = value;
		else if (Array.isArray(current)) current.push(value);
		else query[name] = [current, value];
	}
	return query;
}

function isStatusResult(
	value: unknown,
): value is { status: number; body?: unknown } {
	return (
		typeof value === "object" &&
		value !== null &&
		"status" in value &&
		typeof value.status === "number"
	);
}

function isSchema(value: unknown): value is Schema {
	return (
		typeof value === "object" &&
		value !== null &&
		"safeParse" in value &&
		typeof value.safeParse === "function"
	);
}

/** A single `response` schema parses every handler result; a map has one schema per status. */
function schemaFor(response: EndpointOptions["response"], status: number) {
	if (!response) return undefined;
	return isSchema(response) ? response : response[status];
}

function jiraError(status: number, message: string) {
	return jsonResponse({ errorMessages: [message], errors: {} }, { status });
}

function errorResponse(
	error: unknown,
	options: Pick<EndpointOptions, "response" | "errors">,
) {
	const { response } = options;
	if (options.errors === "jira") {
		if (error instanceof ValidationError) {
			const body = error.body as { message?: unknown };
			return jiraError(
				error.status,
				typeof body.message === "string" ? body.message : "Invalid input",
			);
		}
		if (isHttpError(error)) return jiraError(error.status, error.message);
		console.error(error);
		return jiraError(500, "Internal server error");
	}
	if (error instanceof ValidationError) {
		// A validation error goes through the route's 400 schema.
		const schema = response && !isSchema(response) ? response[400] : undefined;
		const parsed = schema?.safeParse(error.body);
		return jsonResponse(parsed?.success ? parsed.data : error.body, {
			status: error.status,
		});
	}
	if (isHttpError(error)) {
		return jsonResponse(
			{ error: error.message, ...error.details },
			{ status: error.status, headers: error.headers },
		);
	}
	console.error(error);
	return jsonResponse({ error: "Internal server error" }, { status: 500 });
}

export async function prepareWrite(
	event: RequestEvent,
	params: Record<string, unknown>,
	body: unknown,
) {
	await resolvePreviousKeysFor(params, body);
	const message = await rejectArchivedWriteFor({
		method: event.request.method,
		route: routePattern(event.route.id ?? ""),
		params,
		body,
	});
	if (message) throw new HttpError(403, message);
}

/**
 * The one endpoint wrapper: SvelteKit's RequestEvent in, RequestHandler out, zod
 * validation and response parsing, HttpError to `{ error }`, and the moved-route
 * write guards (previous project keys, archived projects).
 */
export function endpoint<
	P extends Schema | undefined = undefined,
	Q extends Schema | undefined = undefined,
	B extends Schema | undefined = undefined,
	R extends Schema | ResponseMap | undefined = undefined,
	A extends Auth = "user",
>(
	options: EndpointOptions & {
		params?: P;
		query?: Q;
		body?: B;
		response?: R;
		auth?: A;
	},
	handler: (input: {
		event: RequestEvent;
		params: Output<P>;
		query: Output<Q>;
		body: Output<B>;
		actor: Actor<A>;
	}) => MaybePromise<EndpointReturn<R>>,
): RequestHandler {
	return async (event) => {
		try {
			let actor: CurrentUser | null = null;
			const auth = options.auth ?? "user";
			if (auth === "user") actor = requireUser(event.locals);
			if (auth === "admin") actor = requireAdmin(event.locals);

			const params = options.params
				? parse(options.params, event.params, "params", options.validationError)
				: event.params;
			const query = options.query
				? parse(
						options.query,
						queryObject(event.url),
						"querystring",
						options.validationError,
					)
				: undefined;
			const body = options.body
				? parse(
						options.body,
						await requestBody(
							event.request,
							options.bodyLimit ?? DEFAULT_BODY_LIMIT,
						),
						"body",
						options.validationError,
					)
				: options.rawBody || !mutating.has(event.request.method)
					? undefined
					: await parseBodyWithoutSchema(event.request, options);

			await prepareWrite(event, params as Record<string, unknown>, body);

			const result = await handler({
				event,
				params: params as Output<P>,
				query: query as Output<Q>,
				body: body as Output<B>,
				actor: actor as Actor<A>,
			});

			if (result instanceof Response) return result;
			const status = isStatusResult(result) ? result.status : 200;
			const payload = isStatusResult(result) ? result.body : result;
			if (status === 204) return new Response(null, { status });
			const schema = schemaFor(options.response, status);
			if (schema) {
				const parsed = schema.safeParse(payload);
				if (!parsed.success) {
					console.error(parsed.error);
					if (options.errors === "jira") {
						return jiraError(500, "Internal server error");
					}
					return jsonResponse(
						{ error: "Internal server error" },
						{ status: 500 },
					);
				}
				return jsonResponse(parsed.data, { status });
			}
			return jsonResponse(payload, { status });
		} catch (error) {
			return errorResponse(error, options);
		}
	};
}
