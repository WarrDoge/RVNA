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

beforeAll(async () => {
	await runMigrations();
	await cleanup();
	await importDataset(fixtureDataset(), {
		baseUrl: fixtureBaseUrl,
		fullImport: true,
	});
});

afterAll(async () => {
	await cleanup();
	await pool.end();
});

describe("nullable source fields", () => {
	test("preserves existing values when Jira omits rendered and user fields", async () => {
		const first = await issueId("FIXT-1");
		await pool.query(
			"update users set email = $1, avatar_url = $2 where username = 'fixture_reporter'",
			["local@example.test", "/local/avatar.png"],
		);
		await pool.query(
			"update issues set description_html = $1, description_source = $2 where id = $3",
			["<p>local description</p>", "local description", first],
		);
		await pool.query(
			"update comments set body_html = $1, body_source = $2 where source_id = 'fixture-comment-1'",
			["<p>local comment</p>", "local comment"],
		);
		await pool.query(
			"update worklogs set seconds = 1234 where source_id = 'fixture-worklog-1'",
		);

		const dataset = fixtureDataset();
		dataset.users[0] = {
			...dataset.users[0],
			emailAddress: undefined,
			avatarUrls: undefined,
		};
		delete dataset.issues[0].issue.renderedFields;
		dataset.issues[0].issue.fields.description = undefined;
		dataset.issues[0].comments[0] = {
			...dataset.issues[0].comments[0],
			renderedBody: undefined,
			body: undefined,
		};
		dataset.issues[0].worklogs[0] = {
			...dataset.issues[0].worklogs[0],
			timeSpentSeconds: undefined,
		};

		const result = await importDataset(dataset, {
			baseUrl: fixtureBaseUrl,
			fullImport: true,
		});

		expect(result.counts.issues?.updated).toBe(0);
		expect(result.counts.comments?.updated).toBe(0);
		expect(result.counts.worklogs?.updated).toBe(0);
		expect(result.counts.users?.updated).toBe(0);

		const { rows: users } = await pool.query<{
			email: string;
			avatar_url: string;
		}>(
			"select email, avatar_url from users where username = 'fixture_reporter'",
		);
		expect(users[0]).toEqual({
			email: "local@example.test",
			avatar_url: "/local/avatar.png",
		});

		const { rows: issues } = await pool.query<{
			description_html: string;
			description_source: string;
		}>(
			"select description_html, description_source from issues where id = $1",
			[first],
		);
		expect(issues[0]).toEqual({
			description_html: "<p>local description</p>",
			description_source: "local description",
		});

		const { rows: comments } = await pool.query<{
			body_html: string;
			body_source: string;
		}>(
			"select body_html, body_source from comments where source_id = 'fixture-comment-1'",
		);
		expect(comments[0]).toEqual({
			body_html: "<p>local comment</p>",
			body_source: "local comment",
		});

		const { rows: worklogs } = await pool.query<{ seconds: number }>(
			"select seconds from worklogs where source_id = 'fixture-worklog-1'",
		);
		expect(worklogs[0]?.seconds).toBe(1234);
	});
});
