import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { userProfile } from "../src/lib/server/profile.ts";
import {
	groups,
	userGroups,
	userPreferences,
	users,
} from "../src/lib/server/schema.ts";
import { makeUser, newRun } from "./admin-helpers.ts";
import { cleanupTestData } from "./helpers.ts";

const run = newRun();
const tag = `t-${run}`;
let subject: { id: string; username: string };
let viewer: { id: string; username: string };
let other: { id: string; username: string };
let admin: { id: string; username: string };

function actor(
	user: { id: string; username: string },
	options: { admin?: boolean; groups?: string[] } = {},
): CurrentUser {
	return {
		id: user.id,
		username: user.username,
		displayName: `Test ${user.username}`,
		email: null,
		avatarUrl: null,
		groups: options.groups ?? [],
		isAdmin: options.admin ?? false,
		mustChangePassword: false,
		hasPassword: false,
	};
}

beforeAll(async () => {
	await runMigrations();
	subject = await makeUser(run, "subject");
	viewer = await makeUser(run, "viewer");
	other = await makeUser(run, "other");
	admin = await makeUser(run, "admin", { admin: true });
	await makeUser(run, "inactive", { active: false });

	await db
		.update(users)
		.set({ messengerMatrixId: `@subject-${run}:example.com` })
		.where(eq(users.id, subject.id));
	await db.insert(userPreferences).values({
		userId: subject.id,
		timeZone: "Europe/Amsterdam",
	});
	const [team] = await db
		.insert(groups)
		.values({ name: `${tag}-team` })
		.returning({ id: groups.id });
	await db.insert(userGroups).values({ userId: subject.id, groupId: team.id });
});

afterAll(async () => {
	await cleanupTestData(run);
	await pool.end();
});

test("an inactive account has no profile", async () => {
	await expect(
		userProfile(actor(admin), `${tag}-inactive`),
	).rejects.toMatchObject({ status: 404, message: "User not found" });
});

test("the profile hides private fields from other users and shows them to self and admins", async () => {
	const own = await userProfile(actor(viewer, { groups: [] }), viewer.username);
	expect(own.isSelf).toBe(true);
	expect(own.canEditAvatar).toBe(true);
	expect(own.email).toBe(`${viewer.username}@example.test`);

	const seen = await userProfile(actor(other), subject.username);
	expect(seen).toMatchObject({
		username: subject.username,
		email: null,
		isSelf: false,
		canEditAvatar: false,
		groups: [],
		messengerMatrixId: null,
		timeZone: "Europe/Amsterdam",
	});

	const self = await userProfile(
		actor(subject, { groups: [`${tag}-team`] }),
		subject.username,
	);
	expect(self).toMatchObject({
		email: `${subject.username}@example.test`,
		isSelf: true,
		groups: [`${tag}-team`],
		messengerMatrixId: `@subject-${run}:example.com`,
	});

	const asAdmin = await userProfile(
		actor(admin, { admin: true }),
		subject.username,
	);
	expect(asAdmin.email).toBe(`${subject.username}@example.test`);
	expect(asAdmin.groups).toEqual([`${tag}-team`]);
});
