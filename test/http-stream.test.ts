import type { RequestEvent } from "@sveltejs/kit";
import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { endpoint, HttpError } from "../src/lib/server/http.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

function eventFor(request: Request) {
	return {
		request,
		url: new URL(request.url),
		locals: { user: null },
		params: {},
		route: { id: "/stream" },
	} as unknown as RequestEvent;
}

function eventWithBody(stream: ReadableStream<Uint8Array>) {
	return eventFor(
		new Request("http://127.0.0.1/stream", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: stream,
			duplex: "half",
		} as RequestInit),
	);
}

test("a body stream that fails is a client error, not a logged 500", async () => {
	const logged = vi.spyOn(console, "error").mockImplementation(() => {});
	const handler = endpoint(
		{ auth: "none", body: z.object({ name: z.string() }) },
		async () => ({ ok: true }),
	);
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('{"name":'));
			controller.error(
				Object.assign(new Error("aborted"), { code: "ECONNRESET" }),
			);
		},
	});

	const response = await handler(eventWithBody(stream));

	expect(response.status).toBe(400);
	expect(await response.json()).toMatchObject({
		statusCode: 400,
		code: "FST_ERR_CTP_INVALID_BODY",
		message: "Request body could not be read",
	});
	expect(logged).not.toHaveBeenCalled();
});

test("a Jira error keeps the headers of the domain error", async () => {
	const handler = endpoint({ auth: "none", errors: "jira" }, async () => {
		throw new HttpError(401, "You are not authenticated", {
			headers: { "WWW-Authenticate": "Bearer" },
		});
	});

	const response = await handler(
		eventFor(new Request("http://127.0.0.1/stream")),
	);

	expect(response.status).toBe(401);
	expect(response.headers.get("www-authenticate")).toBe("Bearer");
	expect(await response.json()).toEqual({
		errorMessages: ["You are not authenticated"],
		errors: {},
	});
});
