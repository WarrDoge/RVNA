import { afterAll, describe, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";

const ready = (
	await pool.query<{ ready: boolean }>(
		"select to_regclass('public.projects') is not null as ready",
	)
).rows[0].ready;
const hasServiceDesk =
	ready &&
	(await pool.query("select 1 from projects where key = 'OPS' limit 1"))
		.rowCount === 1;
const hasCycles =
	hasServiceDesk &&
	(await pool.query("select 1 from sla_imported_cycles limit 1")).rowCount ===
		1;

afterAll(async () => {
	await pool.end();
});

interface ParityRow {
	metric: string;
	key: string;
	computed_cycle: number | null;
	jira_cycle: number | null;
	started_at: Date | null;
	jira_started_at: Date | null;
	stopped_at: Date | null;
	jira_stopped_at: Date | null;
	elapsed_minutes: number | null;
	jira_elapsed_minutes: number | null;
	breached: boolean | null;
	jira_breached: boolean | null;
}

function secondsBetween(left: Date | null, right: Date | null) {
	if (!left || !right) return Number.POSITIVE_INFINITY;
	return Math.abs(left.getTime() - right.getTime()) / 1000;
}

describe.skipIf(!hasCycles)("SLA parity with Jira", () => {
	test("every Jira cycle has a computed cycle and the fields agree", async () => {
		const { rows } = await pool.query<ParityRow>(`
			select m.name as metric, i.key,
				c.cycle_number as computed_cycle, j.cycle_number as jira_cycle,
				c.started_at, j.started_at as jira_started_at,
				c.stopped_at, j.stopped_at as jira_stopped_at,
				c.elapsed_minutes, j.elapsed_minutes as jira_elapsed_minutes,
				c.breached, j.breached as jira_breached
			from sla_cycles c
			full join sla_imported_cycles j
				on j.issue_id = c.issue_id and j.metric_id = c.metric_id
				and j.cycle_number = c.cycle_number
			join sla_metrics m on m.id = coalesce(c.metric_id, j.metric_id)
			join issues i on i.id = coalesce(c.issue_id, j.issue_id)
			order by m.name, i.key, coalesce(c.cycle_number, j.cycle_number)
		`);

		const metrics = await pool.query<{ name: string }>(
			"select name from sla_metrics order by name",
		);
		const byMetric = new Map<string, ParityRow[]>();
		for (const metric of metrics.rows) byMetric.set(metric.name, []);
		for (const row of rows) {
			const list = byMetric.get(row.metric) ?? [];
			list.push(row);
			byMetric.set(row.metric, list);
		}

		const failures: string[] = [];
		for (const [metric, cycles] of byMetric) {
			let matched = 0;
			let ongoing = 0;
			const classes = new Map<string, number>();
			for (const cycle of cycles) {
				const problems: string[] = [];
				if (cycle.computed_cycle === null) problems.push("missing computed");
				if (cycle.jira_cycle === null) problems.push("missing Jira");
				if (cycle.computed_cycle !== null && cycle.jira_cycle !== null) {
					if (secondsBetween(cycle.started_at, cycle.jira_started_at) > 60) {
						problems.push("start");
					}
					if (
						(cycle.stopped_at === null) !== (cycle.jira_stopped_at === null) ||
						(cycle.stopped_at !== null &&
							cycle.jira_stopped_at !== null &&
							secondsBetween(cycle.stopped_at, cycle.jira_stopped_at) > 60)
					) {
						problems.push("stop");
					}
					if (cycle.stopped_at === null && cycle.jira_stopped_at === null) {
						// Elapsed and breach of an ongoing cycle depend on when it was read.
						ongoing++;
					} else {
						if (cycle.breached !== cycle.jira_breached) {
							problems.push("breached");
						}
						if (
							Math.abs(
								(cycle.elapsed_minutes ?? 0) -
									(cycle.jira_elapsed_minutes ?? 0),
							) > 1
						) {
							problems.push("elapsed");
						}
					}
				}
				if (problems.length === 0) {
					matched++;
					continue;
				}
				for (const problem of problems) {
					classes.set(problem, (classes.get(problem) ?? 0) + 1);
				}
				failures.push(
					`${metric} ${cycle.key} cycle ${cycle.computed_cycle ?? cycle.jira_cycle}: ${problems.join(", ")}`,
				);
			}
			const classText = [...classes.entries()]
				.map(([name, count]) => `${name}=${count}`)
				.join(" ");
			console.log(
				`SLA parity ${metric}: ${matched}/${cycles.length} match${ongoing > 0 ? ` (${ongoing} ongoing: start/stop only)` : ""}${classText ? ` (${classText})` : ""}`,
			);
		}

		expect(failures).toEqual([]);
		expect(rows.length).toBeGreaterThan(0);
	});

	test("the SLA custom fields agree with the request SLA import", async () => {
		const { rows } = await pool.query<{
			key: string;
			custom: Record<string, unknown>;
		}>(
			`select i.key, i.custom from issues i
			 join projects p on p.id = i.project_id
			 where p.key = 'OPS' order by i.number`,
		);
		const imported = await pool.query<{
			key: string;
			metric: string;
			cycle_number: number;
			started_at: Date;
			stopped_at: Date | null;
			elapsed_minutes: number;
			breached: boolean;
		}>(
			`select i.key, m.name as metric, c.cycle_number, c.started_at,
			        c.stopped_at, c.elapsed_minutes, c.breached
			 from sla_imported_cycles c
			 join issues i on i.id = c.issue_id
			 join sla_metrics m on m.id = c.metric_id
			 join projects p on p.id = i.project_id
			 where p.key = 'OPS'`,
		);
		const importedByKey = new Map<string, typeof imported.rows>();
		for (const row of imported.rows) {
			const list = importedByKey.get(row.key) ?? [];
			list.push(row);
			importedByKey.set(row.key, list);
		}

		const failures: string[] = [];
		let compared = 0;
		for (const issue of rows) {
			for (const value of Object.values(issue.custom)) {
				if (
					typeof value !== "object" ||
					value === null ||
					!("completedCycles" in value)
				) {
					continue;
				}
				const field = value as {
					name?: string;
					completedCycles?: {
						startTime?: { epochMillis?: number };
						stopTime?: { epochMillis?: number };
						elapsedTime?: { millis?: number };
						breached?: boolean;
					}[];
				};
				const cycles = importedByKey.get(issue.key) ?? [];
				const metricCycles = cycles.filter(
					(cycle) => cycle.metric === field.name,
				);
				for (const [index, cycle] of (field.completedCycles ?? []).entries()) {
					const importedCycle = metricCycles.find(
						(candidate) => candidate.cycle_number === index + 1,
					);
					compared++;
					if (!importedCycle) {
						failures.push(`${issue.key} ${field.name}: missing import`);
						continue;
					}
					const started = cycle.startTime?.epochMillis;
					const stopped = cycle.stopTime?.epochMillis;
					const elapsed = cycle.elapsedTime?.millis;
					if (
						started !== undefined &&
						started !== importedCycle.started_at.getTime()
					) {
						failures.push(`${issue.key} ${field.name}: start`);
					}
					if (
						(stopped ?? null) !== (importedCycle.stopped_at?.getTime() ?? null)
					) {
						failures.push(`${issue.key} ${field.name}: stop`);
					}
					if (
						elapsed !== undefined &&
						Math.abs(
							Math.round(elapsed / 60_000) - importedCycle.elapsed_minutes,
						) > 1
					) {
						failures.push(`${issue.key} ${field.name}: elapsed`);
					}
					if ((cycle.breached ?? false) !== importedCycle.breached) {
						failures.push(`${issue.key} ${field.name}: breached`);
					}
				}
			}
		}

		console.log(
			`SLA custom fields: ${compared - failures.length}/${compared} cycles agree with the request SLA import`,
		);
		expect(failures).toEqual([]);
		expect(compared).toBeGreaterThan(0);
	});
});
