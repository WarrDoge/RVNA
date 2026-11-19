import { expect, test } from "vitest";
import {
	extractMentionedUserIds,
	sanitizeBodyHtml,
} from "../src/lib/server/html.ts";
import { newMentions } from "../src/lib/server/notifications.ts";

const userId = "3f8a1f0e-9d3f-4a5b-8a1e-2b6c7d8e9f00";
const otherId = "7c2b4d5e-1a3f-4b6c-9d8e-0f1a2b3c4d5e";

function mention(id: string, name: string) {
	return `<a class="user-hover" data-user-id="${id}">@${name}</a>`;
}

test("the sanitizer keeps exactly the mention anchor", async () => {
	const html = `<p>Hello ${mention(userId, "Avery Stone")}</p>`;
	expect(await sanitizeBodyHtml(html)).toBe(
		`<p>Hello <a class="user-hover" data-user-id="${userId}">@Avery Stone</a></p>`,
	);
});

test("a forged data-user-id on other tags is dropped", async () => {
	const cleaned = await sanitizeBodyHtml(
		`<div data-user-id="${userId}"><span data-user-id="${userId}">a</span><strong data-user-id="${userId}">b</strong></div>`,
	);
	expect(cleaned).not.toContain("data-user-id");
	expect(extractMentionedUserIds(cleaned)).toEqual([]);
});

test("a data-user-id on a plain link is not a mention", async () => {
	const cleaned = await sanitizeBodyHtml(
		`<a href="https://example.test" data-user-id="${userId}">not a mention</a>`,
	);
	expect(cleaned).toContain(`data-user-id="${userId}"`);
	expect(extractMentionedUserIds(cleaned)).toEqual([]);
});

test("a data-user-id that is not a user id is ignored", () => {
	const html = `<p><a class="user-hover" data-user-id="not-a-uuid">@Fake</a></p>`;
	expect(extractMentionedUserIds(html)).toEqual([]);
});

test("mentions are extracted once, in document order", () => {
	const html = `<p>${mention(userId, "Ada")} and ${mention(otherId, "Grace")} and ${mention(userId, "Ada again")}</p><p>@plain text</p>`;
	expect(extractMentionedUserIds(html)).toEqual([userId, otherId]);
	expect(extractMentionedUserIds(null)).toEqual([]);
	expect(extractMentionedUserIds("")).toEqual([]);
});

test("a mention hidden in a script tag never counts", async () => {
	const html = `<script>${mention(userId, "Ada")}</script><p>ok</p>`;
	expect(await sanitizeBodyHtml(html)).toBe("<p>ok</p>");
	expect(extractMentionedUserIds(html)).toEqual([]);
});

test("an edit reports only the newly added mentions", () => {
	const before = `<p>${mention(userId, "Ada")}</p>`;
	const after = `<p>${mention(userId, "Ada")} ${mention(otherId, "Grace")}</p>`;
	expect(newMentions(before, after)).toEqual([otherId]);
	expect(newMentions(after, after)).toEqual([]);
	expect(newMentions(null, after)).toEqual([userId, otherId]);
	expect(newMentions(before, null)).toEqual([]);
});

test("a saved body round trips through the sanitizer", async () => {
	const body = `<p>Thanks ${mention(userId, "Avery Stone")}, please look at <strong>this</strong>.</p>`;
	const clean = await sanitizeBodyHtml(body);
	expect(await sanitizeBodyHtml(clean)).toBe(clean);
	expect(extractMentionedUserIds(clean)).toEqual([userId]);
});
