import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { pool } from "../src/lib/server/db.ts";
import { type Client, setupWiki, type TestSpace } from "./wiki-edit-support.ts";

let wiki: Awaited<ReturnType<typeof setupWiki>>;
let space: TestSpace;
let author: Client;

beforeAll(async () => {
	wiki = await setupWiki();
	space = await wiki.space("S");
	author = await wiki.user("style-author");
	await wiki.grant(space.id, { userId: author.id }, ["read", "create"]);
});

afterAll(async () => {
	await wiki.cleanup();
	await pool.end();
});

const macroDoc = (params: { name: string; value: string }[]) => ({
	type: "doc",
	content: [
		{
			type: "macro",
			attrs: {
				name: "panel",
				params,
				bodyType: "rich",
				body: null,
				macroId: null,
				schemaVersion: null,
			},
			content: [{ type: "paragraph" }],
		},
	],
});

describe("style attributes of a stored document", () => {
	test("refuses a macro colour that would add a declaration", async () => {
		const created = await author.post("/api/wiki/pages", {
			spaceKey: space.key,
			title: "Hostile macro",
			bodyDoc: macroDoc([
				{ name: "bgColor", value: "red; position: fixed; inset: 0" },
			]),
		});
		expect(created.status).toBe(400);
		expect(String(created.body.error)).toContain("macro colour");
	});

	test("refuses a text colour, a list style and a cell background that leave their declaration", async () => {
		const text = await author.post("/api/wiki/pages", {
			spaceKey: space.key,
			title: "Hostile text",
			bodyDoc: {
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{
								type: "text",
								text: "x",
								marks: [
									{
										type: "textStyle",
										attrs: { color: "red; position: fixed" },
									},
								],
							},
						],
					},
				],
			},
		});
		expect(text.status).toBe(400);
		expect(String(text.body.error)).toContain("text colour");

		const list = await author.post("/api/wiki/pages", {
			spaceKey: space.key,
			title: "Hostile list",
			bodyDoc: {
				type: "doc",
				content: [
					{
						type: "orderedList",
						attrs: { listStyle: "decimal; position: fixed" },
						content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
					},
				],
			},
		});
		expect(list.status).toBe(400);
		expect(String(list.body.error)).toContain("list style");

		const cell = await author.post("/api/wiki/pages", {
			spaceKey: space.key,
			title: "Hostile cell",
			bodyDoc: {
				type: "doc",
				content: [
					{
						type: "table",
						content: [
							{
								type: "tableRow",
								content: [
									{
										type: "tableCell",
										attrs: { background: "red; position: fixed" },
										content: [{ type: "paragraph" }],
									},
								],
							},
						],
					},
				],
			},
		});
		expect(cell.status).toBe(400);
		expect(String(cell.body.error)).toContain("cell background");
	});

	test("accepts the values the editor and the converters produce", async () => {
		const created = await author.post("/api/wiki/pages", {
			spaceKey: space.key,
			title: "Styled page",
			bodyDoc: macroDoc([
				{ name: "bgColor", value: "#ff0000" },
				{ name: "borderColor", value: "rgb(0, 0, 0)" },
				{ name: "borderStyle", value: "solid" },
				{ name: "borderWidth", value: "2" },
				{ name: "titleColor", value: "white" },
			]),
		});
		expect(created.status).toBe(201);
	});
});
