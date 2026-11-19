import { describe, expect, test } from "vitest";
import type {
	DraftInfo,
	EditorSpace,
	PageRestrictions,
	WikiDoc,
	WikiUserRef,
} from "../src/lib/shared/wiki/index.ts";
import {
	ancestorIds,
	chooseResume,
	clearLocalDraft,
	descendantIds,
	formatClock,
	insertionIndex,
	isValidSpaceKey,
	type KeyValueStorage,
	localDateValue,
	locationSpaceOptions,
	newPageLocationSpaces,
	normalizeLabel,
	parseLabels,
	pathTo,
	readLocalDraft,
	restrictionEntries,
	restrictionInput,
	restrictionMode,
	searchNodes,
	suggestSpaceKey,
	type TreeNode,
	visibleRows,
	writeLocalDraft,
} from "../src/lib/wiki/editor/helpers.ts";

const node = (
	id: string,
	parentId: string | null,
	position: number,
	title = id,
): TreeNode => ({
	id,
	title,
	parentId,
	position,
});

// a (b (d, e), c), f
const tree = [
	node("f", null, 1),
	node("a", null, 0),
	node("c", "a", 1),
	node("e", "b", 1),
	node("b", "a", 0),
	node("d", "b", 0),
];

const doc: WikiDoc = { type: "doc", content: [{ type: "paragraph" }] };
const user = (id: string): WikiUserRef => ({
	id,
	username: id,
	displayName: id,
	avatarUrl: null,
});

function memoryStorage(): KeyValueStorage & { items: Map<string, string> } {
	const items = new Map<string, string>();
	return {
		items,
		getItem: (key) => items.get(key) ?? null,
		setItem: (key, value) => void items.set(key, value),
		removeItem: (key) => void items.delete(key),
	};
}

describe("space keys and labels", () => {
	test("suggests a key from the space name", () => {
		expect(suggestSpaceKey("Photo Library Guide")).toBe("PLG");
		expect(suggestSpaceKey("Travel 3.5")).toBe("T35");
		expect(suggestSpaceKey("Infra")).toBe("INFRA");
		expect(suggestSpaceKey("Дослідження")).toBe("DOSLIDZHEN");
		expect(suggestSpaceKey("Фото звіт")).toBe("FZ");
		expect(suggestSpaceKey("Ünïcode")).toBe("UNICODE");
		expect(suggestSpaceKey("  ")).toBe("");
		expect(
			suggestSpaceKey("a very long name with many many words"),
		).toHaveLength(6);
	});

	test("validates keys like the server", () => {
		expect(isValidSpaceKey("T35")).toBe(true);
		expect(isValidSpaceKey("A")).toBe(false);
		expect(isValidSpaceKey("my-space")).toBe(false);
	});

	test("normalises and splits labels", () => {
		expect(normalizeLabel("  Hello World! ")).toBe("hello-world");
		expect(normalizeLabel("a/b,c")).toBe("abc");
		expect(parseLabels("one, Two  three,,one")).toEqual([
			"one",
			"two",
			"three",
		]);
		expect(parseLabels(" , ")).toEqual([]);
	});
});

describe("page tree", () => {
	test("orders siblings by position and shows only expanded children", () => {
		expect(visibleRows(tree, new Set()).map((row) => row.node.id)).toEqual([
			"a",
			"f",
		]);
		const rows = visibleRows(tree, new Set(["a", "b"]));
		expect(rows.map((row) => [row.node.id, row.depth])).toEqual([
			["a", 0],
			["b", 1],
			["d", 2],
			["e", 2],
			["c", 1],
			["f", 0],
		]);
		expect(rows[0]).toMatchObject({ hasChildren: true, expanded: true });
		expect(rows[5]).toMatchObject({ hasChildren: false, expanded: false });
	});

	test("a node whose parent is missing becomes a root", () => {
		const rows = visibleRows(
			[node("x", "gone", 0), node("y", null, 1)],
			new Set(),
		);
		expect(rows.map((row) => row.node.id)).toEqual(["x", "y"]);
	});

	test("finds descendants, paths and ancestors", () => {
		expect([...descendantIds(tree, "a")].sort()).toEqual([
			"a",
			"b",
			"c",
			"d",
			"e",
		]);
		expect([...descendantIds(tree, "f")]).toEqual(["f"]);
		expect(pathTo(tree, "d").map((n) => n.id)).toEqual(["a", "b", "d"]);
		expect(pathTo(tree, null)).toEqual([]);
		expect(pathTo(tree, "nope")).toEqual([]);
		expect(ancestorIds(tree, "d")).toEqual(["a", "b"]);
		expect(ancestorIds(tree, "a")).toEqual([]);
	});

	test("does not loop on a cycle", () => {
		const cyclic = [node("p", "q", 0), node("q", "p", 0)];
		expect(pathTo(cyclic, "p").length).toBeLessThanOrEqual(2);
	});

	test("searches titles with their path", () => {
		const titled = [
			node("a", null, 0, "Alpha"),
			node("b", "a", 0, "Beta plan"),
			node("c", "b", 0, "Gamma"),
		];
		expect(searchNodes(titled, "PLAN")).toEqual([
			{ node: titled[1], path: "Alpha" },
		]);
		expect(searchNodes(titled, "gam")[0]?.path).toBe("Alpha / Beta plan");
		expect(searchNodes(titled, "  ")).toEqual([]);
		expect(searchNodes(titled, "a", 2)).toHaveLength(2);
	});

	test("computes the insertion index among the new siblings", () => {
		const siblings = [
			node("s1", "p", 0),
			node("moving", "p", 1),
			node("s2", "p", 2),
		];
		expect(insertionIndex(siblings, "moving", "first", null)).toBe(0);
		expect(insertionIndex(siblings, "moving", "last", null)).toBe(2);
		expect(insertionIndex(siblings, "moving", "after", "s1")).toBe(1);
		expect(insertionIndex(siblings, "moving", "after", "s2")).toBe(2);
		expect(insertionIndex(siblings, "moving", "after", "unknown")).toBe(2);
		expect(insertionIndex([], "moving", "last", null)).toBe(0);
	});
});

describe("restrictions", () => {
	const none = { users: [], groups: [] };
	const restrictions = (
		read: PageRestrictions["read"],
		update: PageRestrictions["update"],
	): PageRestrictions => ({
		read,
		update,
		inherited: [],
	});

	test("derives the mode from the stored restrictions", () => {
		expect(restrictionMode(restrictions(none, none))).toBe("none");
		expect(
			restrictionMode(restrictions(none, { users: [user("u")], groups: [] })),
		).toBe("edit");
		expect(
			restrictionMode(restrictions({ users: [], groups: ["g"] }, none)),
		).toBe("view");
	});

	test("lists subjects once, with edit rights from the update list", () => {
		const entries = restrictionEntries(
			restrictions(
				{ users: [user("a"), user("b")], groups: ["g"] },
				{ users: [user("a")], groups: [] },
			),
		);
		expect(entries).toEqual([
			{ kind: "user", user: user("a"), canEdit: true },
			{ kind: "user", user: user("b"), canEdit: false },
			{ kind: "group", name: "g", canEdit: false },
		]);
	});

	test("builds the request for each mode", () => {
		const entries = [
			{ kind: "user" as const, user: user("a"), canEdit: true },
			{ kind: "user" as const, user: user("b"), canEdit: false },
			{ kind: "group" as const, name: "g", canEdit: false },
		];
		expect(restrictionInput("none", entries)).toEqual({
			read: { userIds: [], groups: [] },
			update: { userIds: [], groups: [] },
		});
		expect(restrictionInput("edit", entries)).toEqual({
			read: { userIds: [], groups: [] },
			update: { userIds: ["a", "b"], groups: ["g"] },
		});
		expect(restrictionInput("view", entries)).toEqual({
			read: { userIds: ["a", "b"], groups: ["g"] },
			update: { userIds: ["a"], groups: [] },
		});
	});
});

describe("drafts", () => {
	const serverDraft = (updatedAt: string): DraftInfo => ({
		id: "d1",
		pageId: "p1",
		spaceKey: "S",
		parentId: null,
		title: "Server",
		bodyDoc: doc,
		labels: ["x"],
		baseVersion: 3,
		updatedAt,
	});

	test("keeps a browser copy until it is cleared", () => {
		const storage = memoryStorage();
		const savedAt = new Date("2026-11-11T10:00:00Z");
		writeLocalDraft(storage, "p1", { title: "T", bodyDoc: doc }, savedAt);
		expect(readLocalDraft(storage, "p1")).toEqual({
			title: "T",
			bodyDoc: doc,
			labels: [],
			baseVersion: null,
			savedAt: savedAt.toISOString(),
		});
		expect(readLocalDraft(storage, "p2")).toBeNull();
		clearLocalDraft(storage, "p1");
		expect(readLocalDraft(storage, "p1")).toBeNull();
	});

	test("ignores broken stored values and a failing storage", () => {
		const storage = memoryStorage();
		storage.setItem("rvna.wiki.draft.p1", "{not json");
		expect(readLocalDraft(storage, "p1")).toBeNull();
		storage.setItem(
			"rvna.wiki.draft.p1",
			JSON.stringify({ title: "x", savedAt: "2026-01-01T00:00:00Z" }),
		);
		expect(readLocalDraft(storage, "p1")).toBeNull();
		const full: KeyValueStorage = {
			getItem: () => null,
			setItem: () => {
				throw new Error("quota");
			},
			removeItem: () => undefined,
		};
		expect(() =>
			writeLocalDraft(full, "p1", { title: "T", bodyDoc: doc }),
		).not.toThrow();
	});

	test("offers the newest draft that is newer than the page", () => {
		const storage = memoryStorage();
		writeLocalDraft(
			storage,
			"p1",
			{ title: "Browser", bodyDoc: doc },
			new Date("2026-11-11T12:00:00Z"),
		);
		const local = readLocalDraft(storage, "p1");
		const server = serverDraft("2026-11-11T11:00:00.000Z");
		expect(
			chooseResume(server, local, "2026-11-11T10:00:00.000Z"),
		).toMatchObject({
			title: "Browser",
			source: "browser",
		});
		expect(
			chooseResume(server, null, "2026-11-11T10:00:00.000Z"),
		).toMatchObject({
			title: "Server",
			source: "server",
			baseVersion: 3,
		});
		expect(chooseResume(server, local, "2026-11-11T13:00:00.000Z")).toBeNull();
		expect(chooseResume(null, null, null)).toBeNull();
		expect(chooseResume({ ...server, bodyDoc: null }, null, null)).toBeNull();
	});

	test("formats the save time as HH:MM", () => {
		expect(formatClock(new Date(2026, 10, 11, 9, 5))).toBe("09:05");
		expect(formatClock(new Date(2026, 10, 11, 23, 59))).toBe("23:59");
	});
});

describe("location and date values", () => {
	const spaces: EditorSpace[] = [
		{ key: "AAA", name: "A", canCreate: true },
		{ key: "BBB", name: "B", canCreate: false },
	];

	test("keeps the current space unless the caller must be able to create", () => {
		expect(
			locationSpaceOptions(spaces, "BBB").map((space) => space.key),
		).toEqual(["AAA", "BBB"]);
		expect(
			locationSpaceOptions(spaces, "BBB", true).map((space) => space.key),
		).toEqual(["AAA"]);
	});

	test("an unpublished page may only stay in its own space", () => {
		expect(
			newPageLocationSpaces(spaces, "BBB").map((space) => space.key),
		).toEqual(["BBB"]);
	});

	test("the date input defaults to the local day, not the UTC day", () => {
		const original = process.env.TZ;
		try {
			process.env.TZ = "America/New_York";
			const evening = new Date(2026, 0, 1, 23, 30);
			expect(localDateValue(evening)).toBe("2026-01-01");
			expect(evening.toISOString().slice(0, 10)).toBe("2026-01-02");
		} finally {
			if (original === undefined) delete process.env.TZ;
			else process.env.TZ = original;
		}
	});
});
