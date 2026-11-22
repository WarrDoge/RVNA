import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pool, runMigrations } from "../src/importer/db.ts";
import { pool as serverPool } from "../src/lib/server/db.ts";
import { rebuildSlaCycles } from "../src/lib/server/sla/rebuild.ts";

const workingHours = JSON.stringify(
	Array.from({ length: 7 }, () => [{ start: 0, end: 1440 }]),
);
const start = JSON.stringify([{ type: "issue_created" }]);
const stop = JSON.stringify([{ type: "resolution_set" }]);

async function cleanup() {
	await pool.query(
		"delete from projects where key like 'SLARB%' or key like 'SLAX%'",
	);
	await pool.query("delete from sla_calendars where source_id = 'slarb-cal'");
	await pool.query("delete from issue_types where source_id like 'slarb-%'");
	await pool.query("delete from statuses where source_id like 'slarb-%'");
	await pool.query("delete from users where username = 'slarb_user'");
}

beforeAll(async () => {
	await runMigrations();
	await cleanup();
});

afterAll(async () => {
	await cleanup();
	await pool.end();
});

describe("SLA rebuild scoping", () => {
	test("only computes a desk's metrics for issues in its project", async () => {
		const { rows: projects } = await pool.query<{ id: string; key: string }>(
			`insert into projects (source_id, key, name, project_type)
			 values ('slarb-p1', 'SLARB1', 'SLARB One', 'service_desk'),
			        ('slarb-p2', 'SLARB2', 'SLARB Two', 'service_desk')
			 returning id, key`,
		);
		const projectOne = projects.find((row) => row.key === "SLARB1");
		const projectTwo = projects.find((row) => row.key === "SLARB2");
		if (!projectOne || !projectTwo) throw new Error("projects missing");

		const { rows: types } = await pool.query<{ id: string }>(
			`insert into issue_types (source_id, name)
			 values ('slarb-type', 'SLARB Type') returning id`,
		);
		const { rows: statuses } = await pool.query<{ id: string }>(
			`insert into statuses (source_id, name, category)
			 values ('slarb-status', 'SLARB Status', 'new') returning id`,
		);
		if (!types[0] || !statuses[0]) throw new Error("metadata missing");

		const { rows: issues } = await pool.query<{ id: string }>(
			`insert into issues
			 (source_id, project_id, number, key, type_id, status_id, summary, created)
			 values ('slarb-i1', $1, 1, 'SLARB1-1', $3, $4, 'One', '2026-01-05T09:00:00Z'),
			        ('slarb-i2', $2, 1, 'SLARB2-1', $3, $4, 'Two', '2026-01-05T09:00:00Z')
			 returning id`,
			[projectOne.id, projectTwo.id, types[0].id, statuses[0].id],
		);

		const { rows: desks } = await pool.query<{ id: string }>(
			`insert into service_desks (source_id, project_id, portal_name)
			 values ('slarb-d1', $1, 'Desk One'), ('slarb-d2', $2, 'Desk Two')
			 returning id`,
			[projectOne.id, projectTwo.id],
		);
		if (desks.length !== 2) throw new Error("desks missing");

		const { rows: calendars } = await pool.query<{ id: string }>(
			`insert into sla_calendars
			 (source_id, name, timezone, working_hours, holidays)
			 values ('slarb-cal', 'SLARB 24/7', 'UTC', $1::jsonb, '[]'::jsonb)
			 returning id`,
			[workingHours],
		);
		if (!calendars[0]) throw new Error("calendar missing");

		const { rows: metrics } = await pool.query<{ id: string }>(
			`insert into sla_metrics
			 (source_id, desk_id, name, start_conditions, pause_conditions, stop_conditions)
			 values ('slarb-m1', $1, 'Metric One', $3::jsonb, '[]'::jsonb, $4::jsonb),
			        ('slarb-m2', $2, 'Metric Two', $3::jsonb, '[]'::jsonb, $4::jsonb)
			 returning id`,
			[desks[0].id, desks[1].id, start, stop],
		);
		if (metrics.length !== 2) throw new Error("metrics missing");

		await pool.query(
			`insert into sla_goals
			 (source_id, metric_id, jql, goal_minutes, calendar_id, sequence)
			 values ('slarb-g1', $1, '', 60, $3, 0),
			        ('slarb-g2', $2, '', 60, $3, 0)`,
			[metrics[0].id, metrics[1].id, calendars[0].id],
		);

		const result = await rebuildSlaCycles({
			issueIds: issues.map((issue) => issue.id),
			now: new Date("2026-01-05T10:00:00Z"),
		});
		expect(result).toEqual({ issues: 2, cycles: 2 });

		const { rows: cycles } = await pool.query<{
			key: string;
			source_id: string;
		}>(
			`select i.key, m.source_id
			 from sla_cycles c
			 join issues i on i.id = c.issue_id
			 join sla_metrics m on m.id = c.metric_id
			 where c.issue_id = any($1)
			 order by i.key`,
			[issues.map((issue) => issue.id)],
		);
		expect(cycles).toEqual([
			{ key: "SLARB1-1", source_id: "slarb-m1" },
			{ key: "SLARB2-1", source_id: "slarb-m2" },
		]);
	});
});

async function cyclesAt(issueId: string, metricId: string) {
	await rebuildSlaCycles({
		issueIds: [issueId],
		now: new Date("2026-01-05T11:00:00Z"),
	});
	const { rows } = await pool.query<{
		cycle_number: number;
		started_at: Date;
		stopped_at: Date | null;
		elapsed_minutes: number;
	}>(
		`select cycle_number, started_at, stopped_at, elapsed_minutes
		 from sla_cycles where issue_id = $1 and metric_id = $2
		 order by cycle_number`,
		[issueId, metricId],
	);
	return rows;
}

test("history events at the same instant keep a stable order", async () => {
	const { rows: projects } = await pool.query<{ id: string }>(
		"select id from projects where key = 'SLARB1'",
	);
	const { rows: desks } = await pool.query<{ id: string }>(
		"select id from service_desks where source_id = 'slarb-d1'",
	);
	const { rows: calendars } = await pool.query<{ id: string }>(
		"select id from sla_calendars where source_id = 'slarb-cal'",
	);
	const { rows: types } = await pool.query<{ id: string }>(
		"select id from issue_types where source_id = 'slarb-type'",
	);
	if (!projects[0] || !desks[0] || !calendars[0] || !types[0]) {
		throw new Error("fixture missing");
	}
	const { rows: statuses } = await pool.query<{
		id: string;
		source_id: string;
	}>(
		`insert into statuses (source_id, name, category)
		 values ('slarb-status-open', 'SLARB Open', 'indeterminate'),
		        ('slarb-status-done', 'SLARB Done', 'done')
		 returning id, source_id`,
	);
	const open = statuses.find((row) => row.source_id === "slarb-status-open");
	const done = statuses.find((row) => row.source_id === "slarb-status-done");
	if (!open || !done) throw new Error("statuses missing");

	const { rows: metrics } = await pool.query<{ id: string }>(
		`insert into sla_metrics
		 (source_id, desk_id, name, start_conditions, pause_conditions, stop_conditions)
		 values ('slarb-m-order', $1, 'SLARB Order',
		         $2::jsonb, '[]'::jsonb, $3::jsonb)
		 returning id`,
		[
			desks[0].id,
			JSON.stringify([{ type: "entered_status", statusId: open.id }]),
			JSON.stringify([{ type: "entered_status", statusId: done.id }]),
		],
	);
	if (!metrics[0]) throw new Error("metric missing");
	await pool.query(
		`insert into sla_goals (source_id, metric_id, jql, goal_minutes, calendar_id, sequence)
		 values ('slarb-g-order', $1, '', 60, $2, 0)`,
		[metrics[0].id, calendars[0].id],
	);

	const { rows: issues } = await pool.query<{ id: string }>(
		`insert into issues
		 (source_id, project_id, number, key, type_id, status_id, summary, created)
		 values ('slarb-i-order', $1, 100, 'SLARB1-100', $2, $3, 'Same instant',
		         '2026-01-05T09:00:00Z')
		 returning id`,
		[projects[0].id, types[0].id, open.id],
	);
	if (!issues[0]) throw new Error("issue missing");
	const issueId = issues[0].id;
	const at = "2026-01-05T10:00:00Z";

	const addHistory = async (
		id: string,
		sourceId: string,
		created: string,
		statusId: string,
	) => {
		await pool.query(
			`insert into issue_history (id, source_id, issue_id, created)
			 values ($1, $2, $3, $4)`,
			[id, sourceId, issueId, created],
		);
		await pool.query(
			`insert into issue_history_items
			 (source_id, history_id, field, from_value, from_string, to_value, to_string, sequence)
			 values ($1, $2, 'status', null, null, $3, $3, 0)`,
			[`${sourceId}-item`, id, statusId],
		);
	};

	const doneHistoryId = randomUUID();
	const openHistoryId = randomUUID();
	await addHistory(
		randomUUID(),
		"slarb-h-open-start",
		"2026-01-05T09:30:00Z",
		open.id,
	);
	await addHistory(doneHistoryId, "slarb-h-done", at, done.id);
	await addHistory(openHistoryId, "slarb-h-open", at, open.id);

	const first = await cyclesAt(issueId, metrics[0].id);

	await pool.query("delete from issue_history where id = any($1::uuid[])", [
		[doneHistoryId, openHistoryId],
	]);
	await addHistory(openHistoryId, "slarb-h-open", at, open.id);
	await addHistory(doneHistoryId, "slarb-h-done", at, done.id);

	const second = await cyclesAt(issueId, metrics[0].id);
	expect(second).toEqual(first);
});

test("two goals of one metric may use the default sequence", async () => {
	const { rows: metrics } = await pool.query<{ id: string }>(
		"select id from sla_metrics where source_id = 'slarb-m1'",
	);
	const { rows: calendars } = await pool.query<{ id: string }>(
		"select id from sla_calendars where source_id = 'slarb-cal'",
	);
	if (!metrics[0] || !calendars[0]) throw new Error("fixture missing");

	await pool.query(
		`insert into sla_goals (source_id, metric_id, jql, goal_minutes, calendar_id)
		 values ('slarb-g3', $1, '', 60, $2), ('slarb-g4', $1, '', 120, $2)`,
		[metrics[0].id, calendars[0].id],
	);
	const { rows } = await pool.query<{ sequence: number }>(
		"select sequence from sla_goals where source_id in ('slarb-g3', 'slarb-g4') order by source_id",
	);
	expect(rows.map((row) => row.sequence)).toEqual([0, 0]);
});

test("goal JQL is restricted to the issues being rebuilt and runs in parallel", async () => {
	const { rows: metrics } = await pool.query<{ id: string }>(
		"select id from sla_metrics where source_id = 'slarb-m1'",
	);
	const { rows: calendars } = await pool.query<{ id: string }>(
		"select id from sla_calendars where source_id = 'slarb-cal'",
	);
	const { rows: issues } = await pool.query<{ id: string }>(
		"select id from issues where key like 'SLARB%' order by key",
	);
	if (!metrics[0] || !calendars[0] || issues.length < 2) {
		throw new Error("fixture missing");
	}
	await pool.query(
		`insert into sla_goals (source_id, metric_id, jql, goal_minutes, calendar_id)
		 values ('slarb-g5', $1, 'project = SLARB1', 60, $2),
		        ('slarb-g6', $1, 'project = SLARB2', 60, $2)`,
		[metrics[0].id, calendars[0].id],
	);

	const original = serverPool.query.bind(serverPool);
	const goalQueries: string[] = [];
	let active = 0;
	let maxActive = 0;
	(serverPool as unknown as { query: typeof serverPool.query }).query = (async (
		query: { text?: string } | string,
		...rest: unknown[]
	) => {
		const text = typeof query === "string" ? query : (query.text ?? "");
		const isGoal = text.includes("select issues.id from issues");
		if (isGoal) {
			goalQueries.push(text);
			active += 1;
			maxActive = Math.max(maxActive, active);
			await new Promise((resolve) => setTimeout(resolve, 30));
		}
		try {
			return await (original as (...args: unknown[]) => Promise<unknown>)(
				query,
				...rest,
			);
		} finally {
			if (isGoal) active -= 1;
		}
	}) as typeof pool.query;
	try {
		await rebuildSlaCycles({
			issueIds: issues.map((issue) => issue.id),
			now: new Date("2026-01-05T10:00:00Z"),
		});
	} finally {
		(serverPool as unknown as { query: typeof serverPool.query }).query =
			original;
	}

	expect(goalQueries).toHaveLength(2);
	expect(maxActive).toBeGreaterThan(1);
	for (const statement of goalQueries) {
		expect(statement).toContain('"issues"."id" in');
	}
});

test("a large rebuild chunks the issue ids it queries and deletes", async () => {
	await pool.query("delete from projects where key = 'SLAX1'");
	const { rows: projects } = await pool.query<{ id: string }>(
		`insert into projects (source_id, key, name, project_type)
		 values ('slax-project', 'SLAX1', 'SLAX Desk', 'service_desk')
		 returning id`,
	);
	const { rows: types } = await pool.query<{ id: string }>(
		"select id from issue_types where source_id = 'slarb-type'",
	);
	const { rows: statuses } = await pool.query<{ id: string }>(
		"select id from statuses where source_id = 'slarb-status'",
	);
	const { rows: calendars } = await pool.query<{ id: string }>(
		"select id from sla_calendars where source_id = 'slarb-cal'",
	);
	if (!projects[0] || !types[0] || !statuses[0] || !calendars[0]) {
		throw new Error("fixture missing");
	}
	const projectId = projects[0].id;

	try {
		const { rows: desks } = await pool.query<{ id: string }>(
			`insert into service_desks (source_id, project_id, portal_name)
			 values ('slax-desk', $1, 'SLAX Portal') returning id`,
			[projectId],
		);
		if (!desks[0]) throw new Error("desk missing");
		const { rows: metrics } = await pool.query<{ id: string }>(
			`insert into sla_metrics
			 (source_id, desk_id, name, start_conditions, pause_conditions, stop_conditions)
			 values ('slax-metric', $1, 'SLAX Metric', $2::jsonb, '[]'::jsonb, $3::jsonb)
			 returning id`,
			[desks[0].id, start, stop],
		);
		if (!metrics[0]) throw new Error("metric missing");
		await pool.query(
			`insert into sla_goals (source_id, metric_id, jql, goal_minutes, calendar_id)
			 values ('slax-goal', $1, '', 60, $2)`,
			[metrics[0].id, calendars[0].id],
		);
		await pool.query(
			`insert into issues
			 (source_id, project_id, number, key, type_id, status_id, summary, created)
			 select 'slax-issue-' || n, $1, n, 'SLAX1-' || n, $2, $3,
			        'Bulk issue ' || n, '2026-01-05T09:00:00Z'
			 from generate_series(1, 1001) as n`,
			[projectId, types[0].id, statuses[0].id],
		);

		const statements: { text: string; values: unknown[] }[] = [];
		const client = (await import("pg")).default.Client.prototype as {
			query: (...args: unknown[]) => unknown;
		};
		const original = client.query;
		client.query = function (
			this: unknown,
			query: { text?: string; values?: unknown[] } | string,
			...rest: unknown[]
		) {
			const text = typeof query === "string" ? query : (query.text ?? "");
			const values =
				(rest[0] as unknown[] | undefined) ??
				(typeof query === "string" ? undefined : query.values) ??
				[];
			statements.push({ text, values });
			return original.apply(this, [query, ...rest]);
		} as unknown as typeof client.query;
		try {
			const result = await rebuildSlaCycles({
				now: new Date("2026-01-05T10:00:00Z"),
			});
			expect(result.issues).toBeGreaterThanOrEqual(1001);
		} finally {
			client.query = original;
		}

		const watched = [
			'"comments"."issue_id" in',
			'"issue_history"."issue_id" in',
			'"sla_cycles"."issue_id" in',
			'"issues"."id" in',
		];
		const relevant = statements.filter((statement) =>
			watched.some((needle) => statement.text.includes(needle)),
		);
		expect(relevant.length).toBeGreaterThan(0);
		for (const statement of relevant) {
			for (const needle of watched) {
				if (!statement.text.includes(needle)) continue;
				const open = statement.text.indexOf(
					"(",
					statement.text.indexOf(needle),
				);
				let depth = 0;
				let placeholders = 0;
				for (let index = open; index < statement.text.length; index += 1) {
					const character = statement.text[index];
					if (character === "(") depth += 1;
					else if (character === ")") {
						depth -= 1;
						if (depth === 0) break;
					} else if (character === "$") placeholders += 1;
				}
				expect(placeholders).toBeLessThanOrEqual(1000);
			}
		}
	} finally {
		await pool.query("delete from projects where key = 'SLAX1'");
	}
});
