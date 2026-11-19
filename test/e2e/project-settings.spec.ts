import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
} from "../fixtures/project.ts";
import { expect, test, withHydrationWait } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const keyA = fixtureKey(`a${run}`);
const keyB = fixtureKey(`b${run}`);
const keyC = fixtureKey(`c${run}`);
const nameA = `Settings A ${run}`;
const nameB = `Settings B ${run}`;
const descriptionA = `Description A ${run}`;
const descriptionB = `Description B ${run}`;
const leadAName = `Lead A ${run}`;
const leadBName = `Lead B ${run}`;
const projectAdmin = `t-${run}-project-admin`;
const projectMember = `t-${run}-project-member`;
const boardRapidViewId = 950000 + Number.parseInt(run.slice(0, 4), 16);

let client: Client;

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const leadA = await client.query<{ id: string }>(
		"insert into users (username, display_name) values ($1, $2) returning id",
		[`t-${run}-lead-a`, leadAName],
	);
	const leadB = await client.query<{ id: string }>(
		"insert into users (username, display_name) values ($1, $2) returning id",
		[`t-${run}-lead-b`, leadBName],
	);
	await client.query(
		"insert into users (username, display_name, is_admin) values ($1, $2, false)",
		[projectAdmin, `Project admin ${run}`],
	);
	await client.query(
		"insert into users (username, display_name, is_admin) values ($1, $2, false)",
		[projectMember, `Project member ${run}`],
	);

	await createProjectFixture(client, {
		run: `a${run}`,
		key: keyA,
		name: nameA,
		leadId: leadA.rows[0]?.id,
		issues: [],
	});
	await createProjectFixture(client, {
		run: `b${run}`,
		key: keyB,
		name: nameB,
		leadId: leadB.rows[0]?.id,
		issues: [],
	});
	await client.query("update projects set description = $1 where key = $2", [
		descriptionA,
		keyA,
	]);
	await client.query("update projects set description = $1 where key = $2", [
		descriptionB,
		keyB,
	]);
	const projectC = await createProjectFixture(client, {
		run: `c${run}`,
		key: keyC,
		name: `Settings C ${run}`,
		issues: [],
		members: [projectMember],
		admins: [projectAdmin],
	});
	await client.query(
		`insert into boards
			(rapid_view_id, source_id, name, type, filter_jql, project_id, config_imported)
		 values ($1, $2, $3, 'scrum', $4, $5, true)`,
		[
			boardRapidViewId,
			`t-${run}:board`,
			`Settings board ${run}`,
			`project = ${keyC}`,
			projectC.projectId,
		],
	);
});

test.afterAll(async () => {
	if (!client) return;
	await client.query("delete from boards where source_id = $1", [
		`t-${run}:board`,
	]);
	await dropProjectFixture(client, `a${run}`);
	await dropProjectFixture(client, `b${run}`);
	await dropProjectFixture(client, `c${run}`);
	await client.query("delete from users where username like $1", [
		`t-${run}-%`,
	]);
	await client.end();
});

test("client-side navigation between projects refreshes the settings form", async ({
	page,
}) => {
	await page.goto(
		`/auth/login?returnTo=${encodeURIComponent(`/plugins/servlet/project-config/${keyA}/summary`)}`,
	);
	await expect(
		page.getByRole("heading", { name: "Project settings" }),
	).toBeVisible();
	await expect(page.getByLabel("Project name")).toHaveValue(nameA);
	await expect(page.getByLabel("Project description")).toHaveValue(
		descriptionA,
	);
	await expect(page.getByRole("button", { name: leadAName })).toBeVisible();

	await page.evaluate((url) => {
		(window as Window & { __clientNavigation?: boolean }).__clientNavigation =
			true;
		const link = document.createElement("a");
		link.id = "settings-project-b";
		link.href = url;
		link.textContent = "Project B";
		document.body.append(link);
	}, `/plugins/servlet/project-config/${keyB}/summary`);
	await page.locator("#settings-project-b").click();

	await expect(page).toHaveURL(new RegExp(keyB));
	expect(
		await page.evaluate(
			() =>
				(window as Window & { __clientNavigation?: boolean })
					.__clientNavigation,
		),
	).toBe(true);
	await expect(page.getByText(nameB)).toBeVisible();
	await expect(page.getByLabel("Project name")).toHaveValue(nameB);
	await expect(page.getByLabel("Project description")).toHaveValue(
		descriptionB,
	);
	await expect(page.getByRole("button", { name: leadBName })).toBeVisible();
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem("rvna.lastProject")))
		.toBe(keyB);
});

test("a project administrator without site admin does not see the GitLab section", async ({
	browser,
	baseURL,
}) => {
	const user = await client.query<{ id: string }>(
		"select id from users where username = $1",
		[projectAdmin],
	);
	const userId = user.rows[0]?.id;
	if (!userId) throw new Error("The project admin was not created");
	const sid = randomUUID();
	await client.query(
		"insert into sessions (id_hash, user_id, expires_at) values ($1, $2, now() + interval '1 day')",
		[createHash("sha256").update(sid).digest("hex"), userId],
	);

	const context = await browser.newContext();
	await context.addCookies([
		{ name: "sid", value: sid, url: baseURL as string },
	]);
	const page = withHydrationWait(await context.newPage());
	await page.goto(`/plugins/servlet/project-config/${keyC}/summary`);
	await expect(
		page.getByRole("heading", { name: "Project settings" }),
	).toBeVisible();
	await expect(page.getByRole("heading", { name: "GitLab" })).toHaveCount(0);
	await expect(page.getByText("Forbidden")).toHaveCount(0);

	await page.goto(`/secure/RapidView.jspa?rapidView=${boardRapidViewId}`);
	await expect(page.getByLabel("Board name")).toBeEnabled();
	await expect(
		page.getByText(
			"Only administrators and the board owner can change this configuration.",
		),
	).toHaveCount(0);
	await page.getByLabel("Board name").fill(`Settings board ${run} saved`);
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	await context.close();
});

test("a project member sees the frame and the administer message", async ({
	browser,
	baseURL,
}) => {
	const user = await client.query<{ id: string }>(
		"select id from users where username = $1",
		[projectMember],
	);
	const userId = user.rows[0]?.id;
	if (!userId) throw new Error("The project member was not created");
	const sid = randomUUID();
	await client.query(
		"insert into sessions (id_hash, user_id, expires_at) values ($1, $2, now() + interval '1 day')",
		[createHash("sha256").update(sid).digest("hex"), userId],
	);

	const context = await browser.newContext();
	await context.addCookies([
		{ name: "sid", value: sid, url: baseURL as string },
	]);
	const page = withHydrationWait(await context.newPage());
	for (const section of ["summary", "roles"]) {
		await page.goto(`/plugins/servlet/project-config/${keyC}/${section}`);
		await expect(
			page.getByText("You do not have permission to administer this project."),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Go to the project issues" }),
		).toHaveAttribute("href", `/projects/${keyC}/issues`);
		await expect(page.locator(".project-frame")).toBeVisible();
		await expect(page.locator(".project-name").first()).toHaveText(
			`Settings C ${run}`,
		);
	}
	await context.close();
});

test("a site administrator gets 404 for a project that does not exist", async ({
	page,
}) => {
	const missingKey = fixtureKey(`z${run}`);
	const response = await page.goto(
		`/auth/login?returnTo=${encodeURIComponent(
			`/plugins/servlet/project-config/${missingKey}/summary`,
		)}`,
	);
	expect(response?.status()).toBe(404);
	await expect(
		page.getByRole("heading", { name: "Project not found" }),
	).toBeVisible();
});
