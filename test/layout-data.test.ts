import { afterAll, beforeAll, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { load } from "../src/routes/+layout.server.ts";

process.env.APP_TIME_ZONE = "Europe/Helsinki";

const user: CurrentUser = {
	id: "00000000-0000-0000-0000-000000000001",
	username: "layout",
	displayName: "Layout",
	email: null,
	avatarUrl: null,
	groups: [],
	isAdmin: false,
	mustChangePassword: false,
	hasPassword: true,
};

beforeAll(runMigrations);
afterAll(() => pool.end());

function layoutData(locals: { user: CurrentUser | null }) {
	return (
		load as unknown as (event: unknown) => Promise<Record<string, unknown>>
	)({ depends: () => undefined, locals });
}

test("the root layout returns the user, site, unread count and date context, nothing else", async () => {
	const data = await layoutData({ user });
	expect(Object.keys(data).sort()).toEqual([
		"locale",
		"now",
		"site",
		"timeZone",
		"unread",
		"user",
	]);
	expect(data.timeZone).toBe("Europe/Helsinki");
	expect(data.locale).toBe("en-GB");
	expect(typeof data.now).toBe("number");
	expect(Object.keys(data.user as object).sort()).toEqual(
		Object.keys(user).sort(),
	);
	expect(Object.keys(data.site as object).sort()).toEqual([
		"baseUrl",
		"defaultIssueTypeId",
		"defaultPriorityId",
		"title",
	]);
});

test("a signed-out visitor gets only the site title", async () => {
	const data = await layoutData({ user: null });
	expect(data.user).toBeNull();
	expect(data.site).toMatchObject({
		baseUrl: "",
		defaultIssueTypeId: null,
		defaultPriorityId: null,
	});
	expect((data.site as { title: string }).title).not.toBe("");
	expect(data.unread).toBe(0);
});
