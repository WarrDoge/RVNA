import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { expect, test } from "./fixtures.ts";

const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	"base64",
);

let client: Client;
let userId: string;
let originalFile: string | null = null;

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
});

test.afterAll(async () => {
	if (!client) return;
	if (userId) {
		const result = await client.query<{ avatar_file: string | null }>(
			"select avatar_file from users where id = $1",
			[userId],
		);
		const current = result.rows[0]?.avatar_file ?? null;
		await client.query("update users set avatar_file = $1 where id = $2", [
			originalFile,
			userId,
		]);
		if (current && current !== originalFile) {
			await unlink(
				join(process.env.AVATARS_DIR ?? "./data/avatars", current),
			).catch(() => undefined);
		}
	}
	await client.end();
});

test("open the profile, upload an avatar and see it in the top bar", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/secure/ViewProfile.jspa");
	await expect(page.getByRole("heading", { name: "dev" })).toBeVisible();

	const before = await client.query<{ id: string; avatar_file: string | null }>(
		"select id, avatar_file from users where username = 'dev'",
	);
	userId = before.rows[0]?.id ?? "";
	originalFile = before.rows[0]?.avatar_file ?? null;
	await expect(page.getByText("Time zone")).toBeVisible();
	await expect(page.getByText("Assigned open issues")).toBeVisible();

	await page.getByRole("button", { name: "Change avatar" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.locator('input[type="file"]').setInputFiles({
		name: "avatar.png",
		mimeType: "image/png",
		buffer: png,
	});
	await expect(dialog.getByAltText("Square avatar preview")).toBeVisible();
	await dialog.getByRole("button", { name: "Upload" }).click();

	await expect(dialog).toHaveCount(0);
	await expect(page.getByRole("status")).toContainText("avatar was updated");

	const topBarAvatar = page
		.getByRole("button", { name: "Account menu" })
		.locator("img");
	await expect(topBarAvatar).toBeVisible();
	await expect(topBarAvatar).toHaveAttribute(
		"src",
		/^\/api\/avatars\/users\/[0-9a-f-]+\?v=[0-9a-f]{12}$/,
	);
});
