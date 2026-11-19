import { createHash, randomBytes, randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { expect, test, withHydrationWait } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const adminName = `e2e-profile-admin-${run}`;
const aliceName = `e2e-profile-alice-${run}`;
const bobName = `e2e-profile-bob-${run}`;
const session = randomBytes(24).toString("base64url");
const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	"base64",
);

let client: Client;
let adminId: string;
let aliceId: string;
let bobId: string;
const avatarFiles: string[] = [];

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	const admin = await client.query<{ id: string }>(
		`insert into users (username, display_name, is_admin)
		 values ($1, $2, true) returning id`,
		[adminName, "Profile admin"],
	);
	adminId = admin.rows[0].id;
	const alice = await client.query<{ id: string }>(
		`insert into users (username, display_name)
		 values ($1, $2) returning id`,
		[aliceName, "Alice Profile"],
	);
	aliceId = alice.rows[0].id;
	const bob = await client.query<{ id: string }>(
		`insert into users (username, display_name)
		 values ($1, $2) returning id`,
		[bobName, "Bob Profile"],
	);
	bobId = bob.rows[0].id;
	await client.query(
		`insert into sessions (id_hash, user_id, expires_at)
		 values ($1, $2, now() + interval '1 day')`,
		[createHash("sha256").update(session).digest("hex"), adminId],
	);
});

test.afterAll(async () => {
	if (!client) return;
	const rows = await client.query<{ avatar_file: string | null }>(
		"select avatar_file from users where id = any($1::uuid[])",
		[[aliceId, bobId]],
	);
	for (const row of rows.rows) {
		if (row.avatar_file) avatarFiles.push(row.avatar_file);
	}
	await client.query("delete from users where id = any($1::uuid[])", [
		[adminId, aliceId, bobId],
	]);
	for (const file of avatarFiles) {
		await unlink(join(process.env.AVATARS_DIR ?? "./data/avatars", file)).catch(
			() => undefined,
		);
	}
	await client.end();
});

test("an admin's avatar upload for another user does not change the top bar or leak to the next profile", async ({
	browser,
}) => {
	const context = await browser.newContext({
		baseURL: test.info().project.use.baseURL,
	});
	await context.addCookies([
		{
			name: "sid",
			value: session,
			url: test.info().project.use.baseURL as string,
		},
	]);
	const page = withHydrationWait(await context.newPage());

	await page.goto(`/secure/ViewProfile.jspa?name=${aliceName}`);
	await expect(
		page.getByRole("heading", { name: "Alice Profile" }),
	).toBeVisible();
	const topBarAvatar = page
		.getByRole("button", { name: "Account menu" })
		.locator("img");
	const topBarSrc = await topBarAvatar.getAttribute("src");
	expect(topBarSrc).toBeTruthy();

	await page.getByRole("button", { name: "Change avatar" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.locator('input[type="file"]').setInputFiles({
		name: "avatar.png",
		mimeType: "image/png",
		buffer: png,
	});
	await dialog.getByRole("button", { name: "Upload" }).click();
	await expect(page.getByRole("status")).toContainText("avatar was updated");
	await expect(
		page.getByRole("button", { name: "Change avatar" }).locator("img"),
	).toBeVisible();
	await expect(topBarAvatar).toHaveAttribute("src", topBarSrc as string);

	await page.evaluate((url) => {
		(window as { __profileMarker?: string }).__profileMarker = "alive";
		const link = document.createElement("a");
		link.href = url;
		link.textContent = "Bob profile";
		document.body.append(link);
	}, `/secure/ViewProfile.jspa?name=${bobName}`);
	await page.getByRole("link", { name: "Bob profile" }).click();
	await expect(
		page.getByRole("heading", { name: "Bob Profile" }),
	).toBeVisible();
	expect(
		await page.evaluate(
			() => (window as { __profileMarker?: string }).__profileMarker,
		),
	).toBe("alive");
	await expect(page.getByRole("status")).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Change avatar" }).locator("img"),
	).toHaveAttribute("src", new RegExp(bobId));

	await context.close();
});
