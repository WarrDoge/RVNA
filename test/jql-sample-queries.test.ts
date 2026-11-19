import { afterAll, describe, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";
import { searchIssues } from "../src/lib/server/search/service.ts";

const SAMPLE_QUERIES = [
	`project = DEMO ORDER BY Rank ASC`,
	`project = OPS AND resolution = Unresolved ORDER BY "Time to done" ASC`,
	`project = OPS AND assignee = currentUser() AND resolution = Unresolved AND status in ("Waiting for support", "In progress", Escalated) ORDER BY "Time to done" ASC`,
	`project = OPS AND issuetype = Incident AND created >= -60m ORDER BY created DESC`,
	`project = OPS AND resolution = Unresolved AND issuetype = Incident AND priority in (Highest, High) ORDER BY created DESC`,
	`project = OPS AND resolution = Unresolved AND issuetype = "Service Request" AND due <= 24h ORDER BY due ASC`,
	`project = OPS AND resolution = Unresolved AND issuetype = Change AND "Request type" = Access ORDER BY created DESC`,
	`project = OPS AND issuetype = Problem AND status = Completed AND resolved >= -30d`,
	`project = OPS AND resolved >= -1w ORDER BY resolved DESC`,
	`assignee = currentUser() AND resolution = Unresolved order by updated DESC`,
	`project = "WEB" AND sprint in openSprints()`,
	`issuetype in subTaskIssueTypes() AND "Epic Link" is not EMPTY`,
	`text ~ "release notes" AND updated >= startOfMonth(-1)`,
	`status was "In Progress" AND status changed to Done after -30d`,
];

const sampleProjects = ["DEMO", "OPS", "WEB"];
const { rows: sampleRows } = await pool.query(
	`select count(distinct p.key)::int as count
	 from projects p join issues i on i.project_id = p.id
	 where p.key = any($1)`,
	[sampleProjects],
);
const hasSampleData = sampleRows[0].count === sampleProjects.length;

let userId = "";
let username = "";

async function currentUser() {
	if (!userId) {
		const result = await pool.query(
			"select id, username from users order by is_admin desc, id limit 1",
		);
		userId = result.rows[0].id;
		username = result.rows[0].username;
	}
	return { id: userId, username, isAdmin: true };
}

async function total(jql: string) {
	const user = await currentUser();
	const result = await searchIssues({ jql, startAt: 0, maxResults: 1 }, user);
	return result.total;
}

afterAll(async () => {
	await pool.end();
});

describe.skipIf(!hasSampleData)("JQL sample queries", () => {
	test.each(SAMPLE_QUERIES)("runs %j", async (jql) => {
		const user = await currentUser();
		const result = await searchIssues(
			{ jql, startAt: 0, maxResults: 100 },
			user,
		);
		expect(result.total).toBeGreaterThanOrEqual(0);
		expect(result.issues.length).toBeLessThanOrEqual(100);
		for (const issue of result.issues) {
			expect(issue.key).toMatch(/^[A-Z][A-Z0-9_]*-\d+$/);
			expect(typeof issue.summary).toBe("string");
			expect(Array.isArray(issue.labels)).toBe(true);
		}
	});

	test.each([
		[
			`project = DEMO ORDER BY Rank ASC`,
			`select count(*)::int as count from issues i join projects p on p.id = i.project_id where p.key = 'DEMO'`,
		],
		[
			`project = OPS AND resolution = Unresolved ORDER BY "Time to done" ASC`,
			`select count(*)::int as count from issues i join projects p on p.id = i.project_id where p.key = 'OPS' and i.resolution_id is null`,
		],
		[
			`project = OPS AND resolution = Unresolved AND issuetype = Incident AND priority in (Highest, High) ORDER BY created DESC`,
			`select count(*)::int as count from issues i
			 join projects p on p.id = i.project_id
			 join issue_types t on t.id = i.type_id
			 join priorities pr on pr.id = i.priority_id
			 where p.key = 'OPS' and i.resolution_id is null
			   and t.name = 'Incident' and pr.name in ('Highest', 'High')`,
		],
		[
			`project = OPS AND resolution = Unresolved AND issuetype = Change AND "Request type" = Access ORDER BY created DESC`,
			`select count(*)::int as count from issues i
			 join projects p on p.id = i.project_id
			 join issue_types t on t.id = i.type_id
			 where p.key = 'OPS' and i.resolution_id is null
			   and t.name = 'Change' and i.custom->'customfield_10210'->>'value' = 'Access'`,
		],
		[
			`project = "WEB" AND sprint in openSprints()`,
			`select count(distinct i.id)::int as count from issues i
			 join projects p on p.id = i.project_id
			 join issue_sprints isp on isp.issue_id = i.id
			 join sprints s on s.id = isp.sprint_id
			 where p.key = 'WEB' and s.state = 'active'`,
		],
		[
			`issuetype in subTaskIssueTypes() AND "Epic Link" is not EMPTY`,
			`select count(*)::int as count from issues i
			 join issue_types t on t.id = i.type_id
			 where t.subtask and i.epic_id is not null`,
		],
	])("matches an independent SQL count for %j", async (jql, sql) => {
		const expected = await pool.query(sql);
		expect(await total(jql)).toBe(expected.rows[0].count);
	});

	test("matches an independent SQL count for currentUser()", async () => {
		const user = await currentUser();
		const expected = await pool.query(
			`select count(*)::int as count from issues i
			 join projects p on p.id = i.project_id
			 join statuses s on s.id = i.status_id
			 where p.key = 'OPS' and i.assignee_id = $1 and i.resolution_id is null
			   and s.name in ('Waiting for support', 'In progress', 'Escalated')`,
			[user.id],
		);
		expect(
			await total(
				`project = OPS AND assignee = currentUser() AND resolution = Unresolved AND status in ("Waiting for support", "In progress", Escalated)`,
			),
		).toBe(expected.rows[0].count);
	});
});
