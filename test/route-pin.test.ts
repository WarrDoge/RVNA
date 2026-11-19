import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { buildServer } from "./helpers.ts";
import { allAppRoutes, routeKey } from "./route-inventory.ts";

/**
 * `old-routes.txt` is the route table of the old Fastify app (`allRouteTable` of commit
 * 22deafe, built once, HEAD entries left out). A route that no file answers any more fails no
 * guard test, because the guard tests only enumerate routes that exist; this test fails it:
 * each listed method and path must still be a route in the SvelteKit manifest. Parameter names
 * may differ.
 */
const app = buildServer();

beforeAll(async () => {
	await runMigrations();
	await app.ready();
});

afterAll(async () => {
	await app.close();
	await pool.end();
});

const shape = (route: string) =>
	route.replace(/:[A-Za-z0-9_]+|\*/g, ":p").replace(/(.)\/$/, "$1");

test("every route of the old Fastify app is still a route of the SvelteKit app", async () => {
	const old = readFileSync("test/fixtures/old-routes.txt", "utf8")
		.split("\n")
		.filter(Boolean);
	expect(old.length).toBeGreaterThan(300);

	const current = new Set(
		(await allAppRoutes()).map((route) => shape(routeKey(route))),
	);
	const lost = old.filter((route) => !current.has(shape(route)));
	expect(lost).toEqual([]);
});
