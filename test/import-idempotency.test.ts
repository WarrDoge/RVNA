import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { pool, runMigrations } from "../src/importer/db.ts";
import { fetchWorkflows } from "../src/importer/fetch.ts";
import { importDataset } from "../src/importer/import.ts";
import { JiraClient } from "../src/importer/jira.ts";
import type { JiraWorkflowLayout } from "../src/importer/types.ts";
import {
	fixtureBaseUrl,
	fixtureDataset,
	fixtureFieldIds,
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

async function projectId() {
	const { rows } = await pool.query<{ id: string }>(
		"select id from projects where key = $1",
		[fixtureProjectKey],
	);
	return rows[0]?.id ?? "";
}

async function rowCounts() {
	const id = await projectId();
	const { rows } = await pool.query<{ name: string; count: number }>(
		`
		select 'issues' as name, count(*)::int as count from issues where project_id = $1
		union all select 'comments', count(*)::int from comments where issue_id in (select id from issues where project_id = $1)
		union all select 'worklogs', count(*)::int from worklogs where issue_id in (select id from issues where project_id = $1)
		union all select 'watchers', count(*)::int from watchers where issue_id in (select id from issues where project_id = $1)
		union all select 'issue_links', count(*)::int from issue_links where source_issue_id in (select id from issues where project_id = $1)
		union all select 'issue_labels', count(*)::int from issue_labels where issue_id in (select id from issues where project_id = $1)
		union all select 'issue_components', count(*)::int from issue_components where issue_id in (select id from issues where project_id = $1)
		union all select 'issue_fix_versions', count(*)::int from issue_fix_versions where issue_id in (select id from issues where project_id = $1)
		union all select 'issue_affects_versions', count(*)::int from issue_affects_versions where issue_id in (select id from issues where project_id = $1)
		union all select 'issue_history', count(*)::int from issue_history where issue_id in (select id from issues where project_id = $1)
		union all select 'issue_history_items', count(*)::int from issue_history_items where history_id in (select id from issue_history where issue_id in (select id from issues where project_id = $1))
		union all select 'attachments', count(*)::int from attachments where issue_id in (select id from issues where project_id = $1)
		union all select 'projects', count(*)::int from projects where id = $1
		union all select 'components', count(*)::int from components where project_id = $1
		union all select 'versions', count(*)::int from versions where project_id = $1
		union all select 'project_workflows', count(*)::int from project_workflows where project_id = $1
		union all select 'project_issue_types', count(*)::int from project_issue_types where project_id = $1
		union all select 'fields', count(*)::int from fields where source_id like 'customfield_99%'
		union all select 'field_options', count(*)::int from field_options where field_id in (select id from fields where source_id like 'customfield_99%')
		union all select 'workflows', count(*)::int from workflows where name = $2
		union all select 'workflow_statuses', count(*)::int from workflow_statuses where workflow_id in (select id from workflows where name = $2)
		union all select 'workflow_transitions', count(*)::int from workflow_transitions where workflow_id in (select id from workflows where name = $2)
		union all select 'users', count(*)::int from users where username like 'fixture_%'
		`,
		[id, fixtureWorkflowName],
	);
	return Object.fromEntries(rows.map((row) => [row.name, row.count]));
}

async function issueTimestamps() {
	const id = await projectId();
	const { rows } = await pool.query<{ key: string; updated_at: string }>(
		"select key, updated_at::text from issues where project_id = $1 order by key",
		[id],
	);
	return rows;
}

beforeAll(async () => {
	await runMigrations();
	await cleanup();
});

afterAll(async () => {
	await cleanup();
	await pool.end();
});

describe("import idempotency", () => {
	test("a second import changes no rows and no updated_at values", async () => {
		const first = await importDataset(fixtureDataset(), {
			baseUrl: fixtureBaseUrl,
			fullImport: true,
		});
		expect(first.counts.issues?.inserted).toBe(3);
		expect(first.counts.comments?.inserted).toBe(2);
		expect(first.counts.worklogs?.inserted).toBe(1);
		expect(first.counts.watchers?.inserted).toBe(1);
		expect(first.counts.issue_links?.inserted).toBe(1);
		expect(first.counts.issue_history?.inserted).toBe(1);
		expect(first.counts.issue_history_items?.inserted).toBe(1);
		expect(first.counts.field_options?.inserted).toBe(3);
		expect(first.counts.project_workflows?.inserted).toBe(1);
		expect(first.linksSkipped).toBe(0);

		const beforeCounts = await rowCounts();
		const beforeTimestamps = await issueTimestamps();

		const second = await importDataset(fixtureDataset(), {
			baseUrl: fixtureBaseUrl,
			fullImport: true,
		});

		for (const [table, counts] of Object.entries(second.counts)) {
			expect(counts.inserted, `${table} inserted`).toBe(0);
			expect(counts.updated, `${table} updated`).toBe(0);
		}

		expect(await rowCounts()).toEqual(beforeCounts);
		expect(await issueTimestamps()).toEqual(beforeTimestamps);
	});

	test("never lowers a project's last issue number on re-import", async () => {
		const id = await projectId();
		await pool.query(
			"update projects set last_issue_number = 10 where id = $1",
			[id],
		);
		await importDataset(fixtureDataset(), {
			baseUrl: fixtureBaseUrl,
			fullImport: true,
		});
		let { rows } = await pool.query<{ last_issue_number: number }>(
			"select last_issue_number from projects where id = $1",
			[id],
		);
		expect(rows[0]?.last_issue_number).toBe(10);

		await pool.query(
			"update projects set last_issue_number = 1 where id = $1",
			[id],
		);
		await importDataset(fixtureDataset(), {
			baseUrl: fixtureBaseUrl,
			fullImport: true,
		});
		({ rows } = await pool.query<{ last_issue_number: number }>(
			"select last_issue_number from projects where id = $1",
			[id],
		));
		expect(rows[0]?.last_issue_number).toBe(3);
	});

	test("resolves the forward epic link and stores mapped values", async () => {
		const id = await projectId();
		const { rows: epic } = await pool.query<{ epic: string }>(
			`
			select epic.key as epic
			from issues issue
			join issues epic on epic.id = issue.epic_id
			where issue.project_id = $1 and issue.key = 'FIXT-1'
			`,
			[id],
		);
		expect(epic[0]?.epic).toBe("FIXT-2");

		const { rows: parent } = await pool.query<{ parent: string }>(
			`
			select parent.key as parent
			from issues issue
			join issues parent on parent.id = issue.parent_id
			where issue.project_id = $1 and issue.key = 'FIXT-3'
			`,
			[id],
		);
		expect(parent[0]?.parent).toBe("FIXT-1");

		const { rows: link } = await pool.query<{
			source: string;
			target: string;
		}>(
			`
			select source.key as source, target.key as target
			from issue_links link
			join issues source on source.id = link.source_issue_id
			join issues target on target.id = link.target_issue_id
			where link.source_id = 'fixture-link-1'
			`,
		);
		expect(link[0]).toEqual({ source: "FIXT-1", target: "FIXT-3" });

		const { rows: comments } = await pool.query<{
			source_id: string;
			internal: boolean;
		}>(
			"select source_id, internal from comments where source_id like 'fixture-comment-%' order by source_id",
		);
		expect(comments).toEqual([
			{ source_id: "fixture-comment-1", internal: false },
			{ source_id: "fixture-comment-2", internal: true },
		]);

		const { rows: custom } = await pool.query<{
			custom: Record<string, unknown>;
		}>("select custom from issues where key = 'FIXT-1'");
		expect(custom[0]?.custom).toEqual({
			customfield_99001: {
				id: "fixture-option-1",
				value: "Option One",
			},
			[fixtureFieldIds.sprint]: ["Fixture Sprint 1"],
		});

		const { rows: workflow } = await pool.query<{
			issue_type_id: string | null;
		}>("select issue_type_id from project_workflows where project_id = $1", [
			id,
		]);
		expect(workflow).toEqual([{ issue_type_id: null }]);
	});

	test("imports transition screens and upserts the resolution flag", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const base = fixtureDataset().workflows[0];
		if (!base) throw new Error("fixture workflow is missing");
		const transitions: JiraWorkflowLayout["layout"]["transitions"] = [
			{
				id: "A<1:S<1>:S<2>>",
				name: "Fixture Done",
				sourceId: "S<1>",
				targetId: "S<2>",
				globalTransition: true,
				screenId: 501,
			},
			{
				id: "A<2:S<1>:S<2>>",
				name: "Fixture Done",
				sourceId: "S<1>",
				targetId: "S<2>",
				screenId: 502,
			},
			{
				id: "A<3:S<2>:S<1>>",
				name: "Fixture Reopen",
				sourceId: "S<2>",
				targetId: "S<1>",
			},
			{
				id: "A<4:S<1>:S<2>>",
				name: "Fixture Done",
				sourceId: "S<1>",
				targetId: "S<2>",
				screenId: 503,
			},
		];
		const fetchImpl = (async (input: string | URL | Request) => {
			const url = new URL(String(input));
			const path = url.pathname;
			if (path === "/rest/api/2/workflow") {
				return Response.json([{ name: fixtureWorkflowName }]);
			}
			if (path === "/rest/workflowDesigner/1.0/workflows") {
				return Response.json({
					layout: { statuses: base.layout.statuses, transitions },
				});
			}
			if (path === "/rest/api/2/screens/501/tabs") {
				return Response.json([{ id: 1 }]);
			}
			if (path === "/rest/api/2/screens/501/tabs/1/fields") {
				return Response.json([{ id: "resolution" }]);
			}
			if (path === "/rest/api/2/screens/502/tabs") {
				return Response.json([{ id: 2 }]);
			}
			if (path === "/rest/api/2/screens/502/tabs/2/fields") {
				return Response.json([{ id: "issuelinks" }]);
			}
			if (path === "/rest/api/2/screens/503/tabs") {
				return new Response("missing", { status: 404 });
			}
			return new Response("missing", { status: 404 });
		}) as typeof fetch;
		const workflows = await fetchWorkflows(
			new JiraClient({
				baseUrl: fixtureBaseUrl,
				token: "fixture-token",
				fetchImpl,
			}),
			{ privateApis: true },
		);
		const dataset = fixtureDataset();
		dataset.workflows = workflows;

		await pool.query(
			`delete from workflow_transitions
			 where workflow_id in (select id from workflows where name = $1)`,
			[fixtureWorkflowName],
		);
		const first = await importDataset(dataset, {
			baseUrl: fixtureBaseUrl,
			fullImport: true,
		});
		expect(first.counts.workflow_transitions).toEqual({
			inserted: 4,
			updated: 0,
			unchanged: 0,
		});
		const flags = async () =>
			(
				await pool.query<{ source_id: string; asks_resolution: boolean }>(
					`select transition.source_id, transition.asks_resolution
					 from workflow_transitions transition
					 join workflows workflow on workflow.id = transition.workflow_id
					 where workflow.name = $1
					 order by transition.source_id`,
					[fixtureWorkflowName],
				)
			).rows;
		expect(await flags()).toEqual([
			{ source_id: "A<1:S<1>:S<2>>", asks_resolution: true },
			{ source_id: "A<2:S<1>:S<2>>", asks_resolution: false },
			{ source_id: "A<3:S<2>:S<1>>", asks_resolution: false },
			{ source_id: "A<4:S<1>:S<2>>", asks_resolution: false },
		]);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0]?.[0]).toContain("screen 503");

		const second = await importDataset(dataset, {
			baseUrl: fixtureBaseUrl,
			fullImport: true,
		});
		expect(second.counts.workflow_transitions).toEqual({
			inserted: 0,
			updated: 0,
			unchanged: 4,
		});

		await pool.query(
			`update workflow_transitions set asks_resolution = false
			 where source_id = 'A<1:S<1>:S<2>>'
			   and workflow_id = (select id from workflows where name = $1)`,
			[fixtureWorkflowName],
		);
		const third = await importDataset(dataset, {
			baseUrl: fixtureBaseUrl,
			fullImport: true,
		});
		expect(third.counts.workflow_transitions).toEqual({
			inserted: 0,
			updated: 1,
			unchanged: 3,
		});
		expect((await flags())[0]).toEqual({
			source_id: "A<1:S<1>:S<2>>",
			asks_resolution: true,
		});
		warn.mockRestore();
	});

	test("an import without Jira Software fields maps no epic, rank or story points", async () => {
		await cleanup();
		const dataset = structuredClone(fixtureDataset());
		dataset.fields = dataset.fields.filter(
			(field) => field.id === "customfield_99001",
		);
		for (const data of dataset.issues) {
			delete data.issue.fields[
				fixtureFieldIds.epicLink as `customfield_${string}`
			];
			delete data.issue.fields[
				fixtureFieldIds.storyPoints as `customfield_${string}`
			];
			delete data.issue.fields[fixtureFieldIds.rank as `customfield_${string}`];
			delete data.issue.fields[
				fixtureFieldIds.sprint as `customfield_${string}`
			];
		}

		await importDataset(dataset, {
			baseUrl: fixtureBaseUrl,
			fullImport: true,
		});

		const { rows } = await pool.query<{
			story_points: number | null;
			rank: string | null;
			epic_id: string | null;
		}>("select story_points, rank, epic_id from issues where key = 'FIXT-1'");
		expect(rows[0]).toEqual({
			story_points: null,
			rank: null,
			epic_id: null,
		});
	});
});
