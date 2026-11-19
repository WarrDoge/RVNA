import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { loadIssueActivity } from "../src/lib/server/issues/view-activity.ts";
import { makeUser, newRun } from "./admin-helpers.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	type SeedResult,
} from "./fixtures/project.ts";
import { cleanupTestData } from "./helpers.ts";

const run = newRun();
const visibleRun = `${run}vis`;
const hiddenRun = `${run}hid`;
const deskRun = `${run}desk`;
const hiddenFieldSource = `test:${run}:hidden-field`;

let client: Client;
let actor: CurrentUser;
let visible: SeedResult;
let hidden: SeedResult;
let desk: SeedResult;
let hiddenSchemeSource: string;
let insertedSprintField = false;

beforeAll(async () => {
	await runMigrations();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const user = await makeUser(run, "activity");
	actor = {
		id: user.id,
		username: user.username,
		displayName: `Test activity ${run}`,
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin: false,
		mustChangePassword: false,
		hasPassword: false,
	};

	visible = await createProjectFixture(client, {
		run: visibleRun,
		key: `VA${run.slice(0, 5).toUpperCase()}`,
		issues: [{ summary: "Activity loader issue" }],
	});
	hidden = await createProjectFixture(client, {
		run: hiddenRun,
		key: `HI${run.slice(0, 5).toUpperCase()}`,
		issues: [{ summary: "Hidden activity issue" }],
	});
	hiddenSchemeSource = `test:${run}:hidden-scheme`;
	await client.query(
		`insert into permission_schemes (source_id, name, project_ids, raw)
		 values ($1, $2, $3::jsonb, '{}'::jsonb)`,
		[
			hiddenSchemeSource,
			`Hidden activity scheme ${run}`,
			JSON.stringify([hidden.projectId]),
		],
	);

	desk = await createProjectFixture(client, {
		run: deskRun,
		key: `DS${run.slice(0, 5).toUpperCase()}`,
		issues: [{ summary: "Desk activity issue" }],
	});
	await client.query(
		"insert into service_desks (source_id, project_id, portal_name) values ($1, $2, 'Desk')",
		[`test:${run}:desk`, desk.projectId],
	);

	const visibleIssueId = visible.issueIds[0] as string;
	await client.query(
		`insert into comments
		 (source_id, issue_id, author_id, body_html, body_source, created, updated)
		 values ($1, $2, $3, $4, $5, now(), now()) returning id`,
		[
			`test:${run}:public-comment`,
			visibleIssueId,
			actor.id,
			"<p>Visible comment</p>",
			"Visible comment",
		],
	);
	await client.query(
		`insert into comments
		 (source_id, issue_id, author_id, body_html, body_source, created, updated, internal)
		 values ($1, $2, $3, $4, $5, now(), now(), true)`,
		[
			`test:${run}:internal-comment`,
			visibleIssueId,
			actor.id,
			"<p>Internal comment</p>",
			"Internal comment",
		],
	);
	await client.query(
		`insert into worklogs
		 (source_id, issue_id, author_id, started, seconds, comment)
		 values ($1, $2, $3, now(), 5400, $4)`,
		[`test:${run}:worklog`, visibleIssueId, actor.id, "Loader work"],
	);
	await client.query(
		`insert into fields (source_id, name, custom_key, type)
		 values ($1, $2, 'com.atlassian.servicedesk:hidden', 'sd-hidden')`,
		[hiddenFieldSource, `Hidden field ${run}`],
	);
	const history = await client.query<{ id: string }>(
		`insert into issue_history (source_id, issue_id, author_id, created)
		 values ($1, $2, $3, now()) returning id`,
		[`test:${run}:history`, visibleIssueId, actor.id],
	);
	await client.query(
		`insert into issue_history_items
		 (source_id, history_id, field, field_type, to_string, sequence)
		 values ($1, $2, 'summary', 'jira', $3, 0)`,
		[`test:${run}:history-item`, history.rows[0]?.id, "Activity loader issue"],
	);
	await client.query(
		`insert into issue_history_items
		 (source_id, history_id, field, field_type, from_value, from_string,
		  to_value, to_string, sequence)
		 values ($1, $2, $3, 'custom', $4, 'hidden from', $4, 'hidden to', 1)`,
		[
			`test:${run}:hidden-history-item`,
			history.rows[0]?.id,
			`Hidden field ${run}`,
			'{"emailAddress":"hidden@example.test"}',
		],
	);
	await client.query(
		`insert into issue_history_items
		 (source_id, history_id, field, field_type, from_value, from_string,
		  to_value, to_string, sequence)
		 values ($1, $2, 'status', 'jira', $3, 'To Do', $4, 'Done', 2)`,
		[
			`test:${run}:raw-history-item`,
			history.rows[0]?.id,
			'{"emailAddress":"hidden@example.test"}',
			'{"emailAddress":"hidden@example.test"}',
		],
	);

	const sprintField = await client.query(
		`insert into fields (source_id, name, custom_key, type)
		 values ('customfield_20002', 'Sprint', 'com.pyxis.greenhopper.jira:gh-sprint', 'array')
		 on conflict (source_id) do nothing returning id`,
	);
	insertedSprintField = sprintField.rowCount === 1;
	await client.query(
		`insert into issue_history_items
		 (source_id, history_id, field, field_type, to_string, sequence)
		 values ($1, $2, 'Sprint', 'custom', 'Sprint 1', 3)`,
		[`test:${run}:sprint-history-item`, history.rows[0]?.id],
	);
	const hiddenOnly = await client.query<{ id: string }>(
		`insert into issue_history (source_id, issue_id, author_id, created)
		 values ($1, $2, $3, now()) returning id`,
		[`test:${run}:hidden-only-history`, visibleIssueId, actor.id],
	);
	await client.query(
		`insert into issue_history_items
		 (source_id, history_id, field, field_type, to_string, sequence)
		 values ($1, $2, $3, 'custom', 'hidden to', 0)`,
		[
			`test:${run}:hidden-only-item`,
			hiddenOnly.rows[0]?.id,
			`Hidden field ${run}`,
		],
	);

	const deskIssueId = desk.issueIds[0] as string;
	await client.query(
		`insert into comments
		 (source_id, issue_id, author_id, body_html, body_source, created, updated)
		 values ($1, $2, $3, $4, $5, now(), now())`,
		[
			`test:${run}:desk-public`,
			deskIssueId,
			actor.id,
			"<p>Desk public</p>",
			"Desk public",
		],
	);
	await client.query(
		`insert into comments
		 (source_id, issue_id, author_id, body_html, body_source, created, updated, internal)
		 values ($1, $2, $3, $4, $5, now(), now(), true)`,
		[
			`test:${run}:desk-internal`,
			deskIssueId,
			actor.id,
			"<p>Desk internal</p>",
			"Desk internal",
		],
	);
});

afterAll(async () => {
	if (client) {
		await client.query("delete from service_desks where source_id = $1", [
			`test:${run}:desk`,
		]);
		await client.query("delete from permission_schemes where source_id = $1", [
			hiddenSchemeSource,
		]);
		await client.query("delete from fields where source_id = $1", [
			hiddenFieldSource,
		]);
		if (insertedSprintField) {
			await client.query(
				"delete from fields where source_id = 'customfield_20002'",
			);
		}
		await dropProjectFixture(client, visibleRun);
		await dropProjectFixture(client, hiddenRun);
		await dropProjectFixture(client, deskRun);
		await cleanupTestData(run);
		await client.end();
	}
	await pool.end();
});

describe("loadIssueActivity", () => {
	test("returns comments, work logs and history in API shape", async () => {
		const data = await loadIssueActivity(
			actor,
			(visible.issueKeys[0] as string).toLowerCase(),
		);

		expect(Object.keys(data).sort()).toEqual([
			"comments",
			"history",
			"worklogs",
		]);
		expect(data.comments).toHaveLength(1);
		expect(Object.keys(data.comments[0] as object).sort()).toEqual([
			"author",
			"bodyHtml",
			"created",
			"id",
			"internal",
			"updated",
		]);
		expect(data.comments[0]).toMatchObject({
			bodyHtml: "<p>Visible comment</p>",
			internal: false,
			author: { id: actor.id, username: actor.username },
		});
		expect(data.worklogs).toHaveLength(1);
		expect(data.worklogs[0]).toMatchObject({
			seconds: 5400,
			comment: "Loader work",
			author: { id: actor.id },
		});
		expect(Object.keys(data.worklogs[0] as object).sort()).toEqual([
			"author",
			"comment",
			"id",
			"seconds",
			"started",
		]);
		expect(data.history).toHaveLength(1);
		const items = data.history[0]?.items ?? [];
		expect(items.map((item) => item.field)).toEqual([
			"summary",
			"status",
			"Sprint",
		]);
		expect(items[0]).toMatchObject({
			field: "summary",
			toText: "Activity loader issue",
		});
		expect(items[1]).toMatchObject({
			field: "status",
			fromText: "To Do",
			toText: "Done",
		});
		expect(items.every((item) => !("from" in item) && !("to" in item))).toBe(
			true,
		);
		expect(JSON.stringify(data.history)).not.toContain("hidden@example.test");
	});

	test("an issue the actor may not browse is a 404", async () => {
		await expect(
			loadIssueActivity(actor, hidden.issueKeys[0] as string),
		).rejects.toMatchObject({ status: 404, message: "Issue not found" });
	});

	test("a missing issue is a 404", async () => {
		await expect(loadIssueActivity(actor, "NOPE-999999")).rejects.toMatchObject(
			{ status: 404 },
		);
	});

	test("internal comments are hidden from a customer on a service desk project", async () => {
		const data = await loadIssueActivity(actor, desk.issueKeys[0] as string);

		expect(data.comments.map((comment) => comment.bodyHtml)).toEqual([
			"<p>Desk public</p>",
		]);
		expect(JSON.stringify(data.comments)).not.toContain("Desk internal");
	});
});
