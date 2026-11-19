import type { Page } from "@playwright/test";

const CLIENT_SCRIPTS = /\/_app\/immutable\/.*\.js(\?.*)?$/;

/** Waits until SvelteKit has hydrated the current page. */
export async function waitForHydration(page: Page) {
	await page.waitForFunction(
		() => document.documentElement.dataset.hydrated !== undefined,
		undefined,
		{ timeout: 20_000 },
	);
}

/**
 * Holds every client script so the page stays server-rendered. The test acts on
 * that page, then `hydrate()` releases the scripts and waits for hydration.
 */
export async function holdClientScripts(page: Page) {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(CLIENT_SCRIPTS, async (route) => {
		await gate;
		await route.continue();
	});
	return {
		async hydrate() {
			release();
			await waitForHydration(page);
			await page.waitForTimeout(500);
		},
	};
}
