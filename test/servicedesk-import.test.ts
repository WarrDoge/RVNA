import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pool, runMigrations } from "../src/importer/db.ts";
import { importDataset } from "../src/importer/import.ts";
import { fetchOpenAccess } from "../src/importer/servicedesk.ts";
import {
	mapConditions,
	mapRequestChannel,
	mapWorkingHours,
} from "../src/importer/servicedesk-import.ts";
import {
	serviceDeskBaseUrl,
	serviceDeskCalendarIds,
	serviceDeskFixtureDataset,
	serviceDeskProjectKey,
} from "./fixtures/servicedesk.ts";

async function cleanup() {
	await pool.query("delete from projects where key = $1", [
		serviceDeskProjectKey,
	]);
	await pool.query("delete from sla_calendars where source_id = any($1)", [
		serviceDeskCalendarIds,
	]);
	await pool.query("delete from automation_rules where source_id = $1", [
		"GLOBAL:9101",
	]);
	await pool.query("delete from fields where source_id = 'customfield_90003'");
	await pool.query(
		"delete from issue_types where source_id like 'fixture-sd-%'",
	);
	await pool.query("delete from statuses where source_id like 'fixture-sd-%'");
	await pool.query(
		"delete from priorities where source_id like 'fixture-sd-%'",
	);
	await pool.query(
		"delete from resolutions where source_id like 'fixture-sd-%'",
	);
	await pool.query("delete from users where username like 'sd_fixture_%'");
}

async function rowCounts() {
	const { rows } = await pool.query<{ name: string; count: number }>(
		`
		select 'service_desks' as name, count(*)::int as count from service_desks where source_id = '9100'
		union all select 'request_type_groups', count(*)::int from request_type_groups where desk_id in (select id from service_desks where source_id = '9100')
		union all select 'request_types', count(*)::int from request_types where desk_id in (select id from service_desks where source_id = '9100')
		union all select 'request_type_group_members', count(*)::int from request_type_group_members where request_type_id in (select id from request_types where desk_id in (select id from service_desks where source_id = '9100'))
		union all select 'request_type_fields', count(*)::int from request_type_fields where request_type_id in (select id from request_types where desk_id in (select id from service_desks where source_id = '9100'))
		union all select 'queues', count(*)::int from queues where desk_id in (select id from service_desks where source_id = '9100')
		union all select 'sla_calendars', count(*)::int from sla_calendars where source_id = any($1)
		union all select 'sla_metrics', count(*)::int from sla_metrics where desk_id in (select id from service_desks where source_id = '9100')
		union all select 'sla_goals', count(*)::int from sla_goals where metric_id in (select id from sla_metrics where desk_id in (select id from service_desks where source_id = '9100'))
		union all select 'sla_imported_cycles', count(*)::int from sla_imported_cycles where issue_id in (select id from issues where project_id in (select id from projects where key = 'SDFIX'))
		union all select 'automation_rules', count(*)::int from automation_rules where source_id = 'GLOBAL:9101'
		union all select 'issues', count(*)::int from issues where project_id in (select id from projects where key = 'SDFIX')
	`,
		[serviceDeskCalendarIds],
	);
	return Object.fromEntries(rows.map((row) => [row.name, row.count]));
}

beforeAll(async () => {
	await runMigrations();
	await cleanup();
});

afterAll(async () => {
	await cleanup();
	await pool.end();
});

describe("service desk mapping", () => {
	test("maps every SLA condition Jira uses", () => {
		expect(
			mapConditions([
				{
					factoryKey: "issue-created-sla-condition-factory",
					conditionId: "issue-created-hit-condition",
				},
				{
					factoryKey: "status-sla-condition-factory",
					conditionId: "10307",
					name: "Entered Status: Awaiting CAB approval",
				},
				{
					factoryKey: "comment-sla-condition-factory",
					conditionId: "comment-for-reporter-hit-condition",
				},
				{
					factoryKey: "comment-sla-condition-factory",
					conditionId: "comment-by-reporter-hit-condition",
				},
				{
					factoryKey: "assignee-sla-condition-factory",
					conditionId: "assignee-set-hit-condition",
				},
				{
					factoryKey: "assignee-sla-condition-factory",
					conditionId: "assignee-cleared-hit-condition",
				},
				{
					factoryKey: "resolution-sla-condition-factory",
					conditionId: "resolution-set-hit-condition",
				},
				{
					factoryKey: "resolution-sla-condition-factory",
					conditionId: "resolution-cleared-hit-condition",
				},
			]),
		).toEqual([
			{ type: "issue_created" },
			{ type: "entered_status", statusId: "10307" },
			{ type: "comment_for_customer" },
			{ type: "comment_by_customer" },
			{ type: "assignee_set" },
			{ type: "assignee_cleared" },
			{ type: "resolution_set" },
			{ type: "resolution_cleared" },
		]);
		expect(() =>
			mapConditions([{ factoryKey: "unknown-factory", conditionId: "x" }]),
		).toThrow("Unsupported SLA condition");
	});

	test("splits a working interval that crosses midnight", () => {
		const hours = mapWorkingHours({
			id: 1,
			name: "Overnight",
			timezoneId: "UTC",
			workingTimes: [
				{ weekday: "monday", start: 22 * 3_600_000, end: 30 * 3_600_000 },
			],
		});
		expect(hours[0]).toEqual([{ start: 22 * 60, end: 24 * 60 }]);
		expect(hours[1]).toEqual([{ start: 0, end: 6 * 60 }]);
		expect(hours.slice(2)).toEqual([[], [], [], [], []]);
	});

	test("keeps only known request channels", () => {
		expect(mapRequestChannel("portal")).toBe("portal");
		expect(mapRequestChannel("email")).toBe("email");
		expect(mapRequestChannel("chat")).toBe("chat");
		expect(mapRequestChannel(null)).toBeNull();
	});
});

describe("service desk import", () => {
	test("maps the desk configuration and SLA history", async () => {
		const result = await importDataset(serviceDeskFixtureDataset(), {
			baseUrl: serviceDeskBaseUrl,
			fullImport: true,
		});

		expect(result.counts.service_desks?.inserted).toBe(1);
		expect(result.counts.request_type_groups?.inserted).toBe(1);
		expect(result.counts.request_types?.inserted).toBe(3);
		expect(result.counts.request_type_group_members?.inserted).toBe(2);
		expect(result.counts.request_type_fields?.inserted).toBe(4);
		expect(result.counts.queues?.inserted).toBe(2);
		expect(result.counts.sla_calendars?.inserted).toBe(2);
		expect(result.counts.sla_metrics?.inserted).toBe(1);
		expect(result.counts.sla_goals?.inserted).toBe(2);
		expect(result.counts.sla_imported_cycles?.inserted).toBe(2);
		expect(result.counts.automation_rules?.inserted).toBe(1);
		expect(result.counts.issues?.inserted).toBe(2);

		const desk = await pool.query(
			`select sd.portal_name, sd.description, p.key
			 from service_desks sd join projects p on p.id = sd.project_id
			 where sd.source_id = '9100'`,
		);
		expect(desk.rows[0]).toEqual({
			portal_name: "Fixture Portal",
			description: "Welcome to the fixture desk",
			key: serviceDeskProjectKey,
		});
		const access = await pool.query(
			"select open_access from service_desks where source_id = '9100'",
		);
		expect(access.rows[0].open_access).toBe(false);

		const requestTypes = await pool.query(
			`select rt.source_id, rt.icon_name, it.name as issue_type
			 from request_types rt
			 left join issue_types it on it.id = rt.issue_type_id
			 where rt.desk_id = (select id from service_desks where source_id = '9100')
			 order by rt.sequence`,
		);
		expect(requestTypes.rows).toEqual([
			{
				source_id: "fixture-rt-1",
				icon_name: "fixture-icon-1",
				issue_type: "Fixture Request",
			},
			{
				source_id: "fixture-rt-2",
				icon_name: null,
				issue_type: "Fixture Request",
			},
			{ source_id: "fixture-rt-3", icon_name: null, issue_type: null },
		]);

		const fields = await pool.query(
			`select f.label, f.description, f.required
			 from request_type_fields f
			 join request_types rt on rt.id = f.request_type_id
			 where rt.source_id = 'fixture-rt-1'
			 order by f.sequence`,
		);
		expect(fields.rows).toEqual([
			{ label: "Summary", description: null, required: true },
			{ label: "Details", description: "Tell us more", required: false },
		]);

		const queues = await pool.query(
			`select q.name, q.columns, q.issue_count, parent.name as parent
			 from queues q
			 left join queues parent on parent.id = q.parent_id
			 where q.desk_id = (select id from service_desks where source_id = '9100')
			 order by q.sequence`,
		);
		expect(queues.rows).toEqual([
			{
				name: "All open",
				columns: ["issuekey", "summary"],
				issue_count: 1,
				parent: null,
			},
			{
				name: "↳ Mine",
				columns: [],
				issue_count: 0,
				parent: "All open",
			},
		]);

		const issues = await pool.query(
			`select i.key, i.request_channel, rt.source_id as request_type
			 from issues i
			 join projects p on p.id = i.project_id
			 left join request_types rt on rt.id = i.request_type_id
			 where p.key = 'SDFIX' order by i.key`,
		);
		expect(issues.rows).toEqual([
			{
				key: "SDFIX-1",
				request_channel: "portal",
				request_type: "fixture-rt-1",
			},
			{
				key: "SDFIX-2",
				request_channel: "email",
				request_type: "fixture-rt-2",
			},
		]);

		const metrics = await pool.query(
			`select m.name, m.start_conditions, m.pause_conditions, m.stop_conditions
			 from sla_metrics m
			 where m.desk_id = (select id from service_desks where source_id = '9100')`,
		);
		expect(metrics.rows[0]).toEqual({
			name: "Fixture SLA",
			start_conditions: [{ type: "issue_created" }],
			pause_conditions: [],
			stop_conditions: [{ type: "resolution_set" }],
		});

		const goals = await pool.query(
			`select g.sequence, g.jql, g.goal_minutes, c.name as calendar
			 from sla_goals g
			 join sla_metrics m on m.id = g.metric_id
			 join sla_calendars c on c.id = g.calendar_id
			 where m.desk_id = (select id from service_desks where source_id = '9100')
			 order by g.sequence`,
		);
		expect(goals.rows).toEqual([
			{
				sequence: 0,
				jql: 'issuetype = "Fixture Request"',
				goal_minutes: 480,
				calendar: "Fixture 9-5",
			},
			{
				sequence: 1,
				jql: "",
				goal_minutes: 240,
				calendar: "Fixture 24/7",
			},
		]);

		const cycles = await pool.query(
			`select i.key, c.cycle_number, c.goal_minutes, c.elapsed_minutes,
			        c.remaining_minutes, c.breached
			 from sla_imported_cycles c
			 join issues i on i.id = c.issue_id
			 join projects p on p.id = i.project_id
			 where p.key = 'SDFIX'
			 order by i.key, c.cycle_number`,
		);
		expect(cycles.rows).toEqual([
			{
				key: "SDFIX-1",
				cycle_number: 1,
				goal_minutes: 480,
				elapsed_minutes: 240,
				remaining_minutes: 240,
				breached: false,
			},
			{
				key: "SDFIX-2",
				cycle_number: 1,
				goal_minutes: 480,
				elapsed_minutes: 600,
				remaining_minutes: -120,
				breached: true,
			},
		]);

		const rule = await pool.query(
			`select name, enabled, trigger, conditions, actions, raw,
			        desk_id is not null as desk_scoped
			 from automation_rules where source_id = 'GLOBAL:9101'`,
		);
		expect(rule.rows[0].name).toBe("Fixture Rule");
		expect(rule.rows[0].enabled).toBe(true);
		expect(rule.rows[0].trigger).toEqual({
			type: "jira.issue.event.trigger:created",
			eventKey: "jira:issue_created",
		});
		expect(rule.rows[0].conditions).toEqual([]);
		expect(rule.rows[0].actions).toEqual([
			{ type: "jira.issue.edit", value: { operations: [] } },
		]);
		expect(rule.rows[0].raw.id).toBe(9101);
		expect(rule.rows[0].desk_scoped).toBe(true);
	});

	test("a second import changes nothing", async () => {
		const beforeCounts = await rowCounts();

		const second = await importDataset(serviceDeskFixtureDataset(), {
			baseUrl: serviceDeskBaseUrl,
			fullImport: true,
		});

		for (const [table, counts] of Object.entries(second.counts)) {
			expect(counts.inserted, `${table} inserted`).toBe(0);
			expect(counts.updated, `${table} updated`).toBe(0);
		}

		expect(await rowCounts()).toEqual(beforeCounts);
	});

	test("a later import leaves an administrator's open access choice alone", async () => {
		await pool.query(
			"update service_desks set open_access = true where source_id = '9100'",
		);
		await importDataset(serviceDeskFixtureDataset(), {
			baseUrl: serviceDeskBaseUrl,
			fullImport: true,
		});
		const access = await pool.query(
			"select open_access from service_desks where source_id = '9100'",
		);
		expect(access.rows[0].open_access).toBe(true);
	});
});

describe("service desk open access from Jira", () => {
	const client = (answer: () => unknown) =>
		({ getJson: async () => answer() }) as never;

	test("reads the flag Jira reports", async () => {
		expect(
			await fetchOpenAccess(
				client(() => ({ serviceDeskOpenAccess: false })),
				"OPS",
				{ privateApis: true },
			),
		).toBe(false);
		expect(
			await fetchOpenAccess(
				client(() => ({ serviceDeskOpenAccess: true })),
				"OPS",
				{ privateApis: true },
			),
		).toBe(true);
	});

	test("an unavailable endpoint or a missing field leaves it unknown", async () => {
		expect(
			await fetchOpenAccess(
				client(() => {
					throw Object.assign(new Error("not found"), { status: 404 });
				}),
				"OPS",
				{ privateApis: true },
			),
		).toBeNull();
		expect(
			await fetchOpenAccess(
				client(() => ({})),
				"OPS",
				{ privateApis: true },
			),
		).toBeNull();
	});
});
