import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { issueFilter, quickSearch } from "../src/lib/server/legacy/service.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	fixtureRun,
} from "./fixtures/project.ts";

const run = fixtureRun();
const visibleKey = fixtureKey(run);
const hiddenKey = `HID${run.slice(0, 5).toUpperCase()}`;
const username = `t-${run}-navigator`;
const ownerName = `t-${run}-owner`;

let client: Client;
let viewer: CurrentUser;
let ownerId: string;
let visibleProjectId: string;
let hiddenProjectId: string;
let projectFilterId: string;
let groupFilterId: string;
let hiddenIssueKey: string;

beforeAll(async () => {
	await runMigrations();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const viewerRow = await client.query<{ id: string }>(
		`insert into users (username, display_name) values ($1, $2) returning id`,
		[username, "Legacy search reviewer"],
	);
	const ownerRow = await client.query<{ id: string }>(
		`insert into users (username, display_name) values ($1, $2) returning id`,
		[ownerName, "Filter owner"],
	);
	ownerId = ownerRow.rows[0]?.id as string;
	viewer = {
		id: viewerRow.rows[0]?.id as string,
		username,
		displayName: "Legacy search reviewer",
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin: false,
		mustChangePassword: false,
		hasPassword: false,
	};

	const visible = await createProjectFixture(client, {
		run,
		key: visibleKey,
		issues: [
			{ summary: `Visible issue one ${run}` },
			{ summary: `Visible issue two ${run}` },
		],
	});
	visibleProjectId = visible.projectId;

	const hidden = await createProjectFixture(client, {
		run: `${run}-hidden`,
		key: hiddenKey,
		issues: [{ summary: `Hidden issue ${run}` }],
	});
	hiddenProjectId = hidden.projectId;
	hiddenIssueKey = hidden.issueKeys[0] as string;
	await client.query(
		`insert into permission_schemes (source_id, name, project_ids, raw)
		 values ($1, $2, $3::jsonb, '{}'::jsonb)`,
		[
			`test:${run}:hidden-scheme`,
			`Hidden scheme ${run}`,
			JSON.stringify([hiddenProjectId]),
		],
	);

	const group = await client.query<{ id: string }>(
		`insert into groups (name, local) values ($1, false) returning id`,
		[`t-${run}-viewers`],
	);
	const groupId = group.rows[0]?.id as string;
	viewer = { ...viewer, groups: [`t-${run}-viewers`] };

	const projectFilter = await client.query<{ id: string }>(
		`insert into filters (name, jql, owner_id, columns, shared, source_id)
		 values ($1, $2, $3, '[]'::jsonb, false, $4) returning id`,
		[
			`Project shared filter ${run}`,
			`project = ${visibleKey} ORDER BY key ASC`,
			ownerId,
			`filter-project-${run}`,
		],
	);
	projectFilterId = projectFilter.rows[0]?.id as string;
	await client.query(
		`insert into filter_shares (filter_id, project_id) values ($1, $2)`,
		[projectFilterId, visibleProjectId],
	);

	const groupFilter = await client.query<{ id: string }>(
		`insert into filters (name, jql, owner_id, columns, shared, source_id)
		 values ($1, $2, $3, '[]'::jsonb, false, $4) returning id`,
		[
			`Group shared filter ${run}`,
			`project = ${visibleKey} ORDER BY key ASC`,
			ownerId,
			`filter-group-${run}`,
		],
	);
	groupFilterId = groupFilter.rows[0]?.id as string;
	await client.query(
		`insert into filter_shares (filter_id, group_id) values ($1, $2)`,
		[groupFilterId, groupId],
	);
});

afterAll(async () => {
	if (client) {
		await client.query(`delete from filters where id = any($1::uuid[])`, [
			[projectFilterId, groupFilterId],
		]);
		await client.query(`delete from permission_schemes where source_id = $1`, [
			`test:${run}:hidden-scheme`,
		]);
		await dropProjectFixture(client, `${run}-hidden`);
		await dropProjectFixture(client, run);
		await client.end();
	}
	await pool.query("delete from users where username ilike $1", [`t-${run}-%`]);
	await pool.query("delete from groups where name like $1", [`t-${run}-%`]);
	await pool.end();
});

test("a source-id filter shared with a project is resolved like a UUID filter", async () => {
	const outcome = await issueFilter(viewer, {
		filter: `filter-project-${run}`,
		search: "?view=list",
	});
	expect(outcome.kind).toBe("redirect");
	if (outcome.kind === "redirect") {
		const location = new URL(outcome.location, "http://localhost");
		expect(location.pathname).toBe("/issues/");
		expect(location.searchParams.get("filter")).toBe(projectFilterId);
		expect(location.searchParams.get("view")).toBe("list");
	}
});

test("a source-id filter shared with a group is resolved like a UUID filter", async () => {
	const outcome = await issueFilter(viewer, {
		filter: `filter-group-${run}`,
		search: "",
	});
	expect(outcome.kind).toBe("redirect");
	if (outcome.kind === "redirect") {
		expect(outcome.location).toBe(`/issues/?filter=${groupFilterId}`);
	}
});

test("quick search redirects an issue key only when the viewer can browse it", async () => {
	const hidden = await quickSearch(viewer, { searchString: hiddenIssueKey });
	expect(hidden.kind).toBe("redirect");
	if (hidden.kind === "redirect") {
		expect(hidden.location).not.toBe(`/browse/${hiddenIssueKey}`);
		expect(hidden.location).toContain("/issues/?jql=");
	}

	const visible = await quickSearch(viewer, {
		searchString: `${visibleKey}-1`,
	});
	expect(visible).toEqual({
		kind: "redirect",
		location: `/browse/${visibleKey}-1`,
	});
});

test("quick search still searches text that looks like a key but is not visible", async () => {
	const outcome = await quickSearch(viewer, {
		searchString: `${hiddenKey}-999`,
	});
	expect(outcome.kind).toBe("redirect");
	if (outcome.kind === "redirect") {
		expect(outcome.location).toContain("/issues/?jql=");
	}
});

test("a random source-id filter is still not found", async () => {
	const outcome = await issueFilter(viewer, {
		filter: randomUUID(),
		search: "",
	});
	expect(outcome).toEqual({ kind: "none" });
});
