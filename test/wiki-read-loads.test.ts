import { isRedirect } from "@sveltejs/kit";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { pool } from "../src/lib/server/db.ts";
import { load as loadTitle } from "../src/routes/display/[spaceKey]/[title]/+page.server.ts";
import { load as loadView } from "../src/routes/pages/viewpage.action/+page.server.ts";
import { load as loadAttachments } from "../src/routes/pages/viewpageattachments.action/+page.server.ts";
import { load as loadHistory } from "../src/routes/pages/viewpreviousversions.action/+page.server.ts";
import { load as loadSpacePage } from "../src/routes/spaces/[spaceKey]/pages/[pageId]/[title]/+page.server.ts";
import { setupWiki, type TestSpace } from "./wiki-edit-support.ts";

let wiki: Awaited<ReturnType<typeof setupWiki>>;
let space: TestSpace;
let reader: CurrentUser;
let admin: CurrentUser;
let pageId: string;
let title: string;

function eventFor(
	actor: CurrentUser,
	params: Record<string, string>,
	url: string,
) {
	return {
		locals: { user: actor },
		params,
		url: new URL(url, "http://localhost"),
		route: { id: "test" },
		depends: () => {},
	} as never;
}

async function actorFor(id: string, isAdmin: boolean): Promise<CurrentUser> {
	const { rows } = await pool.query<{
		id: string;
		username: string;
		display_name: string;
		email: string | null;
	}>("select id, username, display_name, email from users where id = $1", [id]);
	const row = rows[0];
	if (!row) throw new Error("test user not found");
	return {
		id: row.id,
		username: row.username,
		displayName: row.display_name,
		email: row.email,
		avatarUrl: null,
		groups: [],
		isAdmin,
		mustChangePassword: false,
		hasPassword: false,
	};
}

beforeAll(async () => {
	wiki = await setupWiki();
	space = await wiki.space("READ");
	title = "Percent %20 and plus + title";
	const page = await wiki.page(wiki.admin, space.key, title);
	pageId = page.id;

	const readerClient = await wiki.user("reader");
	await wiki.grant(space.id, { userId: readerClient.id }, ["read"]);
	reader = await actorFor(readerClient.id, false);
	admin = await actorFor(wiki.admin.id, true);
});

afterAll(async () => {
	await wiki.cleanup();
	await pool.end();
});

test("a title route uses the already-decoded param, not a second decode", async () => {
	const result = await loadTitle(
		eventFor(reader, { spaceKey: space.key, title }, "/display/x"),
	);
	expect(result.page?.title).toBe(title);
});

test("an old plus-for-space title link still resolves", async () => {
	const legacy = await wiki.page(wiki.admin, space.key, "Legacy space title");
	const result = await loadTitle(
		eventFor(
			reader,
			{ spaceKey: space.key, title: "Legacy+space+title" },
			"/display/x",
		),
	);
	expect(result.page?.id).toBe(legacy.id);
});

test("a page under the wrong space or title redirects to its canonical address", async () => {
	let thrown: unknown;
	try {
		await loadSpacePage(
			eventFor(
				admin,
				{ spaceKey: "WRONG", pageId, title: "wrong title" },
				"/spaces/WRONG/pages/x/wrong",
			),
		);
	} catch (cause) {
		thrown = cause;
	}
	expect(isRedirect(thrown)).toBe(true);
	const location = (thrown as { location: string }).location;
	expect(location).toContain(`/spaces/${space.key}/pages/${pageId}/`);
	expect(location).toContain(encodeURIComponent(title));
});

test("the attachment and history loads report what the reader may do", async () => {
	const attachments = await loadAttachments(
		eventFor(reader, {}, `/pages/viewpageattachments.action?pageId=${pageId}`),
	);
	expect(attachments.page?.id).toBe(pageId);
	expect(attachments.canEdit).toBe(false);
	expect(attachments.attachments.every((row) => row.canDelete === false)).toBe(
		true,
	);

	const history = await loadHistory(
		eventFor(reader, {}, `/pages/viewpreviousversions.action?pageId=${pageId}`),
	);
	expect(history.page?.id).toBe(pageId);
	expect(history.canEdit).toBe(false);

	const view = await loadView(
		eventFor(reader, {}, `/pages/viewpage.action?pageId=${pageId}`),
	);
	expect(view.page?.id).toBe(pageId);
	expect(view.canEdit).toBe(false);
	expect(view.canDelete).toBe(false);

	const asAdmin = await loadAttachments(
		eventFor(admin, {}, `/pages/viewpageattachments.action?pageId=${pageId}`),
	);
	expect(asAdmin.canEdit).toBe(true);

	const adminView = await loadView(
		eventFor(admin, {}, `/pages/viewpage.action?pageId=${pageId}`),
	);
	expect(adminView.canEdit).toBe(true);
	expect(adminView.canDelete).toBe(true);
});
