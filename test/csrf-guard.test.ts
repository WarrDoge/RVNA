import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sha256 } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { apiTokens } from "../src/lib/server/schema.ts";
import { makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import { buildServer, cleanupTestData } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = newRun();
const own = "http://127.0.0.1:3000";
const foreign = "https://attacker.example.com";
let app: TestApp;
let user: TestUser;
let bearer: string;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	await app.ready();
	user = await makeUser(run, "csrf");
	bearer = `rvna_${randomUUID()}`;
	await db.insert(apiTokens).values({
		userId: user.id,
		name: `csrf ${run}`,
		tokenHash: sha256(bearer),
	});
});

afterAll(async () => {
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

const boundary = "csrf-boundary";
const bodies = {
	form: {
		type: "application/x-www-form-urlencoded",
		payload: "intent=createToken&name=forged",
	},
	multipart: {
		type: `multipart/form-data; boundary=${boundary}`,
		payload: `--${boundary}\r\nContent-Disposition: form-data; name="intent"\r\n\r\ncreateToken\r\n--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nforged\r\n--${boundary}--\r\n`,
	},
	text: { type: "text/plain", payload: "intent=createToken&name=forged" },
	json: {
		type: "application/json",
		payload: JSON.stringify({ intent: "createToken", name: "forged" }),
	},
} as const;

function send(
	method: string,
	url: string,
	options: {
		body: keyof typeof bodies;
		origin?: string;
		header?: boolean;
		auth?: "session" | "bearer";
	},
) {
	const { type, payload } = bodies[options.body];
	const headers: Record<string, string> = { "content-type": type };
	if (options.origin) headers.origin = options.origin;
	if (options.header) headers["x-requested-with"] = "rvna";
	if (options.auth === "bearer") headers.authorization = `Bearer ${bearer}`;
	return app.inject({
		method: method as "POST",
		url,
		cookies: options.auth === "bearer" ? undefined : { sid: user.session },
		headers,
		payload: Buffer.from(payload) as never,
	});
}

const forgedTokens = () =>
	db
		.select({ id: apiTokens.id })
		.from(apiTokens)
		.where(eq(apiTokens.name, "forged"));

describe("a page form action", () => {
	const page = "/secure/ViewProfile.jspa";

	for (const body of Object.keys(bodies) as (keyof typeof bodies)[]) {
		test(`refuses a ${body} post from another site, from Origin null and without Origin`, async () => {
			for (const origin of [foreign, "null", undefined]) {
				const response = await send("POST", page, { body, origin });
				expect(response.statusCode, `${body} from ${origin}`).toBe(403);
				expect(response.body).toContain("Cross-site POST");
			}
			expect(await forgedTokens()).toEqual([]);
		});
	}

	test("accepts the same origin", async () => {
		const response = await send("POST", page, { body: "form", origin: own });
		expect(response.statusCode).toBe(200);
		expect(await forgedTokens()).toHaveLength(1);
		await db.delete(apiTokens).where(eq(apiTokens.name, "forged"));
	});
});

describe("a data route with a session cookie", () => {
	const url = "/api/me/notification-settings";

	for (const body of Object.keys(bodies) as (keyof typeof bodies)[]) {
		test(`refuses a ${body} PUT without X-Requested-With, whatever the Origin`, async () => {
			for (const origin of [foreign, "null", own, undefined]) {
				const response = await send("PUT", url, { body, origin });
				expect(response.statusCode, `${body} from ${origin}`).toBe(403);
				expect(response.json()).toEqual({
					error: "Missing X-Requested-With header",
				});
			}
		});
	}

	test("refuses every mutating method without the header", async () => {
		for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
			const response = await send(method, url, {
				body: "json",
				origin: foreign,
			});
			expect(response.statusCode, method).toBe(403);
		}
	});

	test("accepts a request that sends the header", async () => {
		const response = await send("PUT", url, {
			body: "json",
			header: true,
			origin: own,
		});
		expect(response.statusCode).not.toBe(403);
	});
});

test("a bearer request needs neither Origin nor the header, even as multipart", async () => {
	for (const body of ["json", "multipart"] as const) {
		const response = await send("PUT", "/api/me/notification-settings", {
			body,
			auth: "bearer",
		});
		expect(response.statusCode, body).not.toBe(403);
	}
});
