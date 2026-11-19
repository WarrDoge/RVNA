import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

/**
 * Every expected answer below was captured from Fastify 5 with the zod type provider and the
 * error handler of the old `buildServer()`, for the same request, before the routes moved.
 */
const run = randomUUID().slice(0, 8);
const json = "application/json";
const url = "/api/me/tokens"; // a moved endpoint with a body schema and no 400 schema
let app: TestApp;
let sid: string;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	const username = `t-${run}-parity`;
	const signedIn = await login(app, {
		sub: `sub-${username}`,
		username,
		name: username,
		groups: [],
	});
	sid = signedIn.sessionId as string;
});

afterAll(async () => {
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

function post(headers: Record<string, string>, payload?: string | Buffer) {
	return app.inject({
		method: "POST",
		url,
		cookies: { sid },
		headers: { "x-requested-with": "rvna", ...headers },
		payload: payload as never,
	});
}

const refused = (
	statusCode: number,
	code: string,
	error: string,
	message: string,
) => ({
	statusCode,
	code,
	error,
	message,
});

const unsupported = refused(
	415,
	"FST_ERR_CTP_INVALID_MEDIA_TYPE",
	"Unsupported Media Type",
	"Unsupported Media Type",
);
const tooLarge = refused(
	413,
	"FST_ERR_CTP_BODY_TOO_LARGE",
	"Payload Too Large",
	"Request body is too large",
);
const invalidJson = refused(
	400,
	"FST_ERR_CTP_INVALID_JSON_BODY",
	"Bad Request",
	"Body is not valid JSON but content-type is set to 'application/json'",
);
const invalid = (message: string) =>
	refused(400, "FST_ERR_VALIDATION", "Bad Request", message);

test("1. a JSON body is limited to 1 MiB, by Content-Length first and while reading", async () => {
	const big = JSON.stringify({ name: "a".repeat(1024 * 1024) });
	const read = await post({ "content-type": json }, big);
	expect([read.statusCode, read.json()]).toEqual([413, tooLarge]);

	const declared = await post(
		{ "content-type": json, "content-length": "2000000" },
		'{"name":"x"}',
	);
	expect([declared.statusCode, declared.json()]).toEqual([413, tooLarge]);
});

test("2. only application/json is JSON, text/plain is a string, other media types are 415", async () => {
	for (const [type, payload] of [
		["application/xml", "<a/>"],
		["application/x-www-form-urlencoded", "name=x"],
		["application/ld+json", '{"name":"x"}'],
	] as const) {
		const response = await post({ "content-type": type }, payload);
		expect([type, response.statusCode, response.json()]).toEqual([
			type,
			415,
			unsupported,
		]);
	}

	const text = await post({ "content-type": "text/plain" }, "hello");
	expect([text.statusCode, text.json()]).toEqual([
		400,
		invalid("body/ Invalid input: expected object, received string"),
	]);

	const charset = await post(
		{ "content-type": "application/json; charset=utf-8" },
		'{"name":""}',
	);
	expect(charset.statusCode).toBe(400);
	expect((charset.json() as { code: string }).code).toBe("FST_ERR_VALIDATION");

	const none = await post({});
	expect([none.statusCode, none.json()]).toEqual([
		400,
		invalid("body/ Invalid input: expected object, received null"),
	]);
});

test("3. a __proto__ key or a constructor with a prototype is invalid JSON", async () => {
	for (const body of [
		'{"__proto__":{"x":1},"name":"a"}',
		'{"constructor":{"prototype":{}},"name":"a"}',
		'{"name":"a","x":{"__proto__":{"y":1}}}',
	]) {
		const response = await post({ "content-type": json }, body);
		expect([body, response.statusCode, response.json()]).toEqual([
			body,
			400,
			invalidJson,
		]);
	}

	// A plain "constructor" key is fine: it reaches validation.
	const plain = await post(
		{ "content-type": json },
		'{"constructor":"x","name":""}',
	);
	expect((plain.json() as { code: string }).code).toBe("FST_ERR_VALIDATION");
});

test("4. a validation message names the instance path, with a slash at the root", async () => {
	const root = await post({ "content-type": json }, '"str"');
	expect(root.json()).toEqual(
		invalid("body/ Invalid input: expected object, received string"),
	);
	const missing = await post({ "content-type": json }, "{}");
	expect(missing.json()).toEqual(
		invalid("body/name Invalid input: expected string, received undefined"),
	);
	const wrong = await post({ "content-type": json }, '{"name":1}');
	expect(wrong.json()).toEqual(
		invalid("body/name Invalid input: expected string, received number"),
	);
});

test("5. JSON answers, errors included, carry the charset", async () => {
	for (const response of [
		await app.inject({ method: "GET", url: "/api/health" }),
		await post({ "content-type": json }, "{}"),
		await post({ "content-type": "application/xml" }, "<a/>"),
	]) {
		expect(response.headers["content-type"]).toBe(
			"application/json; charset=utf-8",
		);
	}
});

test("6. a mutating route without a body schema still checks the content type", async () => {
	const response = await app.inject({
		method: "POST",
		url: "/api/notifications/mark-all-read",
		cookies: { sid },
		headers: {
			"x-requested-with": "rvna",
			"content-type": "application/xml",
		},
		payload: "<x/>",
	});
	expect([response.statusCode, response.json()]).toEqual([415, unsupported]);
});
