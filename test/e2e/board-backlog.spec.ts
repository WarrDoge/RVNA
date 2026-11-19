import { randomUUID } from "node:crypto";
import { Client } from "pg";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	type SeedResult,
} from "../fixtures/project.ts";
import { expect, type Page, test } from "./fixtures.ts";
import { waitForHydration } from "./hydration.ts";

const run = randomUUID().slice(0, 8);
const keyA = fixtureKey(run);
const keyB = `BB${run.slice(0, 5).toUpperCase()}`;
const rapidViewA = 920000 + Number.parseInt(run.slice(0, 4), 16);
const rapidViewB = rapidViewA + 1;

let client: Client;
let projectA: SeedResult;
let projectB: SeedResult;

async function login(page: Page, path: string) {
	await page.goto(`/auth/login?returnTo=${encodeURIComponent(path)}`);
}

async function createBoard(input: {
	rapidViewId: number;
	name: string;
	projectId: string;
	projectKey: string;
}) {
	const result = await client.query<{ id: string }>(
		`insert into boards
			(rapid_view_id, source_id, name, type, filter_jql, project_id, config_imported)
		 values ($1, $2, $3, 'scrum', $4, $5, true)
		 returning id`,
		[
			input.rapidViewId,
			`e2e-backlog:${run}:${input.rapidViewId}`,
			input.name,
			`project = ${input.projectKey}`,
			input.projectId,
		],
	);
	return result.rows[0]?.id as string;
}

function backlogOrder(page: Page) {
	return page
		.locator('[data-testid^="backlog-row-"]')
		.evaluateAll((rows) =>
			rows.map((row) =>
				row.getAttribute("data-testid")?.slice("backlog-row-".length),
			),
		);
}

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	projectA = await createProjectFixture(client, {
		run,
		key: keyA,
		name: `Backlog e2e A ${run}`,
		issues: [
			{ summary: `Backlog filter issue one ${run}` },
			{ summary: `Backlog filter issue two ${run}` },
			{ summary: `Backlog filter issue three ${run}` },
		],
	});
	projectB = await createProjectFixture(client, {
		run: `${run}b`,
		key: keyB,
		name: `Backlog e2e B ${run}`,
		issues: [
			{ summary: `Backlog board B one ${run}` },
			{ summary: `Backlog board B two ${run}` },
		],
	});
	await client.query(
		`update issues set status_id = $1, resolution_id = $2 where id = $3`,
		[projectA.statusIds.done, projectA.resolutionId, projectA.issueIds[2]],
	);
	const boardA = await createBoard({
		rapidViewId: rapidViewA,
		name: `Backlog e2e board A ${run}`,
		projectId: projectA.projectId,
		projectKey: keyA,
	});
	await client.query(
		`insert into sprints
			(source_id, board_id, name, state, start_date, end_date, sequence)
		 values ($1, $2, $3, 'future', $4, $5, 1)`,
		[
			`e2e-backlog:${run}:sprint`,
			boardA,
			`Backlog e2e sprint ${run}`,
			"2026-05-12T10:00:00Z",
			"2026-05-26T10:00:00Z",
		],
	);
	await createBoard({
		rapidViewId: rapidViewB,
		name: `Backlog e2e board B ${run}`,
		projectId: projectB.projectId,
		projectKey: keyB,
	});
});

test.afterAll(async () => {
	if (!client) return;
	await client.query("delete from boards where source_id like $1", [
		`e2e-backlog:${run}:%`,
	]);
	await dropProjectFixture(client, run);
	await dropProjectFixture(client, `${run}b`);
	await client.end();
});

test("filters come from and update the URL", async ({ page }) => {
	const filtered = `/secure/RapidBoard.jspa?rapidView=${rapidViewA}&view=planning&text=${encodeURIComponent("issue one")}`;
	await login(page, filtered);
	await expect(page.getByRole("heading", { name: "Backlog" })).toBeVisible();

	const search = page.getByLabel("Search board");
	await expect(search).toHaveValue("issue one");
	await expect(page.getByTestId(`backlog-row-${keyA}-1`)).toBeVisible();
	await expect(page.getByTestId(`backlog-row-${keyA}-2`)).toHaveCount(0);
	await expect(
		page.getByText("1 issue", { exact: true }).first(),
	).toBeVisible();
	const sprint = page.locator('[data-testid^="backlog-sprint-section-"]');
	await expect(sprint).toContainText("2026");

	await search.fill("issue two");
	await expect
		.poll(() => new URL(page.url()).searchParams.get("text"))
		.toBe("issue two");
	await expect(page.getByTestId(`backlog-row-${keyA}-2`)).toBeVisible();
	await expect(page.getByTestId(`backlog-row-${keyA}-1`)).toHaveCount(0);
});

test("the keyboard reorders a backlog row", async ({ page }) => {
	await login(
		page,
		`/secure/RapidBoard.jspa?rapidView=${rapidViewA}&view=planning`,
	);
	await waitForHydration(page);
	const row = page.getByTestId(`backlog-row-${keyA}-2`);
	await row.focus();
	await page.keyboard.press("Space");
	await page.keyboard.press("ArrowUp");
	await page.keyboard.press("Space");
	await expect
		.poll(() => backlogOrder(page))
		.toEqual([`${keyA}-2`, `${keyA}-1`, `${keyA}-3`]);
});

test("switching boards drops the previous board's filtered backlog", async ({
	page,
}) => {
	await login(
		page,
		`/secure/RapidBoard.jspa?rapidView=${rapidViewA}&view=planning`,
	);
	await page.getByLabel("Search board").fill("issue one");
	await expect
		.poll(() => new URL(page.url()).searchParams.get("text"))
		.toBe("issue one");
	await expect(page.getByTestId(`backlog-row-${keyA}-1`)).toBeVisible();

	await page.evaluate((url) => {
		const link = document.createElement("a");
		link.href = url;
		document.body.append(link);
		link.click();
		link.remove();
	}, `/boards/${rapidViewB}/plan`);

	await expect(page.getByTestId(`backlog-row-${keyB}-1`)).toBeVisible();
	await expect(page.getByTestId(`backlog-row-${keyA}-1`)).toHaveCount(0);
});

test("a click on a done backlog card selects it and opens the detail panel", async ({
	page,
}) => {
	await login(
		page,
		`/secure/RapidBoard.jspa?rapidView=${rapidViewA}&view=planning`,
	);
	await waitForHydration(page);
	const row = page.getByTestId(`backlog-row-${keyA}-3`);
	await expect(row).toHaveClass(/done/);

	await row.click();
	await expect(row).toHaveClass(/selected/);
	await expect(page.locator("aside.issue-panel")).toBeVisible();
	await expect(
		page.getByText(`Backlog filter issue three ${run}`, { exact: true }).last(),
	).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`selectedIssue=${keyA}-3`));
});
