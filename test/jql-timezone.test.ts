import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { searchIssues } from "../src/lib/server/search/service.ts";
import { makeUser, newRun } from "./admin-helpers.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
} from "./fixtures/project.ts";
import { cleanupTestData } from "./helpers.ts";

const run = newRun();
const projectKey = fixtureKey(run);
const timeZone = "Europe/Helsinki";

let client: Client;
let user: { id: string; username: string };

async function keys(jql: string, now: Date, label: string) {
	const result = await searchIssues(
		{
			jql: `project = ${projectKey} AND labels = ${label} AND (${jql})`,
			startAt: 0,
			maxResults: 100,
		},
		user,
		{ now, timeZone },
	);
	return result.issues.map((issue) => issue.key).sort();
}

beforeAll(async () => {
	await runMigrations();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	const created = await makeUser(run, "tz", { admin: true });
	user = { id: created.id, username: created.username };
	await createProjectFixture(client, {
		run,
		key: projectKey,
		members: [user.username],
		issues: [
			{
				summary: "Winter before midnight",
				labels: ["winter"],
				created: "2026-01-14T21:30:00Z",
			},
			{
				summary: "Winter after midnight",
				labels: ["winter"],
				created: "2026-01-14T22:30:00Z",
			},
			{
				summary: "Winter noon",
				labels: ["winter"],
				created: "2026-01-15T10:00:00Z",
			},
			{
				summary: "Summer before midnight",
				labels: ["summer"],
				created: "2026-07-14T20:30:00Z",
			},
			{
				summary: "Summer after midnight",
				labels: ["summer"],
				created: "2026-07-14T21:30:00Z",
			},
			{
				summary: "Summer noon",
				labels: ["summer"],
				created: "2026-07-15T09:00:00Z",
			},
			{
				summary: "Week before",
				labels: ["week"],
				created: "2026-01-11T21:30:00Z",
			},
			{
				summary: "Week after",
				labels: ["week"],
				created: "2026-01-11T23:30:00Z",
			},
			{
				summary: "Month before",
				labels: ["month"],
				created: "2026-01-31T21:30:00Z",
			},
			{
				summary: "Month after",
				labels: ["month"],
				created: "2026-01-31T23:30:00Z",
			},
			{
				summary: "Year before",
				labels: ["year"],
				created: "2025-12-31T21:30:00Z",
			},
			{
				summary: "Year after",
				labels: ["year"],
				created: "2025-12-31T23:30:00Z",
			},
			{ summary: "Fall back day", labels: ["dst"] },
			{ summary: "Spring forward night", labels: ["dst"] },
		],
	});
	for (const [number, changed] of [
		[13, "2026-10-25T21:30:00Z"],
		[14, "2026-03-29T21:30:00Z"],
	] as const) {
		const history = await client.query<{ id: string }>(
			`insert into issue_history (source_id, issue_id, created)
			 select $1, id, $3 from issues where key = $2 returning id`,
			[`test:${run}:dst-${number}`, `${projectKey}-${number}`, changed],
		);
		await client.query(
			`insert into issue_history_items
			 (source_id, history_id, field, field_type, from_string, to_string, sequence)
			 values ($1, $2, 'status', 'jira', 'Open', 'Done', 0)`,
			[`test:${run}:dst-item-${number}`, history.rows[0]?.id],
		);
	}
});

afterAll(async () => {
	await dropProjectFixture(client, run);
	await client.end();
	await cleanupTestData(run);
	await pool.end();
});

describe("JQL dates use the application time zone", () => {
	test("winter day boundary (UTC+2)", async () => {
		const now = new Date("2026-01-15T12:00:00Z");
		expect(await keys(`created >= "2026-01-15"`, now, "winter")).toEqual([
			`${projectKey}-2`,
			`${projectKey}-3`,
		]);
		expect(await keys("created >= startOfDay()", now, "winter")).toEqual([
			`${projectKey}-2`,
			`${projectKey}-3`,
		]);
		expect(await keys("created < startOfDay()", now, "winter")).toEqual([
			`${projectKey}-1`,
		]);
		expect(await keys("created <= endOfDay(-1)", now, "winter")).toEqual([
			`${projectKey}-1`,
		]);
	});

	test("summer day boundary (UTC+3)", async () => {
		const now = new Date("2026-07-15T12:00:00Z");
		expect(await keys(`created >= "2026-07-15"`, now, "summer")).toEqual([
			`${projectKey}-5`,
			`${projectKey}-6`,
		]);
		expect(await keys("created <= endOfDay(-1)", now, "summer")).toEqual([
			`${projectKey}-4`,
		]);
	});

	test("week, month and year boundaries and their end forms", async () => {
		const now = new Date("2026-02-15T12:00:00Z");
		expect(
			await keys(
				"created >= startOfWeek()",
				new Date("2026-01-15T12:00:00Z"),
				"week",
			),
		).toEqual([`${projectKey}-8`]);
		expect(
			await keys(
				"created <= endOfWeek(-1)",
				new Date("2026-01-15T12:00:00Z"),
				"week",
			),
		).toEqual([`${projectKey}-7`]);
		expect(await keys("created >= startOfMonth()", now, "month")).toEqual([
			`${projectKey}-10`,
		]);
		expect(await keys("created <= endOfMonth(-1)", now, "month")).toEqual([
			`${projectKey}-9`,
		]);
		expect(await keys("created >= startOfYear()", now, "year")).toEqual([
			`${projectKey}-12`,
		]);
		expect(await keys("created <= endOfYear(-1)", now, "year")).toEqual([
			`${projectKey}-11`,
		]);
	});

	test("a changed-on day follows the local calendar on a 25 and a 23 hour day", async () => {
		const now = new Date("2026-11-15T12:00:00Z");
		// 23:30 local on the day the clocks go back: the last hour of a 25 hour day.
		expect(await keys(`status CHANGED ON "2026-10-25"`, now, "dst")).toEqual([
			`${projectKey}-13`,
		]);
		// 00:30 local on the day after the clocks go forward: not part of that 23 hour day.
		expect(await keys(`status CHANGED ON "2026-03-29"`, now, "dst")).toEqual(
			[],
		);
		expect(await keys(`status CHANGED ON "2026-03-30"`, now, "dst")).toEqual([
			`${projectKey}-14`,
		]);
	});
});
