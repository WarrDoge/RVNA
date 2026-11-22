import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";

const migration = readFileSync(
	resolve("drizzle/0031_fat_silver_samurai.sql"),
	"utf8",
);
const dataStatements = migration
	.split("--> statement-breakpoint")
	.map((statement) => statement.replace(/^--.*$/gm, "").trim())
	.filter(
		(statement) =>
			/^(DELETE|INSERT|UPDATE|CREATE TEMP TABLE|DROP TABLE)\b/.test(
				statement,
			) && statement.includes("filter_shares"),
	);

const run = randomUUID().slice(0, 8);
let client: PoolClient;

beforeAll(async () => {
	await runMigrations();
	client = await pool.connect();
});

afterAll(async () => {
	client.release();
	await pool.end();
});

async function legacyShare(label: string) {
	const [user] = (
		await client.query<{ id: string }>(
			"insert into users (username, display_name) values ($1, $1) returning id",
			[`t-${run}-${label}-owner`],
		)
	).rows;
	const [project] = (
		await client.query<{ id: string }>(
			`insert into projects (source_id, key, name, project_type, last_issue_number)
			 values ($1, $2, $3, 'software', 0) returning id`,
			[
				`test:${run}:${label}:project`,
				`F${run.slice(0, 4).toUpperCase()}${label.slice(0, 1).toUpperCase()}`,
				`Filter target ${label}`,
			],
		)
	).rows;
	const [group] = (
		await client.query<{ id: string }>(
			"insert into groups (name, local) values ($1, false) returning id",
			[`t-${run}-${label}-group`],
		)
	).rows;
	const [filter] = (
		await client.query<{ id: string }>(
			`insert into filters (name, jql, owner_id) values ($1, 'project = DEMO', $2) returning id`,
			[`t-${run}-${label}-filter`, user.id],
		)
	).rows;
	await client.query(
		"insert into filter_shares (filter_id, project_id, group_id) values ($1, $2, $3)",
		[filter.id, project.id, group.id],
	);
	return { filterId: filter.id, projectId: project.id, groupId: group.id };
}

test("a legacy share with both targets keeps both grants", async () => {
	await client.query("begin");
	try {
		await client.query(
			"alter table filter_shares drop constraint filter_shares_one_target_check",
		);
		const share = await legacyShare("both");

		for (const statement of dataStatements) await client.query(statement);

		const { rows } = await client.query<{
			filter_id: string;
			project_id: string | null;
			group_id: string | null;
		}>(
			`select filter_id, project_id, group_id from filter_shares
			 where filter_id = $1`,
			[share.filterId],
		);
		expect(rows).toHaveLength(2);
		expect(rows).toEqual(
			expect.arrayContaining([
				{
					filter_id: share.filterId,
					project_id: share.projectId,
					group_id: null,
				},
				{
					filter_id: share.filterId,
					project_id: null,
					group_id: share.groupId,
				},
			]),
		);
	} finally {
		await client.query("rollback");
	}
});
