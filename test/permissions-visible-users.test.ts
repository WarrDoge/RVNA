import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { visibleUsernames } from "../src/lib/server/permissions.ts";
import {
	groups,
	permissionGrants,
	permissionSchemes,
	projectRoleActors,
	projects,
	userGroups,
} from "../src/lib/server/schema.ts";
import { makeUser, newRun } from "./admin-helpers.ts";
import { cleanupTestData } from "./helpers.ts";

const run = newRun();
const tag = `t-${run}`;
let viewer: { id: string; username: string };
const projectIds: string[] = [];
const schemeIds: string[] = [];
let globalSchemeId: string | null = null;
let createdGlobal = false;

async function project(label: string, leadId: string | null = null) {
	const [row] = await db
		.insert(projects)
		.values({
			sourceId: `test:${run}:${label}`,
			key: `${tag.slice(0, 5)}${label}`.toUpperCase(),
			name: `Visible users ${label} ${run}`,
			projectType: "software",
			leadId,
		})
		.returning({ id: projects.id });
	projectIds.push(row.id);
	return row.id;
}

async function scheme(sourceId: string, projectId: string) {
	const [row] = await db
		.insert(permissionSchemes)
		.values({
			sourceId,
			name: sourceId,
			projectIds: [projectId],
			raw: {},
		})
		.returning({ id: permissionSchemes.id });
	schemeIds.push(row.id);
	return row.id;
}

async function browse(
	schemeId: string,
	sourceId: string,
	holderType: string,
	holderParameter: string | null,
) {
	await db.insert(permissionGrants).values({
		sourceId,
		schemeId,
		permissionKey: "BROWSE_PROJECTS",
		holderType,
		holderParameter,
		raw: {},
	});
}

beforeAll(async () => {
	await runMigrations();
	const made = await makeUser(run, "viewer");
	viewer = made;

	const alice = await makeUser(run, "alice");
	const bob = await makeUser(run, "bob");
	const carol = await makeUser(run, "carol");
	const dave = await makeUser(run, "dave");
	const erin = await makeUser(run, "erin");
	const frank = await makeUser(run, "frank");
	const gina = await makeUser(run, "gina");
	await makeUser(run, "hank", { active: false });
	await makeUser(run, "ivan", { admin: true });

	const [devs] = await db
		.insert(groups)
		.values({ name: `${tag}-devs` })
		.returning({ id: groups.id });
	const [globalAdmins] = await db
		.insert(groups)
		.values({ name: `${tag}-global-admins` })
		.returning({ id: groups.id });
	await db.insert(userGroups).values([
		{ userId: gina.id, groupId: devs.id },
		{ userId: frank.id, groupId: globalAdmins.id },
	]);

	const p1 = await project("one", carol.id);
	const p2 = await project("two");
	const p3 = await project("three");

	const s1 = await scheme(`test:${run}:one`, p1);
	await browse(s1, `test:${run}:one:viewer`, "user", viewer.username);
	await browse(s1, `test:${run}:one:alice`, "user", alice.username);
	await browse(s1, `test:${run}:one:devs`, "group", `${tag}-devs`);
	await browse(s1, `test:${run}:one:lead`, "projectLead", null);
	await browse(s1, `test:${run}:one:role`, "projectRole", "admin");
	await db.insert(projectRoleActors).values({
		sourceId: `test:${run}:one:bob`,
		projectId: p1,
		roleId: "admin",
		roleName: "admin",
		actorType: "user",
		actorParameter: bob.username,
		raw: {},
	});

	const s2 = await scheme(`test:${run}:two`, p2);
	await browse(s2, `test:${run}:two:viewer`, "user", viewer.username);
	await browse(s2, `test:${run}:two:dave`, "user", dave.username);

	const s3 = await scheme(`test:${run}:three`, p3);
	await browse(s3, `test:${run}:three:erin`, "user", erin.username);

	const [existingGlobal] = await db
		.select({ id: permissionSchemes.id })
		.from(permissionSchemes)
		.where(eq(permissionSchemes.sourceId, "global"))
		.limit(1);
	if (existingGlobal) {
		globalSchemeId = existingGlobal.id;
	} else {
		const [created] = await db
			.insert(permissionSchemes)
			.values({
				sourceId: "global",
				name: "Global",
				projectIds: [],
				raw: {},
			})
			.returning({ id: permissionSchemes.id });
		globalSchemeId = created.id;
		createdGlobal = true;
	}
	await db.insert(permissionGrants).values({
		sourceId: `test:${run}:global-admin`,
		schemeId: globalSchemeId,
		permissionKey: "ADMINISTER",
		holderType: "group",
		holderParameter: `${tag}-global-admins`,
		raw: {},
	});
});

afterAll(async () => {
	if (globalSchemeId) {
		await db
			.delete(permissionGrants)
			.where(eq(permissionGrants.sourceId, `test:${run}:global-admin`));
	}
	if (createdGlobal && globalSchemeId) {
		await db
			.delete(permissionSchemes)
			.where(eq(permissionSchemes.id, globalSchemeId));
	}
	if (schemeIds.length > 0) {
		await db
			.delete(permissionSchemes)
			.where(inArray(permissionSchemes.id, schemeIds));
	}
	if (projectIds.length > 0) {
		await db.delete(projects).where(inArray(projects.id, projectIds));
	}
	await cleanupTestData(run);
	await pool.end();
});

test("visible usernames include every grant shape and exclude inactive accounts", async () => {
	const visible = await visibleUsernames({
		id: viewer.id,
		username: viewer.username,
		groups: [],
		isAdmin: false,
	});
	for (const label of [
		"alice",
		"bob",
		"carol",
		"dave",
		"frank",
		"gina",
		"viewer",
	]) {
		expect(visible, label).toContain(`${tag}-${label}`);
	}
	expect(visible).not.toContain(`${tag}-hank`);
});
