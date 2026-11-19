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

beforeAll(async () => {
	await runMigrations();
	await cleanup();
});

afterAll(async () => {
	await cleanup();
	await pool.end();
});

describe("imported timestamps", () => {
	test("keep milliseconds and stay unchanged on a second import", async () => {
		const dataset = structuredClone(fixtureDataset());
		const issueData = dataset.issues.find(
			(item) => item.issue.key === "FIXT-1",
		);
		if (!issueData) throw new Error("fixture issue is missing");
		issueData.issue.fields.created = "2026-07-13T10:11:12.345+0300";
		issueData.issue.fields.updated = "2026-07-13T10:11:13.456+0300";
		issueData.issue.fields.resolutiondate = "2026-07-13T10:11:14.567+0300";
		const comment = issueData.comments[0];
		const worklog = issueData.worklogs[0];
		const history = issueData.histories[0];
		if (!comment || !worklog || !history) {
			throw new Error("fixture children are missing");
		}
		comment.created = "2026-07-13T10:11:15.678+0300";
		comment.updated = "2026-07-13T10:11:16.789+0300";
		worklog.started = "2026-07-13T10:11:17.891+0300";
		history.created = "2026-07-13T10:11:18.912+0300";
		const changelogHistory = issueData.issue.changelog?.histories?.[0];
		if (changelogHistory) {
			changelogHistory.created = "2026-07-13T10:11:18.912+0300";
		}

		await importDataset(dataset, {
			baseUrl: fixtureBaseUrl,
			fullImport: true,
		});

		const issue = await pool.query<{
			created: Date | null;
			updated: Date | null;
			resolved: Date | null;
		}>("select created, updated, resolved from issues where key = 'FIXT-1'");
		expect(issue.rows[0]?.created?.toISOString()).toBe(
			"2026-07-13T07:11:12.345Z",
		);
		expect(issue.rows[0]?.updated?.toISOString()).toBe(
			"2026-07-13T07:11:13.456Z",
		);
		expect(issue.rows[0]?.resolved?.toISOString()).toBe(
			"2026-07-13T07:11:14.567Z",
		);

		const commentRow = await pool.query<{
			created: Date | null;
			updated: Date | null;
		}>(
			"select created, updated from comments where source_id = 'fixture-comment-1'",
		);
		expect(commentRow.rows[0]?.created?.toISOString()).toBe(
			"2026-07-13T07:11:15.678Z",
		);
		expect(commentRow.rows[0]?.updated?.toISOString()).toBe(
			"2026-07-13T07:11:16.789Z",
		);

		const worklogRow = await pool.query<{ started: Date | null }>(
			"select started from worklogs where source_id = 'fixture-worklog-1'",
		);
		expect(worklogRow.rows[0]?.started?.toISOString()).toBe(
			"2026-07-13T07:11:17.891Z",
		);

		const historyRow = await pool.query<{ created: Date | null }>(
			"select created from issue_history where source_id = 'fixture-history-1'",
		);
		expect(historyRow.rows[0]?.created?.toISOString()).toBe(
			"2026-07-13T07:11:18.912Z",
		);

		const second = await importDataset(dataset, {
			baseUrl: fixtureBaseUrl,
			fullImport: true,
		});
		expect(second.counts.issues?.updated).toBe(0);
		expect(second.counts.comments?.updated).toBe(0);
		expect(second.counts.worklogs?.updated).toBe(0);
		expect(second.counts.issue_history?.updated).toBe(0);
	});
});
