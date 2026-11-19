import { afterAll, describe, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";
import { searchIssues } from "../src/lib/server/search/service.ts";

const ready = (
	await pool.query<{ ready: boolean }>(
		"select to_regclass('public.projects') is not null as ready",
	)
).rows[0].ready;
const hasServiceDesk =
	ready &&
	(await pool.query("select 1 from projects where key = 'OPS' limit 1"))
		.rowCount === 1;
const hasQueues =
	hasServiceDesk &&
	(await pool.query("select 1 from queues limit 1")).rowCount === 1;

afterAll(async () => {
	await pool.end();
});

describe.skipIf(!hasQueues)("imported queue counts", () => {
	test("every queue JQL runs and matches Jira's reported count", async () => {
		const { rows } = await pool.query<{
			name: string;
			jql: string;
			issue_count: number | null;
		}>("select name, jql, issue_count from queues order by sequence");
		const { rows: users } = await pool.query<{
			id: string;
			username: string;
		}>("select id, username from users order by is_admin desc, id limit 1");
		const user = users[0] ? { ...users[0], isAdmin: true } : null;

		const comparable = rows.filter(
			(queue) =>
				!/currentuser\s*\(/i.test(queue.jql) && queue.issue_count !== null,
		);
		const perUser = rows.filter((queue) => /currentuser\s*\(/i.test(queue.jql));

		const mismatches: {
			name: string;
			ours: number;
			jira: number;
		}[] = [];
		for (const queue of comparable) {
			const result = await searchIssues(
				{ jql: queue.jql, startAt: 0, maxResults: 1 },
				user,
			);
			if (result.total !== queue.issue_count) {
				mismatches.push({
					name: queue.name,
					ours: result.total,
					jira: queue.issue_count as number,
				});
			}
		}

		for (const queue of perUser) {
			const result = await searchIssues(
				{ jql: queue.jql, startAt: 0, maxResults: 1 },
				user,
			);
			expect(result.total).toBeGreaterThanOrEqual(0);
		}

		console.log(
			`queue counts: ${comparable.length - mismatches.length}/${comparable.length} match Jira; ${perUser.length} currentUser() queues run but their Jira count is user-specific`,
		);
		expect(mismatches).toEqual([]);
		expect(comparable.length).toBeGreaterThan(0);
	});
});
