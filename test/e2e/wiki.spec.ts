import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "pg";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const spaceKey = `E2W${run.slice(0, 4).toUpperCase()}`;
const spaceName = `Wiki e2e ${run}`;
const homeTitle = `Wiki e2e home ${run}`;
const childTitle = `Wiki e2e child ${run}`;
const childSourceId = `e2e-wiki-${run}-child`;
const homeSourceId = `e2e-wiki-${run}-home`;
const attachmentsDir = process.env.ATTACHMENTS_DIR ?? "./data/attachments";

let client: Client;
let storagePath: string | null = null;

const homeStorage = [
	'<ac:structured-macro ac:name="tip"><ac:parameter ac:name="title">Read me first</ac:parameter>',
	"<ac:rich-text-body><p>This page belongs to the wiki end-to-end test.</p></ac:rich-text-body>",
	"</ac:structured-macro>",
	"<h2>Steps</h2>",
	'<ac:structured-macro ac:name="toc" />',
	'<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">text</ac:parameter>',
	"<ac:plain-text-body><![CDATA[first line\nsecond line]]></ac:plain-text-body>",
	"</ac:structured-macro>",
].join("");

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	await client.query("delete from spaces where key = $1", [spaceKey]);

	const space = await client.query<{ id: string }>(
		`insert into spaces (source_id, key, name, type) values ($1, $2, $3, 'global') returning id`,
		[`e2e-wiki-space-${run}`, spaceKey, spaceName],
	);
	const spaceId = space.rows[0]?.id;
	if (!spaceId) throw new Error("space was not created");

	const home = await client.query<{ id: string }>(
		`insert into pages (source_id, space_id, position, title, body_storage, body_html, created, updated)
		 values ($1, $2, 0, $3, $4, '<p>placeholder</p>', now(), now()) returning id`,
		[homeSourceId, spaceId, homeTitle, homeStorage],
	);
	const homeId = home.rows[0]?.id;
	await client.query("update spaces set home_page_id = $1 where id = $2", [
		homeId,
		spaceId,
	]);

	await client.query(
		`insert into pages (source_id, space_id, parent_id, position, title, body_storage, body_html, created, updated)
		 values ($1, $2, $3, 0, $4, '<p>child body</p>', '<p>child body</p>', now(), now())`,
		[childSourceId, spaceId, homeId, childTitle],
	);

	await client.query(
		`insert into page_versions (source_id, page_id, number, title, body_storage, body_html, created, message)
		 values
		 ($1, $2, 1, $3, '<p>the old body</p>', '<p>the old body</p>', now() - interval '2 days', 'first'),
		 ($4, $2, 2, $3, '<p>the new body</p>', '<p>the new body</p>', now() - interval '1 day', 'second')`,
		[
			`e2e-wiki-${run}-version-1`,
			homeId,
			homeTitle,
			`e2e-wiki-${run}-version-2`,
		],
	);

	await client.query(
		`insert into page_comments (source_id, page_id, body_html, created, updated)
		 values ($1, $2, '<p>seeded comment</p>', now(), now())`,
		[`e2e-wiki-${run}-comment`, homeId],
	);
});

test.afterAll(async () => {
	if (storagePath) {
		const root = resolve(attachmentsDir);
		const file = resolve(root, storagePath);
		if (file.startsWith(root)) await rm(file, { force: true });
	}
	await client.query("delete from spaces where key = $1", [spaceKey]);
	await client.end();
});

test("browse, comment, attach and compare versions", async ({ page }) => {
	await page.setViewportSize({ width: 1500, height: 775 });
	await page.goto("/auth/login?returnTo=%2Fwiki");
	await expect(page).toHaveURL(/\/wiki$/);

	await page.screenshot({ path: "/tmp/rvna-wiki-home.png" });

	await page.goto("/spacedirectory/view.action");
	await expect(
		page.getByRole("heading", { name: "Site Spaces" }),
	).toBeVisible();
	await page.screenshot({ path: "/tmp/rvna-wiki-spaces.png" });

	await page.getByRole("link", { name: spaceName }).click();
	await expect(page.getByRole("heading", { name: homeTitle })).toBeVisible();
	await expect(page.locator(".wiki-panel-tip")).toContainText("Read me first");
	await page.screenshot({ path: "/tmp/rvna-wiki-space.png" });

	await page.locator(".wiki-tree-link", { hasText: childTitle }).click();
	await expect(page.getByRole("heading", { name: childTitle })).toBeVisible();

	await page.getByRole("link", { name: homeTitle }).first().click();
	await expect(page.getByRole("heading", { name: homeTitle })).toBeVisible();
	await expect(page.locator(".wiki-toc")).toContainText("Steps");
	await expect(page.locator(".wiki-code")).toContainText("first line");

	await page.getByRole("button", { name: "Add a comment" }).click();
	await page.getByLabel("Add a comment").fill("a comment from the e2e test");
	await page.getByRole("button", { name: "Save" }).click();
	await expect(page.getByText("a comment from the e2e test")).toBeVisible();
	await expect(page.getByText("seeded comment")).toBeVisible();
	await page.screenshot({ path: "/tmp/rvna-wiki-page.png" });

	await page.goto(
		`/pages/viewpageattachments.action?pageId=${encodeURIComponent(homeSourceId)}`,
	);
	await page.getByLabel("Upload attachments").setInputFiles({
		name: "e2e-upload.txt",
		mimeType: "text/plain",
		buffer: Buffer.from("uploaded by the e2e test"),
	});
	await expect(
		page.getByRole("link", { name: "e2e-upload.txt" }),
	).toBeVisible();

	storagePath = await readStoragePath(client, homeSourceId, "e2e-upload.txt");

	await page.goto(
		`/pages/viewpreviousversions.action?pageId=${encodeURIComponent(homeSourceId)}`,
	);
	await page.getByLabel("Select version 1").check();
	await page.getByLabel("Select version 2").check();
	await page.getByRole("link", { name: "Compare selected versions" }).click();
	await expect(
		page.getByRole("heading", { name: /Comparing versions 1 and 2/ }),
	).toBeVisible();
	await expect(page.locator(".wiki-diff-added")).toContainText("new");
	await expect(page.locator(".wiki-diff-removed")).toContainText("old");
});

test("Share shows the page address when the clipboard is refused", async ({
	page,
	context,
}) => {
	const pagePath = `/pages/viewpage.action?pageId=${encodeURIComponent(homeSourceId)}`;
	await page.goto(`/auth/login?returnTo=${encodeURIComponent(pagePath)}`);
	await expect(page.getByRole("heading", { name: homeTitle })).toBeVisible();
	const address = page.url();

	const cdp = await context.newCDPSession(page);
	await cdp.send("Browser.setPermission", {
		permission: { name: "clipboard-write" },
		setting: "denied",
		origin: new URL(address).origin,
	});

	let nativeDialog = false;
	page.on("dialog", async (dialog) => {
		nativeDialog = true;
		await dialog.dismiss();
	});

	await page.getByRole("button", { name: "Share" }).click();
	const popup = page.getByRole("status").filter({ hasText: address });
	await expect(popup).toBeVisible();
	await expect(popup.getByRole("link")).toHaveAttribute("href", address);
	expect(nativeDialog).toBe(false);
});

async function readStoragePath(
	connection: Client,
	pageSourceId: string,
	fileName: string,
) {
	const result = await connection.query<{ storage_path: string }>(
		`select a.storage_path
		 from page_attachments a
		 join pages p on p.id = a.page_id
		 where p.source_id = $1 and a.file_name = $2
		 order by a.version desc limit 1`,
		[pageSourceId, fileName],
	);
	const path = result.rows[0]?.storage_path;
	return path ? join(path) : null;
}
