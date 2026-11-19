import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, type Page, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 6).toUpperCase();
const spaceKey = `WR${run}`;
const noHomeKey = `WN${run}`;
const readerName = `e2e-wiki-reader-${run.toLowerCase()}`;
const readerToken = randomBytes(24).toString("base64url");
const pageATitle = `Read A ${run}`;
const pageBTitle = `Read B ${run}`;
const oldTipBody = `Old format tip body ${run}`;
const homeTitle = `Read home ${run}`;
const noHomePageTitle = `No home page ${run}`;
const label = `e2e-read-${run.toLowerCase()}`;
const baseURL = `http://127.0.0.1:${process.env.PORT ?? "4960"}`;

let client: Client;
let pageAId: string;

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	await client.query("delete from spaces where key = any($1)", [
		[spaceKey, noHomeKey],
	]);
	await client.query("delete from users where username = $1", [readerName]);

	const space = await client.query<{ id: string }>(
		`insert into spaces (source_id, key, name, type)
		 values ($1, $2, $3, 'global') returning id`,
		[`e2e-read-space-${run}`, spaceKey, `Read space ${run}`],
	);
	const spaceId = space.rows[0]?.id;
	if (!spaceId) throw new Error("space was not created");

	const home = await insertPage(
		spaceId,
		`e2e-read-home-${run}`,
		homeTitle,
		null,
	);
	const a = await insertPage(
		spaceId,
		`e2e-read-a-${run}`,
		pageATitle,
		home.id,
		2,
	);
	await insertPage(spaceId, `e2e-read-b-${run}`, pageBTitle, home.id);
	pageAId = a.id;
	await client.query("update pages set body_storage = $1 where id = $2", [
		`<p>${pageATitle}</p><ac:macro ac:name="tip"><ac:rich-text-body><p>${oldTipBody}</p></ac:rich-text-body></ac:macro>`,
		pageAId,
	]);
	await client.query("update spaces set home_page_id = $1 where id = $2", [
		home.id,
		spaceId,
	]);

	await client.query(
		`insert into page_versions (source_id, page_id, number, title, body_storage, body_html, created, message)
		 values ($1, $2, 1, $3, '<p>old</p>', '<p>old</p>', now() - interval '2 days', 'first'),
		        ($4, $2, 2, $3, '<p>new</p>', '<p>new</p>', now() - interval '1 day', 'second')`,
		[
			`e2e-read-version-1-${run}`,
			a.id,
			pageATitle,
			`e2e-read-version-2-${run}`,
		],
	);
	await client.query(
		`insert into page_attachments
		 (source_id, page_id, file_name, mime_type, size, version, storage_path, sha256)
		 values ($1, $2, 'read.txt', 'text/plain', 12, 1, 'e2e/read.txt', $3)`,
		[`e2e-read-attachment-${run}`, a.id, "a".repeat(64)],
	);
	await client.query(
		`insert into page_labels (source_id, page_id, label) values ($1, $2, $3)`,
		[`e2e-read-label-${run}`, a.id, label],
	);

	const reader = await client.query<{ id: string }>(
		`insert into users (username, display_name, email)
		 values ($1, $2, $3) returning id`,
		[readerName, `Reader ${run}`, `${readerName}@example.test`],
	);
	const readerId = reader.rows[0]?.id;
	if (!readerId) throw new Error("reader was not created");
	await client.query(
		`insert into sessions (id_hash, user_id, expires_at)
		 values ($1, $2, now() + interval '1 day')`,
		[createHash("sha256").update(readerToken).digest("hex"), readerId],
	);
	await client.query(
		`insert into space_permissions (source_id, space_id, permission, user_id)
		 values ($1, $2, 'read', $3)`,
		[`e2e-read-permission-${run}`, spaceId, readerId],
	);
	await client.query(
		`insert into page_restrictions (source_id, page_id, operation, user_id)
		 values ($1, $2, 'read', $3)`,
		[`e2e-read-restriction-${run}`, a.id, readerId],
	);

	const noHome = await client.query<{ id: string }>(
		`insert into spaces (source_id, key, name, type)
		 values ($1, $2, $3, 'global') returning id`,
		[`e2e-read-nohome-${run}`, noHomeKey, `No home space ${run}`],
	);
	const noHomeSpaceId = noHome.rows[0]?.id;
	if (!noHomeSpaceId) throw new Error("space was not created");
	await insertPage(
		noHomeSpaceId,
		`e2e-read-nohome-page-${run}`,
		noHomePageTitle,
		null,
	);
});

test.afterAll(async () => {
	await client.query("delete from spaces where key = any($1)", [
		[spaceKey, noHomeKey],
	]);
	await client.query("delete from users where username = $1", [readerName]);
	await client.end();
});

async function insertPage(
	spaceId: string,
	sourceId: string,
	title: string,
	parentId: string | null,
	version = 1,
) {
	const result = await client.query<{ id: string }>(
		`insert into pages
		 (source_id, space_id, parent_id, position, title, body_storage, body_html, version_number, created, updated)
		 values ($1, $2, $3, 0, $4, $5, $5, $6, now(), now()) returning id`,
		[sourceId, spaceId, parentId, title, `<p>${title}</p>`, version],
	);
	const row = result.rows[0];
	if (!row) throw new Error("page was not created");
	return row;
}

async function adminLogin(page: Page) {
	await page.goto("/auth/login?returnTo=%2Fwiki");
	await expect(page).toHaveURL(/\/wiki$/);
}

test("a comment draft does not follow navigation to another page", async ({
	page,
}) => {
	await adminLogin(page);
	await page.goto(`/display/${spaceKey}/${encodeURIComponent(pageATitle)}`);
	await expect(page.getByRole("heading", { name: pageATitle })).toBeVisible();

	await page.getByRole("button", { name: "Add a comment" }).click();
	await page.getByLabel("Add a comment").fill("draft on the first page");
	await page.locator(".wiki-tree-link", { hasText: pageBTitle }).click();
	await expect(page.getByRole("heading", { name: pageBTitle })).toBeVisible();

	await expect(page.getByLabel("Add a comment")).toHaveCount(0);
	await page.getByRole("button", { name: "Add a comment" }).click();
	await expect(page.getByLabel("Add a comment")).toHaveValue("");
});

test("a reader sees no edit controls", async ({ page }) => {
	await page
		.context()
		.addCookies([{ name: "sid", value: readerToken, url: baseURL }]);

	await page.goto(`/pages/viewpageattachments.action?pageId=${pageAId}`);
	await expect(
		page.getByRole("heading", { name: "Attachments" }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Upload file" })).toHaveCount(
		0,
	);
	await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);

	await page.goto(`/pages/viewpreviousversions.action?pageId=${pageAId}`);
	await expect(
		page.getByRole("heading", { name: "Page history" }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Restore" })).toHaveCount(0);

	await page.goto(`/pages/viewpage.action?pageId=${pageAId}`);
	await expect(page.getByRole("heading", { name: pageATitle })).toBeVisible();
	await expect(page.getByRole("button", { name: "Add label" })).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: `Remove label ${label}` }),
	).toHaveCount(0);

	await page.getByRole("button", { name: "More actions" }).click();
	await expect(page.getByRole("menuitem", { name: "Move" })).toHaveCount(0);
	await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);

	await page.getByRole("button", { name: "Restrictions" }).click();
	const dialog = page.getByRole("dialog", { name: "Restrictions" });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText("Page restrictions")).toBeVisible();
	await expect(dialog.getByText("Space permissions")).toHaveCount(0);
});

test("an editor still sees the controls", async ({ page }) => {
	await adminLogin(page);
	await page.goto(`/pages/viewpageattachments.action?pageId=${pageAId}`);
	await expect(page.getByRole("button", { name: "Upload file" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();

	await page.goto(`/pages/viewpreviousversions.action?pageId=${pageAId}`);
	await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();

	await page.goto(`/pages/viewpage.action?pageId=${pageAId}`);
	await expect(page.getByRole("button", { name: "Add label" })).toBeVisible();
	await page.getByRole("button", { name: "More actions" }).click();
	await expect(page.getByRole("menuitem", { name: "Move" })).toBeVisible();
	await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
});

test("an old-format macro keeps its body on the page view", async ({
	page,
}) => {
	await adminLogin(page);
	await page.goto(`/pages/viewpage.action?pageId=${pageAId}`);
	await expect(page.getByText(oldTipBody)).toBeVisible();
	await expect(page.locator(".wiki-panel-tip")).toContainText(oldTipBody);
});

test("a space without a home page lists its root pages", async ({ page }) => {
	await adminLogin(page);
	await page.goto(`/display/${noHomeKey}`);
	await expect(
		page.getByRole("heading", { name: `No home space ${run}` }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: noHomePageTitle }).first(),
	).toBeVisible();
	await expect(page.getByText("No pages in this space yet.")).toHaveCount(0);
});
