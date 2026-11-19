import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { pages, spaces } from "../src/lib/server/schema.ts";
import { searchPages } from "../src/lib/server/search-pages.ts";
import { makeUser, newRun } from "./admin-helpers.ts";
import { cleanupTestData } from "./helpers.ts";

const run = newRun();
const spaceKey = `SP${run.slice(0, 6).toUpperCase()}`;
let spaceId: string;

function actor(
	user: { id: string; username: string },
	isAdmin: boolean,
): CurrentUser {
	return {
		id: user.id,
		username: user.username,
		displayName: `Test search pages ${run}`,
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin,
		mustChangePassword: false,
		hasPassword: false,
	};
}

beforeAll(async () => {
	await runMigrations();
	const [space] = await db
		.insert(spaces)
		.values({
			sourceId: `test:${run}:space`,
			key: spaceKey,
			name: `Search pages ${run}`,
		})
		.returning({ id: spaces.id });
	spaceId = space.id;
	await db.insert(pages).values({
		sourceId: `test:${run}:page`,
		spaceId,
		title: `Zebra search ${run}`,
		status: "current",
		bodyStorage: "<p>zebra search</p>",
		bodyHtml: "<p>zebra search</p>",
	});
});

afterAll(async () => {
	await db.delete(spaces).where(eq(spaces.id, spaceId));
	await cleanupTestData(run);
	await pool.end();
});

test("page search uses the wiki's permission-filtered search", async () => {
	const member = await makeUser(run, "search-pages");
	const admin = await makeUser(run, "search-pages-admin", { admin: true });

	const hidden = await searchPages(actor(member, false), `Zebra ${run}`, 5);
	expect(hidden).toEqual({ total: 0, pages: [] });

	const visible = await searchPages(actor(admin, true), `Zebra ${run}`, 5);
	expect(visible.total).toBe(1);
	expect(visible.pages[0]?.title).toBe(`Zebra search ${run}`);
});
