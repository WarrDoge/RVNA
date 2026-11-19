import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const actorOne = `e2e-audit-actor-a-${run}`;
const actorTwo = `e2e-audit-actor-b-${run}`;
const actionOne = `e2e-audit.one-${run}`;
const actionTwo = `e2e-audit.two-${run}`;

test.afterAll(async () => {
	const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
	try {
		await pool.query("delete from audit_log where summary like $1", [
			`%${run}%`,
		]);
	} finally {
		await pool.end();
	}
});

test("two quick audit filter changes keep both filters", async ({ page }) => {
	const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
	try {
		await pool.query(
			`insert into audit_log (actor_name, action, entity_type, summary)
			 values ($1, $2, 'e2e', $3), ($4, $5, 'e2e', $6)`,
			[
				actorOne,
				actionOne,
				`${run} first`,
				actorTwo,
				actionTwo,
				`${run} second`,
			],
		);
	} finally {
		await pool.end();
	}

	await page.goto("/auth/login?returnTo=/secure/admin/ViewAuditLog.jspa");
	await expect(page.getByLabel("Who")).toBeVisible();

	let delayed = false;
	await page.route("**/*ViewAuditLog*", async (route) => {
		if (!delayed && route.request().url().includes("__data.json")) {
			delayed = true;
			await new Promise((resolve) => setTimeout(resolve, 700));
		}
		await route.continue();
	});

	await page.getByLabel("Who").selectOption(actorOne);
	await page.getByLabel("Action").selectOption(actionOne);

	await page.waitForURL(
		(url) =>
			url.searchParams.get("actor") === actorOne &&
			url.searchParams.get("action") === actionOne,
	);
	await expect(page.getByLabel("Who")).toHaveValue(actorOne);
	await expect(page.getByLabel("Action")).toHaveValue(actionOne);
});
