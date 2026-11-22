import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pool, runMigrations } from "../src/importer/db.ts";
import { rebuildSlaCycles } from "../src/lib/server/sla/rebuild.ts";

const workingHours = JSON.stringify(
	Array.from({ length: 7 }, () => [{ start: 0, end: 1440 }]),
);
const start = JSON.stringify([{ type: "issue_created" }]);
const stop = JSON.stringify([{ type: "resolution_set" }]);

async function cleanup() {
	await pool.query("delete from projects where key like 'SLARB%'");
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
