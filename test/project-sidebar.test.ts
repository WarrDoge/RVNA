import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { listBoards } from "../src/lib/server/agile/service.ts";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { loadProjectSidebar } from "../src/lib/server/projects/sidebar.ts";
import { makeUser, newRun } from "./admin-helpers.ts";
import {
	createProjectFixture,
	dropProjectFixture,
} from "./fixtures/project.ts";
import { cleanupTestData } from "./helpers.ts";

const run = newRun();
const softwareKey = `S${run.slice(0, 5).toUpperCase()}`;
const deskKey = `D${run.slice(0, 5).toUpperCase()}`;
const hiddenKey = `H${run.slice(0, 5).toUpperCase()}`;
const softwareRun = `${run}sw`;
const deskRun = `${run}sd`;
const hiddenRun = `${run}hi`;
const otherDeskRun = `${run}od`;
const otherDeskKey = `O${run.slice(0, 5).toUpperCase()}`;
const softwareBoardName = `Sidebar scrum ${run}`;
const deskPortalName = `Sidebar portal ${run}`;
const otherDeskPortalName = `Sidebar other portal ${run}`;
const deskQueueName = `Sidebar queue ${run}`;
const hiddenSchemeSource = `test:${run}:hidden-scheme`;
const rapidViewId = 2_000_000 + Number.parseInt(run.slice(0, 6), 16);

let client: Client;
let actor: CurrentUser;
let softwareProjectId: string;
let deskProjectId: string;
let hiddenProjectId: string;
let deskId: string;
let otherDeskProjectId: string;
let otherDeskId: string;

beforeAll(async () => {
	await runMigrations();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const user = await makeUser(run, "sidebar");
	actor = {
		id: user.id,
		username: user.username,
		displayName: `Test sidebar ${run}`,
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin: false,
		mustChangePassword: false,
		hasPassword: false,
	};

	const software = await createProjectFixture(client, {
		run: softwareRun,
		key: softwareKey,
		name: `Sidebar software ${run}`,
		issues: [],
		admins: [user.username],
	});
	softwareProjectId = software.projectId;
	await client.query(
		`insert into boards
		 (rapid_view_id, source_id, name, type, filter_jql, project_id, config_imported)
		 values ($1, $2, $3, 'scrum', $4, $5, true)`,
		[
			rapidViewId,
			`test:${run}:software-board`,
			softwareBoardName,
			`project = ${softwareKey}`,
			softwareProjectId,
		],
	);

	const desk = await createProjectFixture(client, {
		run: deskRun,
		key: deskKey,
		name: `Sidebar desk ${run}`,
		issues: [],
		admins: [user.username],
	});
	deskProjectId = desk.projectId;
	await client.query(
		"update projects set project_type = 'service_desk' where id = $1",
		[deskProjectId],
	);
	await client.query(
		`insert into boards
		 (rapid_view_id, source_id, name, type, filter_jql, project_id, config_imported)
		 values ($1, $2, $3, 'kanban', $4, $5, true)`,
		[
			rapidViewId + 1,
			`test:${run}:desk-board`,
			`Sidebar desk board ${run}`,
			`project = ${deskKey}`,
			deskProjectId,
		],
	);
	const deskRow = await client.query<{ id: string }>(
		`insert into service_desks
		 (source_id, project_id, portal_name, description, open_access)
		 values ($1, $2, $3, $4, true) returning id`,
		[`test:${run}:desk`, deskProjectId, deskPortalName, "Sidebar desk portal"],
	);
	deskId = deskRow.rows[0].id;
	await client.query(
		`insert into queues
		 (source_id, desk_id, name, jql, columns, issue_count, sequence)
		 values ($1, $2, $3, $4, $5::jsonb, 0, 0)`,
		[
			`test:${run}:queue`,
			deskId,
			deskQueueName,
			`project = ${deskKey}`,
			JSON.stringify(["issuekey", "summary"]),
		],
	);

	const otherDesk = await createProjectFixture(client, {
		run: otherDeskRun,
		key: otherDeskKey,
		name: `Sidebar other desk ${run}`,
		issues: [],
		admins: [user.username],
	});
	otherDeskProjectId = otherDesk.projectId;
	await client.query(
		"update projects set project_type = 'service_desk' where id = $1",
		[otherDeskProjectId],
	);
	const otherDeskRow = await client.query<{ id: string }>(
		`insert into service_desks
		 (source_id, project_id, portal_name, description, open_access)
		 values ($1, $2, $3, $4, true) returning id`,
		[
			`test:${run}:other-desk`,
			otherDeskProjectId,
			otherDeskPortalName,
			"Sidebar other desk portal",
		],
	);
	otherDeskId = otherDeskRow.rows[0].id;

	const hidden = await createProjectFixture(client, {
		run: hiddenRun,
		key: hiddenKey,
		name: `Sidebar hidden ${run}`,
		issues: [],
	});
	hiddenProjectId = hidden.projectId;
	await client.query(
		`insert into permission_schemes (source_id, name, project_ids, raw)
		 values ($1, $2, $3::jsonb, '{}'::jsonb)`,
		[
			hiddenSchemeSource,
			`Sidebar hidden scheme ${run}`,
			JSON.stringify([hiddenProjectId]),
		],
	);
});

afterAll(async () => {
	if (client) {
		for (const projectId of [softwareProjectId, deskProjectId]) {
			await client.query("delete from boards where project_id = $1", [
				projectId,
			]);
		}
		await client.query("delete from permission_schemes where source_id = $1", [
			hiddenSchemeSource,
		]);
		await dropProjectFixture(client, softwareRun);
		await dropProjectFixture(client, deskRun);
		await dropProjectFixture(client, otherDeskRun);
		await dropProjectFixture(client, hiddenRun);
		await cleanupTestData(run);
		await client.end();
	}
	await pool.end();
});

test("a software project returns its board and the settings permission", async () => {
	const data = await loadProjectSidebar(actor, softwareKey.toLowerCase());

	expect(Object.keys(data.project).sort()).toEqual([
		"avatarUrl",
		"id",
		"key",
		"name",
		"type",
	]);
	expect(data.project).toMatchObject({
		id: softwareProjectId,
		key: softwareKey,
		name: `Sidebar software ${run}`,
		avatarUrl: `/api/avatars/projects/${softwareProjectId}`,
		type: "software",
	});
	expect(data.boards).toHaveLength(1);
	expect(data.boards[0]).toMatchObject({
		rapidViewId,
		name: softwareBoardName,
		type: "scrum",
		project: { key: softwareKey },
	});
	expect(data.archived).toBe(false);
	expect(data.canAdminister).toBe(true);
	expect(data.user).toEqual({ isAdmin: false });
	expect(data.queues).toEqual([]);
	expect(data.portals).toEqual([]);
});

test("a service desk project returns its queues and portal, not its board", async () => {
	const data = await loadProjectSidebar(actor, deskKey);

	expect(data.project).toMatchObject({
		id: deskProjectId,
		key: deskKey,
		type: "service_desk",
	});
	expect(data.boards).toEqual([]);
	expect(data.queues).toEqual([
		{
			id: expect.any(String),
			name: deskQueueName,
			parentId: null,
			issueCount: 0,
			liveCount: 0,
		},
	]);
	expect(data.portals).toEqual([
		{
			id: deskId,
			name: deskPortalName,
			projectKey: deskKey,
		},
	]);
	expect(data.portals.map((portal) => portal.id)).not.toContain(otherDeskId);
});

test("a board list scoped to a project reads only that project's boards", async () => {
	const statements: string[] = [];
	const original = pool.query.bind(pool);
	(pool as unknown as { query: typeof pool.query }).query = ((
		query: { text?: string } | string,
		...rest: unknown[]
	) => {
		statements.push(typeof query === "string" ? query : (query.text ?? ""));
		return (original as (...args: unknown[]) => unknown)(query, ...rest);
	}) as typeof pool.query;
	let boards: Awaited<ReturnType<typeof listBoards>>;
	try {
		boards = await listBoards(actor, { projectId: softwareProjectId });
	} finally {
		(pool as unknown as { query: typeof pool.query }).query = original;
	}

	expect(boards.map((board) => board.project?.key)).toEqual([softwareKey]);
	const boardReads = statements.filter((statement) =>
		statement.includes('from "boards"'),
	);
	expect(boardReads).toHaveLength(1);
	expect(boardReads[0]).toContain('"boards"."project_id" =');
});

test("a software project reads only its own boards", async () => {
	const statements: string[] = [];
	const original = pool.query.bind(pool);
	(pool as unknown as { query: typeof pool.query }).query = ((
		query: { text?: string } | string,
		...rest: unknown[]
	) => {
		statements.push(typeof query === "string" ? query : (query.text ?? ""));
		return (original as (...args: unknown[]) => unknown)(query, ...rest);
	}) as typeof pool.query;
	try {
		await loadProjectSidebar(actor, softwareKey);
	} finally {
		(pool as unknown as { query: typeof pool.query }).query = original;
	}

	const boardReads = statements.filter((statement) =>
		statement.includes('from "boards"'),
	);
	expect(boardReads).toHaveLength(1);
	expect(boardReads[0]).toContain('"boards"."project_id" =');
});
