import { describe, expect, it } from "vitest";
import { macroCatalog } from "../src/lib/editor/wiki/macros.ts";
import {
	filterEmoji,
	filterInsertItems,
	insertItems,
} from "../src/lib/wiki/editor/insert-items.ts";
import {
	normalizeUrl,
	pageLinkAttrs,
} from "../src/lib/wiki/editor/link-attrs.ts";
import { matchTrigger } from "../src/lib/wiki/editor/triggers.ts";
import {
	attachmentContent,
	isImageAttachment,
	pastedFileName,
	pastedFilesToUpload,
} from "../src/lib/wiki/editor/upload.ts";

describe("matchTrigger", () => {
	it("opens the mention popup after @ at a word start", () => {
		expect(matchTrigger("hello @")).toEqual({
			kind: "mention",
			query: "",
			length: 1,
		});
		expect(matchTrigger("@ann")).toEqual({
			kind: "mention",
			query: "ann",
			length: 4,
		});
		expect(matchTrigger("mail me@example.com")).toBeNull();
	});

	it("opens the slash menu at a word start only", () => {
		expect(matchTrigger("/")).toEqual({ kind: "slash", query: "", length: 1 });
		expect(matchTrigger("text /inf")).toEqual({
			kind: "slash",
			query: "inf",
			length: 4,
		});
		expect(matchTrigger("http://example.com/path")).toBeNull();
		expect(matchTrigger("and/or")).toBeNull();
	});

	it("opens the emoji suggestion after a colon and two characters", () => {
		expect(matchTrigger(":s")).toBeNull();
		expect(matchTrigger(":sm")).toEqual({
			kind: "emoji",
			query: "sm",
			length: 3,
		});
		expect(matchTrigger("see :thumbs_up")).toEqual({
			kind: "emoji",
			query: "thumbs_up",
			length: 10,
		});
		expect(matchTrigger("12:30")).toBeNull();
	});

	it("does nothing for plain text or a finished word", () => {
		expect(matchTrigger("plain text")).toBeNull();
		expect(matchTrigger("@ann ")).toBeNull();
		expect(matchTrigger("")).toBeNull();
	});
});

describe("insert menu items", () => {
	it("has unique ids and every macro of the catalog", () => {
		const ids = insertItems.map((item) => item.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const def of macroCatalog) expect(ids).toContain(`macro:${def.name}`);
		expect(ids).toEqual(
			expect.arrayContaining([
				"image",
				"file",
				"link",
				"table",
				"hr",
				"task-list",
				"date",
				"emoji",
				"mention",
				"layout-2",
				"layout-3",
				"macros",
			]),
		);
	});

	it("filters by label and keyword and puts prefix matches first", () => {
		expect(filterInsertItems("")).toBe(insertItems);
		expect(filterInsertItems("info")[0].id).toBe("macro:info");
		expect(filterInsertItems("todo").map((item) => item.id)).toContain(
			"task-list",
		);
		expect(filterInsertItems("zzzz")).toEqual([]);
	});

	it("finds emoji by name with underscores", () => {
		expect(filterEmoji("smile")[0].name).toBe("smile");
		expect(filterEmoji("thumbs_up").map((choice) => choice.name)).toContain(
			"thumbs-up".replace("-", " "),
		);
		expect(filterEmoji("zzzz")).toEqual([]);
		expect(filterEmoji("party")[0].attrs.emojiFallback).toBe("🎉");
	});
});

describe("links", () => {
	it("normalises addresses", () => {
		expect(normalizeUrl(" example.com/a ")).toBe("https://example.com/a");
		expect(normalizeUrl("http://x.test")).toBe("http://x.test");
		expect(normalizeUrl("/pages/viewpage.action?pageId=1")).toBe(
			"/pages/viewpage.action?pageId=1",
		);
		expect(normalizeUrl("me@example.com")).toBe("mailto:me@example.com");
		expect(normalizeUrl("  ")).toBe("");
	});

	it("builds page link attrs", () => {
		expect(
			pageLinkAttrs({ id: "42", spaceKey: "DOC", title: "Guide" }),
		).toEqual({
			href: "/pages/viewpage.action?pageId=42",
			ref: {
				tag: "ri:page",
				attrs: { "ri:content-title": "Guide", "ri:space-key": "DOC" },
			},
		});
	});
});

describe("uploads", () => {
	const file = (name: string, type: string) => new File(["x"], name, { type });

	it("turns images into image nodes and other files into attachment links", () => {
		const image = {
			id: "1",
			fileName: "a.png",
			mimeType: "image/png",
			size: 1,
			url: "/a.png",
		};
		expect(attachmentContent(image)).toEqual([
			{
				type: "image",
				attrs: { fileName: "a.png", src: "/a.png", alt: "a.png" },
			},
		]);
		const pdf = {
			id: "2",
			fileName: "b.pdf",
			mimeType: "application/pdf",
			size: 1,
			url: "/b.pdf",
		};
		const [link] = attachmentContent(pdf);
		expect(link.text).toBe("b.pdf");
		expect(link.marks?.[0].attrs).toMatchObject({
			href: "/b.pdf",
			ref: { tag: "ri:attachment", attrs: { "ri:filename": "b.pdf" } },
		});
		expect(isImageAttachment({ mimeType: null, fileName: "photo.JPG" })).toBe(
			true,
		);
		expect(isImageAttachment({ mimeType: null, fileName: "notes.txt" })).toBe(
			false,
		);
	});

	it("uploads pasted pictures but not the picture of a rich-text copy", () => {
		const png = file("image.png", "image/png");
		expect(pastedFilesToUpload([png], "")).toEqual([png]);
		expect(
			pastedFilesToUpload([png], '<img src="data:image/png;base64,AAA">'),
		).toEqual([png]);
		expect(pastedFilesToUpload([png], "<p>some <b>text</b></p>")).toEqual([]);
		const pdf = file("a.pdf", "application/pdf");
		expect(pastedFilesToUpload([pdf], "<p>text</p>")).toEqual([pdf]);
		expect(pastedFilesToUpload([], "<p>x</p>")).toEqual([]);
	});

	it("names pasted pictures uniquely", () => {
		const now = new Date("2026-11-11T21:09:01Z");
		expect(pastedFileName("image.png", "image/png", now)).toBe(
			"pasted-20261111-210901.png",
		);
		expect(pastedFileName("report.pdf", "application/pdf", now)).toBe(
			"report.pdf",
		);
	});
});
