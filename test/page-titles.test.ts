import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

const ROUTES = "src/routes";

/**
 * Frames that render PageTitle for the pages inside them. A page may render one
 * of these instead of a PageTitle of its own; the reason says where the title
 * comes from.
 */
const FRAMES = [
	{
		component: "AdminPage",
		file: "src/lib/admin/AdminPage.svelte",
		reason:
			"AdminPage renders PageTitle from the title every admin page passes it.",
	},
	{
		component: "BoardShell",
		file: "src/lib/boards/BoardShell.svelte",
		reason: "BoardShell renders PageTitle from the board name.",
	},
	{
		component: "MissingBoard",
		file: "src/lib/boards/MissingBoard.svelte",
		reason: "MissingBoard renders the Board not found title.",
	},
	{
		component: "PageView",
		file: "src/lib/wiki/PageView.svelte",
		reason: "PageView renders PageTitle from the wiki page title.",
	},
	{
		component: "PageMessage",
		file: "src/lib/wiki/PageMessage.svelte",
		reason: "PageMessage renders PageTitle from its title prop.",
	},
	{
		component: "ProjectError",
		file: "src/lib/project/ProjectError.svelte",
		reason: "ProjectError renders the Project not found or Forbidden title.",
	},
] as const;

/** Pages whose load always redirects, so there is no screen to title. */
const REDIRECT_ONLY = new Map([
	[
		"src/routes/+page.svelte",
		"its load redirects every signed-in visitor to the dashboard",
	],
	[
		"src/routes/servicedesk/customer/portals/+page.svelte",
		"its load redirects to the first portal",
	],
]);

function filesNamed(name: string) {
	return readdirSync(ROUTES, { recursive: true })
		.map(String)
		.filter((file) => file.endsWith(name))
		.filter((file) => !file.split("/").includes("(gallery)"))
		.map((file) => join(ROUTES, file))
		.sort();
}

function rendersTitle(source: string) {
	return (
		/<PageTitle(?:\s[^>]*)?\/?>/.test(source) ||
		/<svelte:head>[\s\S]*?<title[\s>]/.test(source)
	);
}

function renderedFrame(source: string) {
	return FRAMES.find(({ component }) =>
		new RegExp(`<${component}(?:\\s|/|>)`).test(source),
	);
}

test("every page outside the gallery renders a title, directly or through a listed frame", () => {
	const untitled = filesNamed("+page.svelte").filter((file) => {
		const name = relative(".", file);
		if (REDIRECT_ONLY.has(name)) return false;
		const source = readFileSync(file, "utf8");
		return !rendersTitle(source) && !renderedFrame(source);
	});

	expect(untitled, "add PageTitle to the page or a frame to the list").toEqual(
		[],
	);
});

test("every listed frame renders PageTitle itself", () => {
	for (const frame of FRAMES) {
		expect(readFileSync(frame.file, "utf8"), frame.reason).toContain(
			"<PageTitle",
		);
	}
});

test("every error page renders a title", () => {
	const untitled = filesNamed("+error.svelte").filter((file) => {
		const source = readFileSync(file, "utf8");
		return !rendersTitle(source) && !renderedFrame(source);
	});
	expect(untitled, "add PageTitle to the error page").toEqual([]);
});
