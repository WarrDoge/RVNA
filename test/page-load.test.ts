import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { HttpError } from "../src/lib/server/http.ts";
import {
	adminAction,
	adminLoad,
	pageLoad,
} from "../src/lib/server/http-svelte.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	fixtureRun,
} from "./fixtures/project.ts";

const fixture = fixtureRun();
const key = fixtureKey(fixture);
const previousKey = `OLD${fixture.slice(0, 5).toUpperCase()}`;

const actor: CurrentUser = {
	id: "00000000-0000-0000-0000-000000000000",
	username: "page-load",
	displayName: "Page load",
	email: null,
	avatarUrl: null,
	groups: [],
	isAdmin: false,
	mustChangePassword: false,
	hasPassword: false,
};

let client: Client;

beforeAll(async () => {
	await runMigrations();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	const project = await createProjectFixture(client, {
		run: fixture,
		key,
		issues: [],
	});
	await client.query(
		"insert into project_previous_keys (project_id, key) values ($1, $2)",
		[project.projectId, previousKey],
	);
});

afterAll(async () => {
	await dropProjectFixture(client, fixture);
	await client.end();
	await pool.end();
});

/** Calls a wrapped `load` with the parts of a route's event it reads. */
async function load(
	routeId: string,
	params: Record<string, string>,
	url: string,
) {
	let called = false;
	const wrapped = pageLoad(() => {
		called = true;
		return { ok: true };
	});
	const event = {
		locals: { user: actor },
		params,
		route: { id: routeId },
		url: new URL(url, "http://localhost"),
	};
	try {
		await wrapped(event as never);
		return { called };
	} catch (thrown) {
		const { status, location } = thrown as { status: number; location: string };
		return { called, status, location };
	}
}

test("a previous project key is a 302 to the same address with the current key", async () => {
	expect(
		await load(
			"/projects/[key]/issues/[issueKey]",
			{ key: previousKey, issueKey: `${previousKey}-1` },
			`/projects/${previousKey}/issues/${previousKey}-1?tab=a%20b`,
		),
	).toEqual({
		called: false,
		status: 302,
		location: `/projects/${key}/issues/${previousKey}-1?tab=a%20b`,
	});
});

test("route groups do not shift the key segment", async () => {
	expect(
		await load(
			"/(app)/projects/[key]",
			{ key: previousKey },
			`/projects/${previousKey}`,
		),
	).toMatchObject({ called: false, status: 302, location: `/projects/${key}` });
});

test("a current key, an unknown key and a route without a key run the load", async () => {
	for (const [routeId, params, url] of [
		["/projects/[key]", { key }, `/projects/${key}`],
		["/projects/[key]", { key: "NOSUCH" }, "/projects/NOSUCH"],
		["/projects", {}, "/projects"],
	] as const) {
		expect(await load(routeId, { ...params }, url)).toEqual({ called: true });
	}
});

const administrator: CurrentUser = { ...actor, isAdmin: true };

async function outcome(run: () => Promise<unknown>) {
	try {
		return { value: await run() };
	} catch (thrown) {
		const { status, location } = thrown as {
			status: number;
			location?: string;
		};
		return { status, location };
	}
}

function adminEvent(user: CurrentUser | null) {
	return {
		locals: { user },
		params: {},
		route: { id: "/secure/admin/users" },
		url: new URL("/secure/admin/users", "http://localhost"),
		request: new Request("http://localhost/secure/admin/users", {
			method: "POST",
			body: new URLSearchParams({ name: "x" }),
		}),
	} as never;
}

test("an administration load is a 403 for a signed-in user who is not an administrator", async () => {
	const wrapped = adminLoad(() => ({ ok: true }));
	expect(await outcome(() => wrapped(adminEvent(actor)))).toEqual({
		status: 403,
		location: undefined,
	});
	expect(await outcome(() => wrapped(adminEvent(administrator)))).toEqual({
		value: { ok: true },
	});
	expect(await outcome(() => wrapped(adminEvent(null)))).toMatchObject({
		status: 302,
	});
});

test("an administration action is fail(403) for a non-administrator and does not run", async () => {
	let ran = false;
	const wrapped = adminAction(() => {
		ran = true;
		return { saved: true };
	});
	expect(await wrapped(adminEvent(actor))).toMatchObject({
		status: 403,
		data: { error: "Forbidden" },
	});
	expect(ran).toBe(false);
	expect(await wrapped(adminEvent(administrator))).toEqual({ saved: true });
	expect(ran).toBe(true);
});

test("a failed action carries the details of the HttpError", async () => {
	const wrapped = adminAction(() => {
		throw new HttpError(409, "In use", { details: { count: 2 } });
	});
	expect(await wrapped(adminEvent(administrator))).toMatchObject({
		status: 409,
		data: { error: "In use", count: 2 },
	});
});
