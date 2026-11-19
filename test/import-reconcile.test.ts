import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pool, runMigrations } from "../src/importer/db.ts";
import { importDataset } from "../src/importer/import.ts";
import {
	fixtureBaseUrl,
	fixtureDataset,
	fixtureProjectKey,
	fixtureWorkflowName,
} from "./fixtures/jira.ts";

async function cleanup() {
	await pool.query("delete from projects where key = $1", [fixtureProjectKey]);
	await pool.query("delete from workflows where name = $1", [
		fixtureWorkflowName,
	]);
	await pool.query("delete from issue_types where source_id like 'fixture-%'");
	await pool.query("delete from statuses where source_id like 'fixture-%'");
	await pool.query("delete from priorities where source_id like 'fixture-%'");
	await pool.query("delete from resolutions where source_id like 'fixture-%'");
	await pool.query("delete from link_types where source_id like 'fixture-%'");
	await pool.query(
		"delete from fields where source_id like 'customfield_99%' or source_id like 'customfield_2000%'",
	);
	await pool.query("delete from users where username like 'fixture_%'");
}

async function issueId(key: string) {
	const { rows } = await pool.query<{ id: string }>(
		"select id from issues where key = $1",
		[key],
	);
	if (!rows[0]) throw new Error(`issue ${key} was not imported`);
	return rows[0].id;
}

async function importFixture() {
	return importDataset(fixtureDataset(), {
		baseUrl: fixtureBaseUrl,
		fullImport: true,
	});
}

beforeAll(async () => {
	await runMigrations();
	await cleanup();
});

afterAll(async () => {
	await cleanup();
	await pool.end();
});

describe("import reconciliation", () => {
	test("removes remotely deleted children and keeps locally added ones", async () => {
		await importFixture();
		const first = await issueId("FIXT-1");
		const second = await issueId("FIXT-2");
		const { rows: users } = await pool.query<{ id: string }>(
			"select id from users where username = 'fixture_other'",
		);
		const { rows: linkTypes } = await pool.query<{ id: string }>(
			"select id from link_types where source_id = 'fixture-link'",
		);
		if (!users[0] || !linkTypes[0]) {
			throw new Error("fixture references were not imported");
		}

		await pool.query(
			"insert into issue_labels (source_id, issue_id, label) values (null, $1, 'local-label')",
			[first],
		);
		await pool.query(
			"insert into watchers (source_id, issue_id, user_id) values (null, $1, $2)",
			[first, users[0].id],
		);
		await pool.query(
			`insert into comments (source_id, issue_id, body_html, created, updated, internal)
			 values ($1, $2, '<p>local comment</p>', now(), now(), false)`,
			[`local:${randomUUID()}`, first],
		);
		await pool.query(
			`insert into issue_links (source_id, type_id, source_issue_id, target_issue_id)
			 values ($1, $2, $3, $4)`,
			[`local:${randomUUID()}`, linkTypes[0].id, first, second],
		);

		const dataset = fixtureDataset();
		dataset.issues[0].issue.fields.labels = ["fixture"];
		dataset.issues[0].watchers = [];
		dataset.issues[0].comments = dataset.issues[0].comments.filter(
			(comment) => comment.id !== "fixture-comment-1",
		);
		dataset.issues[0].issue.fields.issuelinks = [];

		await importDataset(dataset, {
			baseUrl: fixtureBaseUrl,
			fullImport: true,
		});

		const { rows: labels } = await pool.query<{ label: string }>(
			"select label from issue_labels where issue_id = $1 order by label",
			[first],
		);
		expect(labels.map((row) => row.label)).toEqual(["fixture", "local-label"]);

		const { rows: watchers } = await pool.query<{ username: string }>(
			`select u.username from watchers w join users u on u.id = w.user_id
			 where w.issue_id = $1 order by u.username`,
			[first],
		);
		expect(watchers.map((row) => row.username)).toEqual(["fixture_other"]);

		const { rows: comments } = await pool.query<{
			source_id: string;
			body_html: string;
		}>(
			`select source_id, body_html from comments
			 where issue_id = $1 order by source_id`,
			[first],
		);
		const localComment = comments.find((row) =>
			row.source_id.startsWith("local:"),
		);
		expect(localComment?.body_html).toBe("<p>local comment</p>");
		expect(
			comments
				.filter((row) => !row.source_id.startsWith("local:"))
				.map((row) => row.source_id),
		).toEqual(["fixture-comment-2"]);
		expect(comments.some((row) => row.source_id === "fixture-comment-1")).toBe(
			false,
		);

		const { rows: links } = await pool.query<{ source_id: string }>(
			`select source_id from issue_links
			 where source_issue_id = $1 or target_issue_id = $1 order by source_id`,
			[first],
		);
		expect(links).toHaveLength(1);
		expect(links[0]?.source_id.startsWith("local:")).toBe(true);
	});

	test("removes stale project workflow, workflow status and transition rows", async () => {
		await importFixture();
		const { rows: projects } = await pool.query<{ id: string }>(
			"select id from projects where key = $1",
			[fixtureProjectKey],
		);
		const { rows: workflows } = await pool.query<{ id: string }>(
			"select id from workflows where name = $1",
			[fixtureWorkflowName],
		);
		const { rows: issueTypes } = await pool.query<{ id: string }>(
			"select id from issue_types where source_id = 'fixture-type-task'",
		);
		if (!projects[0] || !workflows[0] || !issueTypes[0]) {
			throw new Error("fixture project or workflow was not imported");
		}

		await pool.query(
			`insert into project_workflows (source_id, project_id, issue_type_id, workflow_id)
			 values ('jira:fixture-stale-project-workflow', $1, $2, $3)`,
			[projects[0].id, issueTypes[0].id, workflows[0].id],
		);
		const { rows: statuses } = await pool.query<{ id: string }>(
			`insert into statuses (source_id, name, category)
			 values ('fixture-stale-status', 'Fixture Stale', 'new') returning id`,
		);
		if (!statuses[0]) throw new Error("stale status was not inserted");
		await pool.query(
			`insert into workflow_statuses (source_id, workflow_id, status_id)
			 values ('jira:fixture-stale-workflow-status', $1, $2)`,
			[workflows[0].id, statuses[0].id],
		);
		await pool.query(
			`insert into workflow_transitions
			 (source_id, workflow_id, name, from_status_id, to_status_id, sequence)
			 values ('fixture-stale-transition', $1, 'Fixture Stale', null, $2, 999)`,
			[workflows[0].id, statuses[0].id],
		);

		await importFixture();

		const { rows: projectWorkflows } = await pool.query<{
			issue_type_id: string | null;
		}>("select issue_type_id from project_workflows where project_id = $1", [
			projects[0].id,
		]);
		expect(projectWorkflows).toEqual([{ issue_type_id: null }]);

		const { rows: workflowStatuses } = await pool.query(
			"select id from workflow_statuses where status_id = $1",
			[statuses[0].id],
		);
		expect(workflowStatuses).toEqual([]);

		const { rows: transitions } = await pool.query(
			"select id from workflow_transitions where source_id = 'fixture-stale-transition'",
		);
		expect(transitions).toEqual([]);
	});

	test("keeps workflow and project rows that were created in the app", async () => {
		await importFixture();
		const { rows: projects } = await pool.query<{ id: string }>(
			"select id from projects where key = $1",
			[fixtureProjectKey],
		);
		const { rows: workflows } = await pool.query<{ id: string }>(
			"select id from workflows where name = $1",
			[fixtureWorkflowName],
		);
		const { rows: issueTypes } = await pool.query<{ id: string }>(
			`insert into issue_types (source_id, name)
			 values ('fixture-local-type', 'Fixture Local Type') returning id`,
		);
		const { rows: statuses } = await pool.query<{ id: string }>(
			`insert into statuses (source_id, name, category)
			 values ('fixture-local-status', 'Fixture Local', 'new') returning id`,
		);
		if (!projects[0] || !workflows[0] || !issueTypes[0] || !statuses[0]) {
			throw new Error("fixture rows were not created");
		}

		await pool.query(
			`insert into project_issue_types (source_id, project_id, issue_type_id)
			 values ($1, $2, $3)`,
			[`local:${randomUUID()}`, projects[0].id, issueTypes[0].id],
		);
		await pool.query(
			`insert into project_workflows (source_id, project_id, issue_type_id, workflow_id)
			 values ($1, $2, $3, $4)`,
			[
				`local:${randomUUID()}`,
				projects[0].id,
				issueTypes[0].id,
				workflows[0].id,
			],
		);
		await pool.query(
			`insert into workflow_statuses (source_id, workflow_id, status_id)
			 values ($1, $2, $3)`,
			[`local:${randomUUID()}`, workflows[0].id, statuses[0].id],
		);
		await pool.query(
			`insert into workflow_transitions
			 (source_id, workflow_id, name, from_status_id, to_status_id, sequence)
			 values ($1, $2, 'Fixture Local', null, $3, 998)`,
			[`local:${randomUUID()}`, workflows[0].id, statuses[0].id],
		);

		await importFixture();

		const counts = async (table: string, column: string, id: string) =>
			(
				await pool.query<{ count: string }>(
					`select count(*) from ${table} where ${column} = $1`,
					[id],
				)
			).rows[0]?.count;
		expect(
			await counts("project_issue_types", "issue_type_id", issueTypes[0].id),
		).toBe("1");
		expect(
			await counts("project_workflows", "issue_type_id", issueTypes[0].id),
		).toBe("1");
		expect(await counts("workflow_statuses", "status_id", statuses[0].id)).toBe(
			"1",
		);
		expect(
			await counts("workflow_transitions", "to_status_id", statuses[0].id),
		).toBe("1");
	});
});
