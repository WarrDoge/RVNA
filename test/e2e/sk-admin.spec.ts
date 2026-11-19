import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const username = `e2e-sk-admin-${run}`;
const password = `sk-admin-passphrase-${run}`;

test.afterAll(async () => {
	const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
	try {
		await pool.query(
			"delete from audit_log where actor_name = $1 or summary like $2",
			[username, `%${username}%`],
		);
		await pool.query("delete from users where username = $1", [username]);
	} finally {
		await pool.end();
	}
});

test("the administration gallery is server rendered and its dialogs and sortable rows work", async ({
	page,
	request,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });

	const signedOut = await request.get("/sk-admin", { maxRedirects: 0 });
	expect(signedOut.status()).toBe(302);
	expect(signedOut.headers().location).toBe("/login.jsp?returnTo=%2Fsk-admin");

	const consoleProblems: string[] = [];
	page.on("console", (message) => {
		if (
			message.type() === "error" ||
			(message.type() === "warning" && /hydrat/i.test(message.text()))
		) {
			consoleProblems.push(message.text());
		}
	});
	page.on("pageerror", (error) => consoleProblems.push(error.message));

	await page.goto("/auth/login?returnTo=/sk-admin");
	await expect(page).toHaveURL(/\/sk-admin$/);

	const response = await page.request.get("/sk-admin");
	expect(response.status()).toBe(200);
	const html = await response.text();
	expect(html).toContain('aria-label="Administration"');
	for (const heading of ["Projects", "Issues", "User management", "System"]) {
		expect(html).toContain(`>${heading}<`);
	}
	for (const href of [
		"/secure/project/ViewProjects.jspa",
		"/secure/admin/ViewIssueTypes.jspa",
		"/secure/admin/workflows/ListWorkflows.jspa",
		"/secure/admin/user/UserBrowser.jspa",
		"/secure/admin/ViewApplicationProperties.jspa",
	]) {
		expect(html).toContain(`href="${href}"`);
	}

	await expect(
		page.getByRole("heading", { name: "Administration gallery" }),
	).toBeVisible();
	await expect(
		page.getByRole("navigation", { name: "Administration" }),
	).toBeVisible();
	await expect(page.getByTestId("sort-order")).toHaveText(
		"Order: Alpha, Bravo, Charlie",
	);

	await page.getByRole("button", { name: "Add entity" }).click();
	const addDialog = page.getByRole("dialog", { name: "Add entity" });
	await expect(addDialog).toBeVisible();
	await addDialog.getByLabel("Name").fill("Delta");
	await addDialog.getByLabel("Key").fill("DLT");
	await addDialog.getByRole("button", { name: "Save" }).click();
	await expect(addDialog).toBeHidden();
	await expect(
		page.locator("tr[data-entity]").filter({ hasText: "Delta" }),
	).toBeVisible();

	await page
		.getByRole("row", { name: /Delta/ })
		.getByRole("button", { name: "Edit Delta" })
		.click();
	const editDialog = page.getByRole("dialog", { name: "Edit entity" });
	await expect(editDialog).toBeVisible();
	await editDialog.getByLabel("Name").fill("Delta edited");
	await editDialog.getByRole("button", { name: "Save" }).click();
	await expect(editDialog).toBeHidden();
	await expect(
		page.locator("tr[data-entity]").filter({ hasText: "Delta edited" }),
	).toBeVisible();

	await page
		.getByRole("row", { name: /Delta edited/ })
		.getByRole("button", { name: "Delete Delta edited" })
		.click();
	const deleteDialog = page.getByRole("dialog", {
		name: "Delete entity: Delta edited",
	});
	await expect(deleteDialog).toBeVisible();
	await deleteDialog.getByRole("button", { name: "Delete" }).click();
	await expect(
		page.locator("tr[data-entity]").filter({ hasText: "Delta edited" }),
	).toHaveCount(0);

	await page.getByLabel("Filter entities").fill("Bravo");
	await expect(
		page.locator("tr[data-entity]").filter({ hasText: "Bravo" }),
	).toBeVisible();
	await expect(
		page.locator("tr[data-entity]").filter({ hasText: "Alpha" }),
	).toHaveCount(0);
	await page.getByLabel("Filter entities").fill("");

	await page
		.getByRole("heading", { name: "Sortable list" })
		.scrollIntoViewIfNeeded();
	const dragSource = page.locator('tr[data-row="sort-charlie"]');
	const dropTarget = page.locator('tr[data-row="sort-alpha"]');
	await dragSource.dragTo(dropTarget);
	await expect(page.getByTestId("sort-order")).toHaveText(
		"Order: Charlie, Alpha, Bravo",
	);

	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	await dragSource.dispatchEvent("dragstart", { dataTransfer });
	await dropTarget.dispatchEvent("dragover", { dataTransfer });
	await expect(dropTarget).toHaveAttribute("data-drop-target", "true");
	await dragSource.dispatchEvent("dragend", { dataTransfer });
	await expect(page.getByTestId("sort-order")).toHaveText(
		"Order: Charlie, Alpha, Bravo",
	);

	const moveCharlieDown = page.getByRole("button", {
		name: "Move resolution Charlie down",
	});
	await moveCharlieDown.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("sort-order")).toHaveText(
		"Order: Alpha, Charlie, Bravo",
	);

	expect(consoleProblems).toEqual([]);
});

test("a non-administrator gets the forbidden page with status 403", async ({
	page,
}) => {
	await page.goto("/auth/login?returnTo=/sk-admin");
	await expect(page).toHaveURL(/\/sk-admin$/);

	const origin = new URL(page.url()).origin;
	const created = await page.request.post("/api/admin/users", {
		headers: {
			"x-requested-with": "rvna",
			origin,
		},
		data: {
			username,
			displayName: "E2E non administrator",
			password,
			mustChangePassword: false,
		},
	});
	expect(created.status()).toBe(201);

	const loggedOut = await page.request.post("/auth/logout", {
		headers: {
			"x-requested-with": "rvna",
			origin,
		},
	});
	expect(loggedOut.status()).toBe(200);

	const loggedIn = await page.request.post("/auth/local", {
		headers: {
			"x-requested-with": "rvna",
			origin,
		},
		data: { username, password, returnTo: "/sk-admin" },
	});
	expect(loggedIn.status()).toBe(200);

	const response = await page.goto("/sk-admin");
	expect(response?.status()).toBe(403);
	await expect(
		page.getByRole("heading", { name: "403 Forbidden" }),
	).toBeVisible();
	// The gallery is outside the (admin) group, so the root error page answers.
	await expect(page.getByText("Forbidden", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Go to the dashboard" }),
	).toHaveAttribute("href", "/secure/Dashboard.jspa");
});
