import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 6).toUpperCase();
const spaceKey = `EDC${run}`;
const headers = { "X-Requested-With": "rvna" };

type Node = {
	type: string;
	attrs?: Record<string, unknown>;
	content?: Node[];
	marks?: { type: string; attrs?: Record<string, unknown> }[];
};

function collect(node: Node, found: Node[] = []): Node[] {
	found.push(node);
	for (const child of node.content ?? []) collect(child, found);
	return found;
}

const pixel =
	"iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNkYPhfz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC";

let client: Client;

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
});

test.afterAll(async () => {
	await client.query("delete from spaces where key = $1", [spaceKey]);
	await client.end();
});

test("editor core: slash menu, macro browser, link dialog, mention, table toolbar, pasted image and Ctrl+S", async ({
	page,
}) => {
	await page.goto("/auth/login");
	const space = await page.request.post("/api/wiki/spaces", {
		headers,
		data: { key: spaceKey, name: `Editor core ${run}` },
	});
	expect(space.status()).toBe(201);
	const target = await page.request.post("/api/wiki/pages", {
		headers,
		data: {
			spaceKey,
			title: `Link target ${run}`,
			bodyDoc: { type: "doc", content: [{ type: "paragraph" }] },
		},
	});
	expect(target.status()).toBe(201);
	const targetPage = (await target.json()) as { id: string };

	await page.goto(`/pages/createpage.action?spaceKey=${spaceKey}`);
	await page.getByLabel("Page title").fill(`Core page ${run}`);
	const editor = page.locator(".ProseMirror").first();
	await editor.click();

	await page.getByRole("button", { name: "Text style" }).click();
	await page.getByRole("menuitem", { name: "Heading 1" }).click();
	await expect(editor).toBeFocused();
	await page.keyboard.type("Core heading");
	await page.keyboard.press("Enter");

	await page.keyboard.type("/info");
	await page.keyboard.press("Enter");
	const info = page.getByRole("dialog", { name: "Insert Info" });
	await info.getByLabel("Title", { exact: true }).fill("Heads up");
	await info.getByRole("button", { name: "Insert" }).click();
	await expect(info).toBeHidden();
	await expect(editor).toBeFocused();
	await page.keyboard.type("Info body");
	await page.keyboard.press("ControlOrMeta+End");

	await page.keyboard.type("{");
	const browser = page.getByRole("dialog", { name: "Select macro" });
	await browser.getByLabel("Search macros").fill("table of");
	await page.keyboard.press("Enter");
	const toc = page.getByRole("dialog", { name: "Insert Table of Contents" });
	await toc.getByRole("button", { name: "Insert" }).click();
	await expect(toc).toBeHidden();
	await expect(editor).toBeFocused();
	await expect(editor.getByText("Core heading").first()).toBeVisible();
	await expect(editor.locator('[data-macro="toc"]')).toContainText(
		"Core heading",
	);
	await page.keyboard.press("ControlOrMeta+End");

	await page.keyboard.type("See ");
	await page.keyboard.type("[");
	const link = page.getByRole("dialog", { name: "Insert link" });
	await link.getByLabel("Search for a page").fill(`Link target ${run}`);
	await link
		.getByRole("option", { name: new RegExp(`Link target ${run}`) })
		.click();
	await link.getByRole("button", { name: "Insert" }).click();
	await expect(link).toBeHidden();
	await expect(editor).toBeFocused();
	await page.keyboard.type(" cc @de");
	await page.getByRole("listbox").getByRole("option").first().click();

	await page.keyboard.press("Enter");
	await page.getByRole("button", { name: "Insert table" }).click();
	await page.keyboard.type("A");
	await page.getByRole("button", { name: "Row", exact: true }).click();
	await page.getByRole("menuitem", { name: "Insert row below" }).click();
	await expect(editor.locator("tr")).toHaveCount(4);

	await page.keyboard.press("ControlOrMeta+End");
	await page.evaluate((b64) => {
		const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
		const data = new DataTransfer();
		data.items.add(new File([bytes], "image.png", { type: "image/png" }));
		document.querySelector(".ProseMirror")?.dispatchEvent(
			new ClipboardEvent("paste", {
				clipboardData: data,
				bubbles: true,
				cancelable: true,
			}),
		);
	}, pixel);
	await expect(editor.locator("img[data-file-name]")).toHaveCount(1);

	await page.keyboard.press("ControlOrMeta+s");
	await expect(page).toHaveURL(/\/pages\/viewpage\.action\?pageId=/);
	const pageId = new URL(page.url()).searchParams.get("pageId") as string;

	const response = await page.request.get(`/api/wiki/edit/pages/${pageId}`, {
		headers,
	});
	const body = ((await response.json()) as { page: { bodyDoc: Node } }).page
		.bodyDoc;
	const nodes = collect(body);
	const macros = nodes.filter((node) => node.type === "macro");
	expect(macros.map((node) => node.attrs?.name)).toEqual(["info", "toc"]);
	expect(macros[0].attrs?.params).toEqual([
		{ name: "title", value: "Heads up" },
	]);
	expect(nodes.filter((node) => node.type === "tableRow")).toHaveLength(4);
	expect(nodes.some((node) => node.type === "mention")).toBe(true);
	const linked = nodes
		.flatMap((node) => node.marks ?? [])
		.find((mark) => mark.type === "link");
	expect(linked?.attrs?.ref).toEqual({
		tag: "ri:page",
		attrs: {
			"ri:content-title": `Link target ${run}`,
			"ri:space-key": spaceKey,
		},
	});
	expect(linked?.attrs?.href).toBe(
		`/pages/viewpage.action?pageId=${targetPage.id}`,
	);
	const image = nodes.find((node) => node.type === "image");
	expect(String(image?.attrs?.fileName)).toMatch(/^pasted-\d{8}-\d{6}\.png$/);
});
