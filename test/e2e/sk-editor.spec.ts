import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, type Page, test } from "./fixtures.ts";

const run = randomUUID().slice(0, 8);
const username = `sk-editor-${run}`;
const displayName = `SK Editor ${run}`;

let client: Client;
let userId: string;

function watchConsole(page: Page) {
	const problems: string[] = [];
	page.on("console", (message) => {
		if (
			message.type() === "error" ||
			(message.type() === "warning" && /hydrat/i.test(message.text()))
		) {
			problems.push(message.text());
		}
	});
	page.on("pageerror", (error) => problems.push(error.message));
	return problems;
}

async function issueSteps(page: Page) {
	const editor = page.locator(
		'[data-testid="issue-editor"] .fat-editor-content',
	);
	await expect(editor).toHaveAttribute("contenteditable", "true");
	await expect(editor).toContainText("Release notes");
	await editor.getByRole("heading", { name: "Release notes" }).click();
	await expect(editor).toBeFocused();
	await page.waitForTimeout(100);
	await page.keyboard.press("Control+End");
	await page.waitForTimeout(50);
	await page.keyboard.press("Enter");
	await page.waitForTimeout(50);

	await page.keyboard.type("Toolbar bold");
	await page.waitForTimeout(50);
	await page.keyboard.press("Shift+Home");
	await page.waitForTimeout(50);
	await page.getByRole("button", { name: "Bold" }).first().click();
	await expect(
		page.getByRole("button", { name: "Bold" }).first(),
	).toHaveAttribute("aria-pressed", "true");
	await expect(editor).toBeFocused();

	await page.keyboard.press("End");
	await page.waitForTimeout(50);
	await page.keyboard.press("Control+b");
	await expect(
		page.getByRole("button", { name: "Bold" }).first(),
	).toHaveAttribute("aria-pressed", "false");
	await page.keyboard.press("Enter");
	await page.waitForTimeout(50);
	await page.keyboard.type("Shortcut bold");
	await page.waitForTimeout(50);
	await expect(
		page.getByRole("button", { name: "Bold" }).first(),
	).toHaveAttribute("aria-pressed", "false");
	await page.keyboard.press("Shift+Home");
	await page.waitForTimeout(50);
	await page.keyboard.press("Control+b");
	await expect(
		page.getByRole("button", { name: "Bold" }).first(),
	).toHaveAttribute("aria-pressed", "true");
	await expect(editor).toBeFocused();

	await page.keyboard.press("End");
	await page.waitForTimeout(50);
	await page.keyboard.press("Control+b");
	await page.waitForTimeout(50);
	await page.keyboard.press("Enter");
	await page.waitForTimeout(50);
	await page.keyboard.type("@");
	await expect(
		page.getByRole("listbox", { name: "Mention a user" }),
	).toBeVisible();
	await page.keyboard.type(run);
	const option = page.getByRole("option", { name: new RegExp(displayName) });
	await expect(option).toBeVisible();
	await option.click();
	await expect(editor.locator("a.user-hover")).toHaveText(`@${displayName}`);

	await page.keyboard.press("Enter");
	await page.getByRole("button", { name: "Task list" }).first().click();
	await expect(editor).toBeFocused();
	await page.keyboard.type("Task one");
	await page.keyboard.press("Enter");
	await page.keyboard.type("Task two");
	await page.keyboard.press("Enter");
	await page.waitForTimeout(100);
	await editor.locator(":scope > p").last().click();
	await page.keyboard.press("End");
	await page.getByRole("button", { name: "Table" }).first().click();
	await page.waitForTimeout(300);

	const html = (await page.getByTestId("issue-html").textContent()) ?? "";
	const json = (await page.getByTestId("issue-json").textContent()) ?? "";
	return { html, json };
}

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	const inserted = await client.query<{ id: string }>(
		`insert into users (username, display_name) values ($1, $2) returning id`,
		[username, displayName],
	);
	userId = inserted.rows[0].id;
});

test.afterAll(async () => {
	if (!client) return;
	await client.query("delete from users where id = $1", [userId]);
	await client.end();
});

test("the issue editor produces the expected document", async ({ page }) => {
	const problems = watchConsole(page);

	await page.goto("/auth/login?returnTo=/sk-editor");
	await expect(
		page.getByRole("heading", { name: "SK editor gallery" }),
	).toBeVisible();

	const svelte = await issueSteps(page);
	expect(svelte.html).toContain("<strong>Toolbar bold</strong>");
	expect(svelte.html).toContain("<strong>Shortcut bold</strong>");
	expect(svelte.html).toContain("<table");
	expect(svelte.html).toContain('data-type="taskList"');
	expect(svelte.html).toContain(`data-user-id="${userId}"`);
	expect(svelte.html).toContain(`>@${displayName}</a>`);
	const svelteDoc = JSON.parse(svelte.json) as { content: { type: string }[] };
	expect(svelteDoc.content.some((node) => node.type === "table")).toBe(true);
	expect(svelteDoc.content.some((node) => node.type === "taskList")).toBe(true);

	expect(problems).toEqual([]);
});

test("the wiki macro views edit, undo, delete and keep the inline caret", async ({
	page,
}) => {
	const problems = watchConsole(page);

	await page.goto("/auth/login?returnTo=/sk-editor");
	const wiki = page.getByTestId("wiki-editor");
	const info = wiki.locator(".wke-macro-info");
	const title = info.locator(".wke-callout-title");
	await expect(info).toHaveCount(1);
	await expect(wiki.locator(".wke-inline-macro")).toHaveCount(1);

	await title.click({ modifiers: ["Control"] });
	await expect(info).toHaveClass(/is-selected/);
	await info.getByRole("button", { name: "Edit macro" }).click();
	await info.getByLabel("Title").fill("Edited window");
	await info.getByRole("button", { name: "Save" }).click();
	await expect(title).toHaveText("Edited window");
	await expect(page.getByTestId("wiki-json")).toContainText("Edited window");

	// TipTap moves the focus back to the editor in an animation frame; undo needs it there.
	await expect(
		wiki.locator('.ProseMirror[contenteditable="true"]'),
	).toBeFocused();
	await page.keyboard.press("Control+z");
	await expect(title).toHaveText("Deployment window");
	await expect(page.getByTestId("wiki-json")).not.toContainText(
		"Edited window",
	);

	await title.click({ modifiers: ["Control"] });
	await expect(info).toHaveClass(/is-selected/);
	await page.keyboard.press("Delete");
	await expect(wiki.locator(".wke-macro-info")).toHaveCount(0);

	const paragraph = wiki.locator(".wke-content p").first();
	await expect(paragraph).toContainText("release-notes");
	await paragraph.click({ position: { x: 5, y: 10 } });
	await page.keyboard.press("Control+Home");
	for (let index = 0; index < "Read the ".length; index += 1) {
		await page.keyboard.press("ArrowRight");
	}
	await page.keyboard.type("BEFORE ");
	await expect(paragraph).toContainText("Read the BEFORE");
	await page.keyboard.press("ArrowRight");
	await page.keyboard.type(" AFTER");
	await expect(paragraph).toContainText("release-notes AFTER");
	await expect(wiki.locator(".wke-inline-macro")).toHaveCount(1);

	const doc = JSON.parse(
		(await page.getByTestId("wiki-json").textContent()) ?? "{}",
	) as {
		content: {
			content?: { type: string; text?: string }[];
		}[];
	};
	const first = doc.content[0];
	expect(first.content?.[0]?.text).toBe("Read the BEFORE ");
	expect(first.content?.[1]?.type).toBe("inlineMacro");
	expect(first.content?.[2]?.text).toContain(" AFTER");

	expect(problems).toEqual([]);
});
