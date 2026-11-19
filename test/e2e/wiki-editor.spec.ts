import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, type Page, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 6).toUpperCase();
const spaceKey = `E2E${run}`;
const focusSpaceKey = `FOC${run}`;
const markSpaceKey = `MRK${run}`;
const headers = { "X-Requested-With": "rvna" };

type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[] };
type Context = {
	page: { id: string; title: string; version: number; bodyDoc: Node };
};

let client: Client;

function collect(node: Node, found: Node[] = []): Node[] {
	found.push(node);
	for (const child of node.content ?? []) collect(child, found);
	return found;
}

async function chooseInsert(page: Page, item: string) {
	await page.getByRole("button", { name: "Insert content" }).click();
	await page.getByRole("menuitem", { name: item, exact: true }).click();
}

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
});

test.afterAll(async () => {
	await client.query("delete from spaces where key = any($1)", [
		[spaceKey, focusSpaceKey, markSpaceKey],
	]);
	await client.end();
});

test("create a wiki page, publish it, edit it and publish again", async ({
	page,
}) => {
	await page.goto("/auth/login");
	const created = await page.request.post("/api/wiki/spaces", {
		headers,
		data: { key: spaceKey, name: `E2E space ${run}` },
	});
	expect(created.status()).toBe(201);

	await page.goto(`/pages/createpage.action?spaceKey=${spaceKey}`);
	await expect(page.getByLabel("Page title")).toBeVisible();
	await page.getByLabel("Page title").fill(`E2E page ${run}`);
	const publish = page.getByRole("button", { name: "Publish" });
	await expect(publish).toBeEnabled();

	const editor = page.locator(".ProseMirror").first();
	await editor.click();
	await page.getByRole("button", { name: "Text style" }).click();
	await page.getByRole("menuitem", { name: "Heading 2" }).click();
	await page.keyboard.type("E2E heading");
	await page.keyboard.press("Enter");

	await chooseInsert(page, "Table");
	await expect(editor.locator("table")).toBeVisible();

	await editor.locator("table").locator("td").last().click();
	await page.keyboard.press("ArrowDown");
	await chooseInsert(page, "Info");
	await page
		.getByRole("dialog", { name: "Insert Info" })
		.getByRole("button", { name: "Insert" })
		.click();
	await page.keyboard.type("Info body");

	await chooseInsert(page, "Code Block");
	const code = page.getByRole("dialog", { name: "Insert Code Block" });
	await code.getByLabel("Code").fill("const answer = 42;");
	await code.getByRole("button", { name: "Insert" }).click();

	await expect(page.getByText(/Draft saved at \d\d:\d\d/)).toBeVisible({
		timeout: 15_000,
	});

	await page.getByLabel("Version comment").fill("first version");
	await publish.click();
	await expect(page).toHaveURL(/\/pages\/viewpage\.action\?pageId=/);
	const pageId = new URL(page.url()).searchParams.get("pageId") as string;

	const first = await page.request.get(`/api/wiki/edit/pages/${pageId}`, {
		headers,
	});
	const firstContext = (await first.json()) as Context;
	expect(firstContext.page.version).toBe(1);
	const types = collect(firstContext.page.bodyDoc).map((node) => node.type);
	expect(types).toContain("heading");
	expect(types).toContain("table");
	const macros = collect(firstContext.page.bodyDoc)
		.filter((node) => node.type === "macro")
		.map((node) => node.attrs?.name);
	expect(macros).toEqual(expect.arrayContaining(["info", "code"]));
	expect(JSON.stringify(firstContext.page.bodyDoc)).toContain("Info body");

	await page.goto(`/pages/editpage.action?pageId=${pageId}`);
	await expect(page.getByLabel("Page title")).toHaveValue(`E2E page ${run}`);
	await expect(editor).toBeVisible();
	await page.getByLabel("Page title").fill(`E2E page ${run} edited`);
	await page.getByLabel("Version comment").fill("second version");
	await page.getByRole("button", { name: "Publish" }).click();
	await expect(page).toHaveURL(/\/pages\/viewpage\.action\?pageId=/);

	const second = await page.request.get(`/api/wiki/edit/pages/${pageId}`, {
		headers,
	});
	const secondContext = (await second.json()) as Context;
	expect(secondContext.page.version).toBe(2);
	expect(secondContext.page.title).toBe(`E2E page ${run} edited`);

	await page.goto(`/pages/viewpreviousversions.action?pageId=${pageId}`);
	const rows = page.locator("table.wiki-version-table tbody tr");
	await expect(rows).toHaveCount(2);
	await expect(rows.first()).toContainText("second version");
	await rows.nth(1).getByRole("button", { name: "Restore" }).click();
	await expect(rows).toHaveCount(3);
	await expect(rows.first()).toContainText("Restored version 1");

	const versions = await client.query<{ number: number }>(
		"select number from page_versions where page_id = $1 order by number",
		[pageId],
	);
	expect(versions.rows.map((row) => row.number)).toEqual([1, 2, 3]);
});

test("an old edit bookmark opens the editor without an aborted navigation", async ({
	page,
}) => {
	await page.goto("/auth/login");
	const space = await page.request.post("/api/wiki/spaces", {
		headers,
		data: { key: focusSpaceKey, name: `Focus space ${run}` },
	});
	expect(space.status()).toBe(201);
	const title = `Focus page ${run}`;
	const created = await page.request.post("/api/wiki/pages", {
		headers,
		data: {
			spaceKey: focusSpaceKey,
			title,
			bodyDoc: { type: "doc", content: [{ type: "paragraph" }] },
		},
	});
	expect(created.status()).toBe(201);
	const pageId = ((await created.json()) as { id: string }).id;

	await page.goto(`/pages/editpage.action?pageId=${pageId}`);
	await expect(page.getByLabel("Page title")).toHaveValue(title);
	await expect(
		page.locator('.ProseMirror[contenteditable="true"]'),
	).toBeVisible();

	// Reloading the bookmark must not be blocked by an unsaved-changes prompt.
	await page.goto(`/pages/editpage.action?pageId=${pageId}`);
	await expect(page.getByLabel("Page title")).toHaveValue(title);
});

test("a mark or an attribute change without new text still counts as an edit", async ({
	page,
}) => {
	await page.goto("/auth/login");
	const space = await page.request.post("/api/wiki/spaces", {
		headers,
		data: { key: markSpaceKey, name: `Mark space ${run}` },
	});
	expect(space.status()).toBe(201);
	const paragraph = (text: string) => ({
		type: "paragraph",
		content: [{ type: "text", text }],
	});
	const created = await page.request.post("/api/wiki/pages", {
		headers,
		data: {
			spaceKey: markSpaceKey,
			title: `Mark page ${run}`,
			bodyDoc: {
				type: "doc",
				content: [
					paragraph("plain text"),
					{
						type: "taskList",
						content: [
							{
								type: "taskItem",
								attrs: { checked: false },
								content: [paragraph("a task")],
							},
						],
					},
					{
						type: "table",
						content: [
							{
								type: "tableRow",
								content: [
									{ type: "tableCell", content: [paragraph("a cell")] },
								],
							},
						],
					},
				],
			},
		},
	});
	expect(created.status()).toBe(201);
	const pageId = ((await created.json()) as { id: string }).id;
	const editor = page.locator('.ProseMirror[contenteditable="true"]');

	// The unsaved-changes prompt asks the page whether it holds an edit.
	const holdsEdit = () =>
		page.evaluate(() => {
			const event = new Event("beforeunload", { cancelable: true });
			window.dispatchEvent(event);
			return event.defaultPrevented;
		});
	async function openEditor() {
		await page.goto(`/pages/editpage.action?pageId=${pageId}`);
		await expect(editor).toBeVisible();
		await page.waitForTimeout(500);
		expect(await holdsEdit()).toBe(false);
	}

	await openEditor();
	await editor.locator('li[data-checked] input[type="checkbox"]').click();
	expect(await holdsEdit()).toBe(true);

	await openEditor();
	await editor.locator("p").first().click();
	await page.keyboard.press("Control+A");
	await page.getByRole("button", { name: "Bold (Ctrl+B)" }).click();
	expect(await holdsEdit()).toBe(true);

	await openEditor();
	await editor.locator("td p").first().click();
	await page.getByRole("button", { name: "Cell background" }).click();
	await page.locator(".wke-swatch").first().click();
	expect(await holdsEdit()).toBe(true);
});
