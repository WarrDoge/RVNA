import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import { expect, test, withHydrationWait } from "./fixtures.ts";

const run = randomUUID().slice(0, 6).toUpperCase();
const spaceA = `FXA${run}`;
const spaceB = `FXB${run}`;
const spaceC = `FXC${run}`;
const readerName = `e2e-wiki-reader-${run}`;
const readerSession = randomBytes(24).toString("base64url");
const headers = { "X-Requested-With": "rvna" };

let client: Client;
let pageId: string;
let trashPageId: string;

const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");

async function createSpace(
	request: APIRequestContext,
	key: string,
	name: string,
) {
	const response = await request.post("/api/wiki/spaces", {
		headers,
		data: { key, name },
	});
	expect(response.status()).toBe(201);
	return (await response.json()) as { id: string; homePageId: string };
}

async function createPage(
	request: APIRequestContext,
	spaceKey: string,
	title: string,
) {
	const response = await request.post("/api/wiki/pages", {
		headers,
		data: {
			spaceKey,
			title,
			bodyDoc: { type: "doc", content: [{ type: "paragraph" }] },
		},
	});
	expect(response.status()).toBe(201);
	return (await response.json()) as { id: string };
}

test.beforeAll(async ({ request }) => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	await request.get("/auth/login");
	await createSpace(request, spaceA, `Fix A ${run}`);
	await createSpace(request, spaceB, `Fix B ${run}`);
	const c = await createSpace(request, spaceC, `Fix C ${run}`);
	pageId = (await createPage(request, spaceC, `Reader page ${run}`)).id;
	trashPageId = (await createPage(request, spaceC, `Trashed page ${run}`)).id;

	const reader = await client.query<{ id: string }>(
		"insert into users (username, display_name) values ($1, $2) returning id",
		[readerName, "Reader"],
	);
	const userId = reader.rows[0]?.id as string;
	await client.query(
		`insert into sessions (id_hash, user_id, expires_at)
		 values ($1, $2, now() + interval '1 day')`,
		[hash(readerSession), userId],
	);
	await client.query(
		`insert into space_permissions (source_id, space_id, permission, user_id)
		 values ($1, $2, 'read', $3)`,
		[`e2e-wiki:${randomUUID()}`, c.id, userId],
	);
	const trashed = await request.post(`/api/wiki/pages/${trashPageId}/trash`, {
		headers,
	});
	expect(trashed.status()).toBe(200);
});

test.afterAll(async () => {
	await client.query("delete from spaces where key = any($1::text[])", [
		[spaceA, spaceB, spaceC],
	]);
	await client.query("delete from users where username = $1", [readerName]);
	await client.end();
});

test("a new page can only be published in the space that holds its draft", async ({
	page,
}) => {
	await page.goto(`/pages/createpage.action?spaceKey=${spaceA}`);
	await expect(page.getByLabel("Page title")).toBeVisible();
	await page.getByRole("button", { name: "Change location" }).click();
	const space = page.getByLabel("Space");
	await expect(space.locator("option")).toHaveCount(1);
	await expect(space.locator("option")).toContainText(spaceA);
});

test("same-route navigation creates the new space's draft", async ({
	page,
}) => {
	await page.goto(`/pages/createpage.action?spaceKey=${spaceA}`);
	await expect(page.getByLabel("Page title")).toBeVisible();
	await page.evaluate((url) => {
		(window as { sameRoute?: boolean }).sameRoute = true;
		const link = document.createElement("a");
		link.id = "same-route-link";
		link.href = url;
		link.textContent = "same route";
		document.body.append(link);
	}, `/pages/createpage.action?spaceKey=${spaceB}`);
	await page.click("#same-route-link");
	await expect(page.getByLabel("Page title")).toBeVisible();
	await expect(page.getByText("Preparing the editor…")).toHaveCount(0);
	expect(
		await page.evaluate(() => (window as { sameRoute?: boolean }).sameRoute),
	).toBe(true);
});

test("a reader is not offered copy or restore actions", async ({ browser }) => {
	const context = await browser.newContext();
	await context.addCookies([
		{
			name: "sid",
			value: readerSession,
			url: test.info().project.use.baseURL as string,
		},
	]);
	const reader = withHydrationWait(await context.newPage());
	await reader.goto(`/pages/copypage.action?idOfPageToCopy=${pageId}`);
	await expect(reader.getByRole("button", { name: "Copy" })).toBeDisabled();
	await reader.goto(`/pages/viewtrash.action?key=${spaceC}`);
	await expect(reader.getByRole("button", { name: "Restore" })).toHaveCount(0);
	await context.close();
});

test("indenting a task list uses a task item", async ({ page }) => {
	await page.goto(`/pages/createpage.action?spaceKey=${spaceA}`);
	await expect(page.getByLabel("Page title")).toBeVisible();
	await page.getByLabel("Page title").fill(`Task list ${run}`);
	await page.getByRole("button", { name: "Task list" }).click();
	await page.keyboard.type("First task");
	await page.keyboard.press("Enter");
	await page.keyboard.type("Second task");
	await page.getByRole("button", { name: "Indent" }).click();
	const publish = page.getByRole("button", { name: "Publish" });
	await expect(publish).toBeEnabled();
	await publish.click();
	await expect(page).toHaveURL(/\/pages\/viewpage\.action\?pageId=/);
	const pageId = new URL(page.url()).searchParams.get("pageId") as string;
	const response = await page.request.get(`/api/wiki/edit/pages/${pageId}`, {
		headers,
	});
	const doc = (
		(await response.json()) as {
			page: { bodyDoc: { content?: { type: string; content?: unknown[] }[] } };
		}
	).page.bodyDoc;
	const list = doc.content?.find((node) => node.type === "taskList") as
		| { content?: { type: string; content?: { type: string }[] }[] }
		| undefined;
	expect(
		list?.content?.[0]?.content?.some((node) => node.type === "taskList"),
	).toBe(true);
});

test("the layout control stays below the editor toolbar", async ({ page }) => {
	await page.goto("/auth/login");
	const created = await page.request.post("/api/wiki/pages", {
		headers,
		data: {
			spaceKey: spaceA,
			title: `Layout page ${run}`,
			bodyDoc: {
				type: "doc",
				content: [
					{
						type: "layoutSection",
						attrs: { type: "two_equal" },
						content: [
							{
								type: "layoutCell",
								content: [
									{
										type: "paragraph",
										content: [{ type: "text", text: "Left cell" }],
									},
								],
							},
							{
								type: "layoutCell",
								content: [
									{
										type: "paragraph",
										content: [{ type: "text", text: "Right cell" }],
									},
								],
							},
						],
					},
				],
			},
		},
	});
	expect(created.status()).toBe(201);
	const createdPage = (await created.json()) as { id: string };
	await page.goto(`/pages/editpage.action?pageId=${createdPage.id}`);
	await expect(page.getByLabel("Page title")).toHaveValue(`Layout page ${run}`);
	await page.locator(".ProseMirror").getByText("Left cell").click();
	const toolbar = page.getByRole("toolbar", { name: "Formatting" });
	const layout = page.getByRole("toolbar", { name: "Layout" });
	await expect(toolbar).toBeVisible();
	await expect(layout).toBeVisible();
	const toolbarBox = await toolbar.boundingBox();
	const layoutBox = await layout.boundingBox();
	expect(toolbarBox).not.toBeNull();
	expect(layoutBox).not.toBeNull();
	if (!toolbarBox || !layoutBox) return;
	const intersects =
		toolbarBox.x < layoutBox.x + layoutBox.width &&
		toolbarBox.x + toolbarBox.width > layoutBox.x &&
		toolbarBox.y < layoutBox.y + layoutBox.height &&
		toolbarBox.y + toolbarBox.height > layoutBox.y;
	expect(intersects).toBe(false);
	expect(layoutBox.y).toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height);
});

test("changing the move target resets After to Last", async ({ page }) => {
	await page.goto("/auth/login");
	await createPage(page.request, spaceC, `Move parent ${run}`);
	await createPage(page.request, spaceC, `Move sibling ${run}`);
	const moved = await createPage(page.request, spaceC, `Move page ${run}`);
	await createPage(page.request, spaceC, `Move other ${run}`);

	await page.goto(`/pages/movepage.action?pageId=${moved.id}`);
	const dialog = page.getByRole("dialog", { name: /Move page/ });
	await expect(dialog).toBeVisible();
	await dialog.getByLabel("After", { exact: true }).check();
	await dialog.getByRole("combobox", { name: "After page" }).selectOption({
		label: `Move parent ${run}`,
	});
	await dialog.getByRole("button", { name: `Expand Fix C ${run}` }).click();
	await dialog
		.locator('fieldset[aria-label="Parent page"]')
		.getByRole("button", { name: `Move other ${run}` })
		.click();
	await expect(dialog.getByLabel("Last", { exact: true })).toBeChecked();
});
