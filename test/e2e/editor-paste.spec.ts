import { expect, type Page, test } from "@playwright/test";
import { withHydrationWait } from "./fixtures.ts";

// The browser reports the blocked handler attributes of this markup to the console while it
// parses them, so these tests do not use the fixture that fails on such a report.
const hostile = `<div class="x">kept text<iframe srcdoc="<script>window.top.__pwned = 1</script>"></iframe><img src="x" onerror="window.__pwned = 1"><object data="x"></object><embed src="x"><script>window.__pwned = 1</script><a href="javascript:window.__pwned = 1">link</a></div><p onclick="window.__pwned = 1">keep <b>bold</b></p>`;

const active =
	"iframe, object, embed, script, [srcdoc], [onerror], [onclick], [onload], a[href^='javascript:']";
const markup =
	/iframe|srcdoc|onerror|onclick|<script|<object|<embed|javascript:/;

async function paste(page: Page, selector: string, html = hostile) {
	const target = page.locator(selector).first();
	await target.click();
	await target.evaluate((element, html) => {
		const data = new DataTransfer();
		data.setData("text/html", html);
		data.setData("text/plain", "pasted");
		element.dispatchEvent(
			new ClipboardEvent("paste", {
				clipboardData: data,
				bubbles: true,
				cancelable: true,
			}),
		);
	}, html);
}

test("pasted HTML cannot put an iframe or a handler into the issue editor", async ({
	page,
}) => {
	withHydrationWait(page);
	await page.goto("/auth/login?returnTo=/sk-editor");
	const editor = page.locator(
		'[data-testid="issue-editor"] .fat-editor-content',
	);
	await expect(editor).toHaveAttribute("contenteditable", "true");
	await paste(page, '[data-testid="issue-editor"] .fat-editor-content');

	await expect(editor.locator("div.x")).toContainText("kept text");
	await expect(editor.locator("strong", { hasText: "bold" })).toHaveCount(1);
	await expect(editor.locator(active)).toHaveCount(0);
	const html = (await page.getByTestId("issue-html").textContent()) ?? "";
	expect(html).toContain("kept text");
	expect(html).not.toMatch(markup);
	expect(await page.evaluate(() => "__pwned" in window)).toBe(false);
});

test("pasted HTML cannot put an iframe or a handler into the wiki editor", async ({
	page,
}) => {
	withHydrationWait(page);
	await page.goto("/auth/login?returnTo=/sk-editor");
	const editor = page.locator('[data-testid="wiki-editor"] .wke-content');
	await expect(editor).toHaveAttribute("contenteditable", "true");
	await paste(page, '[data-testid="wiki-editor"] .wke-content p');

	await expect(editor.locator("strong", { hasText: "bold" })).toHaveCount(1);
	await expect(editor.locator(active)).toHaveCount(0);
	const json = (await page.getByTestId("wiki-json").textContent()) ?? "";
	expect(json).toContain("kept text");
	expect(json).not.toMatch(markup);
	expect(await page.evaluate(() => "__pwned" in window)).toBe(false);
});

test("a pasted block keeps what the server keeps and nothing else", async ({
	page,
}) => {
	withHydrationWait(page);
	await page.goto("/auth/login?returnTo=/sk-editor");
	await paste(
		page,
		'[data-testid="issue-editor"] .fat-editor-content',
		'<div class="note" style="position: fixed" data-x="1"><p>hello <a href="https://example.com/a">x</a> <a href="data:text/html,x">y</a></p></div>',
	);
	await expect(page.getByTestId("issue-html")).toContainText(
		'<div class="note"><p>hello <a href="https://example.com/a">x</a> <a>y</a></p></div>',
	);
});
