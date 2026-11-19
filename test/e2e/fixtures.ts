import { test as base, expect, type Page } from "@playwright/test";
import { waitForHydration } from "./hydration.ts";

export * from "@playwright/test";

/**
 * Makes `page.goto` also wait until the page script has attached its handlers,
 * so a test never clicks or types into a page that is still server-rendered
 * only. Tests of that early state import from "@playwright/test" instead.
 */
export function withHydrationWait(page: Page) {
	const goto = page.goto.bind(page);
	page.goto = async (url, options) => {
		const response = await goto(url, options);
		if (response?.headers()["content-type"]?.startsWith("text/html")) {
			await waitForHydration(page);
		}
		return response;
	};
	return page;
}

export const test = base.extend({
	page: async ({ page }, use) => {
		const blocked: string[] = [];
		page.on("console", (message) => {
			if (message.text().includes("Content Security Policy")) {
				blocked.push(message.text());
			}
		});
		await use(withHydrationWait(page));
		expect(blocked, "the content security policy blocked something").toEqual(
			[],
		);
	},
});
