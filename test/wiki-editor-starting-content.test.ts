import { describe, expect, test } from "vitest";
import type {
	DraftInfo,
	EditorContext,
	WikiDoc,
} from "../src/lib/shared/wiki/index.ts";
import type {
	LocalDraft,
	ResumeOffer,
} from "../src/lib/wiki/editor/helpers.ts";
import { startingContent } from "../src/lib/wiki/editor/starting-content.ts";

const doc = (text: string): WikiDoc => ({
	type: "doc",
	content: [
		{
			type: "paragraph",
			content: [{ type: "text", text }],
		},
	],
});

function context(overrides: Partial<EditorContext> = {}): EditorContext {
	return {
		page: {
			id: "page-1",
			spaceKey: "AAA",
			title: "Published",
			parentId: null,
			status: "current",
			version: 4,
			bodyDoc: doc("published"),
			spaceName: "Space A",
			updated: "2026-11-11T10:00:00.000Z",
			lastModifier: null,
		},
		breadcrumb: [],
		labels: ["page-label"],
		draft: null,
		lock: null,
		permissions: { canEdit: true, canRestrict: true, canDelete: true },
		attachments: [],
		...overrides,
	};
}

const serverDraft = (updatedAt: string): DraftInfo => ({
	id: "draft-1",
	pageId: "page-1",
	spaceKey: "AAA",
	parentId: null,
	title: "Server draft",
	bodyDoc: doc("server"),
	labels: ["server-label"],
	baseVersion: 3,
	updatedAt,
});

const localDraft = (savedAt: string): LocalDraft => ({
	title: "Browser draft",
	bodyDoc: doc("browser"),
	labels: ["browser-label"],
	baseVersion: 3,
	savedAt,
});

describe("starting content", () => {
	test("resume mode opens the newer browser copy when the server draft is older", () => {
		const draft = serverDraft("2026-11-11T11:00:00.000Z");
		const local = localDraft("2026-11-11T12:00:00.000Z");
		const start = startingContent(context({ draft }), "resume", local);
		expect(start.source).toBe("browser");
		expect(start.content).toMatchObject({
			title: "Browser draft",
			labels: ["browser-label"],
			baseVersion: 3,
		});
		expect(start.content.doc).toEqual(doc("browser"));
	});

	test("resume mode keeps the server draft when it is newer than the browser copy", () => {
		const draft = serverDraft("2026-11-11T12:00:00.000Z");
		const local = localDraft("2026-11-11T11:00:00.000Z");
		const start = startingContent(context({ draft }), "resume", local);
		expect(start.source).toBe("server");
		expect(start.content).toMatchObject({
			title: "Server draft",
			labels: ["server-label"],
			baseVersion: 3,
		});
		expect(start.content.doc).toEqual(doc("server"));
	});

	test("edit mode still offers a newer draft instead of opening it", () => {
		const draft = serverDraft("2026-11-11T11:00:00.000Z");
		const local = localDraft("2026-11-11T12:00:00.000Z");
		const start = startingContent(context({ draft }), "edit", local);
		expect(start.content.title).toBe("Published");
		expect(start.offer).toMatchObject<Partial<ResumeOffer>>({
			source: "browser",
			title: "Browser draft",
		});
	});
});
