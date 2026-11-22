import { afterAll, beforeAll, expect, test } from "vitest";
import { importDashboardDataset } from "../src/importer/dashboards-import.ts";
import { pool, runMigrations } from "../src/importer/db.ts";

const run = Math.random().toString(36).slice(2, 8);
const owner = `t-${run}-race-owner`;
const group = `t-${run}-race-group`;
const firstFilter = `race-filter-${run}-1`;
const secondFilter = `race-filter-${run}-2`;

function dataset(id: string) {
	return {
		owner,
		dashboards: [],
		filters: [
			{
				id,
				name: id,
				jql: "project = DEMO",
				owner: { name: owner },
				sharePermissions: [{ type: "group", group: { name: group } }],
			},
		],
		favouriteFilters: [],
		favouriteDashboards: [],
	};
}

beforeAll(async () => {
	await runMigrations();
	await pool.query(
		"insert into users (username, display_name) values ($1, $1)",
		[owner],
	);
	await pool.query("drop trigger if exists rvna_slow_group_insert on groups");
	await pool.query("drop function if exists rvna_slow_group_insert()");
	await pool.query(`
		create or replace function rvna_slow_group_insert() returns trigger as $$
		begin
			if new.name = '${group}' then
				perform pg_sleep(1);
			end if;
			return new;
		end;
		$$ language plpgsql
	`);
	await pool.query(
		"create trigger rvna_slow_group_insert before insert on groups for each row execute function rvna_slow_group_insert()",
	);
});

afterAll(async () => {
	await pool.query("drop trigger if exists rvna_slow_group_insert on groups");
	await pool.query("drop function if exists rvna_slow_group_insert()");
	await pool.query("delete from filters where source_id = any($1)", [
		[firstFilter, secondFilter],
	]);
	await pool.query("delete from groups where name = $1", [group]);
	await pool.query("delete from users where username = $1", [owner]);
	await pool.end();
});

test("two imports that create the same group keep both shares", async () => {
	await Promise.all([
		importDashboardDataset(dataset(firstFilter)),
		importDashboardDataset(dataset(secondFilter)),
	]);
	const rows = await pool.query<{ source_id: string; shares: number }>(
		`select f.source_id,
			(select count(*)::int from filter_shares s where s.filter_id = f.id and s.group_id is not null) as shares
		 from filters f where f.source_id = any($1) order by f.source_id`,
		[[firstFilter, secondFilter]],
	);
	expect(rows.rows).toEqual([
		{ source_id: firstFilter, shares: 1 },
		{ source_id: secondFilter, shares: 1 },
	]);
});
