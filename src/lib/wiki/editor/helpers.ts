// Pure helpers of the editor screens: no framework, no DOM, so vitest can run them in node.
import type {
	DraftInfo,
	EditorSpace,
	PageRestrictions,
	PageRestrictionsInput,
	RestrictionSubjects,
	SaveDraftInput,
	WikiDoc,
	WikiUserRef,
} from "../../../lib/shared/wiki/index.ts";

// ---- space keys and labels

const cyrillic: Record<string, string> = {
	а: "a",
	б: "b",
	в: "v",
	г: "h",
	ґ: "g",
	д: "d",
	е: "e",
	є: "ye",
	ж: "zh",
	з: "z",
	и: "y",
	і: "i",
	ї: "yi",
	й: "y",
	к: "k",
	л: "l",
	м: "m",
	н: "n",
	о: "o",
	п: "p",
	р: "r",
	с: "s",
	т: "t",
	у: "u",
	ф: "f",
	х: "kh",
	ц: "ts",
	ч: "ch",
	ш: "sh",
	щ: "shch",
	ь: "",
	ю: "yu",
	я: "ya",
	ы: "y",
	э: "e",
	ъ: "",
};

const latinize = (text: string) =>
	[...text.toLowerCase()]
		.map((char) => cyrillic[char] ?? char)
		.join("")
		.normalize("NFKD")
		.replace(/\p{M}/gu, "");

export function suggestSpaceKey(name: string): string {
	const words = latinize(name).match(/[a-z0-9]+/g) ?? [];
	const key =
		words.length > 1
			? words
					.slice(0, 6)
					.map((word) => word[0])
					.join("")
			: (words[0] ?? "").slice(0, 10);
	return key.toUpperCase();
}

export function isValidSpaceKey(key: string): boolean {
	return /^[A-Za-z0-9]{2,255}$/.test(key);
}

export function normalizeLabel(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[,;:?&()!@#$%^*[\]{}<>|\\/"'`~=+.]/g, "")
		.slice(0, 255);
}

/** Labels typed into a field, separated by commas or spaces. */
export function parseLabels(text: string): string[] {
	return [
		...new Set(
			text
				.split(/[\s,]+/)
				.map(normalizeLabel)
				.filter((label) => label !== ""),
		),
	];
}

// ---- page tree for the location picker

export type TreeNode = {
	id: string;
	title: string;
	parentId: string | null;
	position: number;
};

export type TreeRow = {
	node: TreeNode;
	depth: number;
	hasChildren: boolean;
	expanded: boolean;
};

const byPosition = (a: TreeNode, b: TreeNode) =>
	a.position - b.position || a.title.localeCompare(b.title);

export function childrenIndex(
	nodes: TreeNode[],
): Map<string | null, TreeNode[]> {
	const ids = new Set(nodes.map((node) => node.id));
	const index = new Map<string | null, TreeNode[]>();
	for (const node of nodes) {
		// a parent outside the list (restricted or trashed) makes the node a root
		const key =
			node.parentId !== null && ids.has(node.parentId) ? node.parentId : null;
		const list = index.get(key);
		if (list) list.push(node);
		else index.set(key, [node]);
	}
	for (const list of index.values()) list.sort(byPosition);
	return index;
}

/** The rows of the tree that are visible when only `expanded` nodes show their children. */
export function visibleRows(
	nodes: TreeNode[],
	expanded: ReadonlySet<string>,
): TreeRow[] {
	const index = childrenIndex(nodes);
	const rows: TreeRow[] = [];
	const walk = (parent: string | null, depth: number) => {
		for (const node of index.get(parent) ?? []) {
			const hasChildren = (index.get(node.id)?.length ?? 0) > 0;
			const open = hasChildren && expanded.has(node.id);
			rows.push({ node, depth, hasChildren, expanded: open });
			if (open) walk(node.id, depth + 1);
		}
	};
	walk(null, 0);
	return rows;
}

/** `id` and all its descendants. */
export function descendantIds(nodes: TreeNode[], id: string): Set<string> {
	const index = childrenIndex(nodes);
	const found = new Set<string>([id]);
	const stack = [id];
	while (stack.length > 0) {
		for (const child of index.get(stack.pop() as string) ?? []) {
			if (!found.has(child.id)) {
				found.add(child.id);
				stack.push(child.id);
			}
		}
	}
	return found;
}

/** Ancestors from the root down to and including `id`; empty for an unknown id. */
export function pathTo(nodes: TreeNode[], id: string | null): TreeNode[] {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const path: TreeNode[] = [];
	for (
		let node = id === null ? undefined : byId.get(id);
		node && !path.includes(node);
		node = node.parentId === null ? undefined : byId.get(node.parentId)
	) {
		path.unshift(node);
	}
	return path;
}

/** Ids of the ancestors of `id`, to expand the tree down to a selected page. */
export function ancestorIds(nodes: TreeNode[], id: string | null): string[] {
	return pathTo(nodes, id)
		.slice(0, -1)
		.map((node) => node.id);
}

export type TreeMatch = { node: TreeNode; path: string };

export function searchNodes(
	nodes: TreeNode[],
	query: string,
	limit = 30,
): TreeMatch[] {
	const needle = query.trim().toLowerCase();
	if (needle === "") return [];
	const matches: TreeMatch[] = [];
	for (const node of nodes) {
		if (!node.title.toLowerCase().includes(needle)) continue;
		const path = pathTo(nodes, node.parentId)
			.map((ancestor) => ancestor.title)
			.join(" / ");
		matches.push({ node, path });
		if (matches.length >= limit) break;
	}
	return matches;
}

export type PositionChoice = "first" | "last" | "after";

/**
 * Index of the moved page among its new siblings. `siblings` are the children of the new
 * parent in order; the moved page itself is ignored when it is among them.
 */
export function insertionIndex(
	siblings: TreeNode[],
	movingId: string,
	choice: PositionChoice,
	afterId: string | null,
): number {
	const others = siblings.filter((node) => node.id !== movingId);
	if (choice === "first") return 0;
	if (choice === "after" && afterId !== null) {
		const at = others.findIndex((node) => node.id === afterId);
		if (at >= 0) return at + 1;
	}
	return others.length;
}

// ---- restrictions

export type RestrictionMode = "none" | "edit" | "view";

export type RestrictionEntry =
	| { kind: "user"; user: WikiUserRef; canEdit: boolean }
	| { kind: "group"; name: string; canEdit: boolean };

const isEmpty = (subjects: RestrictionSubjects) =>
	subjects.users.length === 0 && subjects.groups.length === 0;

export function restrictionMode(
	restrictions: PageRestrictions,
): RestrictionMode {
	if (!isEmpty(restrictions.read)) return "view";
	if (!isEmpty(restrictions.update)) return "edit";
	return "none";
}

export function restrictionEntries(
	restrictions: PageRestrictions,
): RestrictionEntry[] {
	const entries = new Map<string, RestrictionEntry>();
	const add = (subjects: RestrictionSubjects, canEdit: boolean) => {
		for (const user of subjects.users) {
			const key = `u:${user.id}`;
			entries.set(key, {
				kind: "user",
				user,
				canEdit: canEdit || (entries.get(key)?.canEdit ?? false),
			});
		}
		for (const name of subjects.groups) {
			const key = `g:${name}`;
			entries.set(key, {
				kind: "group",
				name,
				canEdit: canEdit || (entries.get(key)?.canEdit ?? false),
			});
		}
	};
	add(restrictions.read, false);
	add(restrictions.update, true);
	return [...entries.values()];
}

export function restrictionInput(
	mode: RestrictionMode,
	entries: RestrictionEntry[],
): PageRestrictionsInput {
	if (mode === "none") {
		return {
			read: { userIds: [], groups: [] },
			update: { userIds: [], groups: [] },
		};
	}
	// in "edit" mode everyone listed may edit; in "view" mode each entry carries its own right
	const pick = (all: boolean) => {
		const chosen = entries.filter((entry) => all || entry.canEdit);
		return {
			userIds: chosen.flatMap((entry) =>
				entry.kind === "user" ? [entry.user.id] : [],
			),
			groups: chosen.flatMap((entry) =>
				entry.kind === "group" ? [entry.name] : [],
			),
		};
	};
	return {
		read: mode === "view" ? pick(true) : { userIds: [], groups: [] },
		update: pick(mode === "edit"),
	};
}

// ---- drafts

export type LocalDraft = {
	title: string;
	bodyDoc: WikiDoc;
	labels: string[];
	baseVersion: number | null;
	savedAt: string;
};

export type KeyValueStorage = Pick<
	Storage,
	"getItem" | "setItem" | "removeItem"
>;

const localDraftKey = (pageId: string) => `rvna.wiki.draft.${pageId}`;

export function writeLocalDraft(
	storage: KeyValueStorage,
	pageId: string,
	draft: SaveDraftInput,
	now = new Date(),
): void {
	try {
		const stored: LocalDraft = {
			title: draft.title,
			bodyDoc: draft.bodyDoc,
			labels: draft.labels ?? [],
			baseVersion: draft.baseVersion ?? null,
			savedAt: now.toISOString(),
		};
		storage.setItem(localDraftKey(pageId), JSON.stringify(stored));
	} catch {
		// storage full or disabled: the server draft is the only copy
	}
}

export function readLocalDraft(
	storage: KeyValueStorage,
	pageId: string,
): LocalDraft | null {
	try {
		const raw = storage.getItem(localDraftKey(pageId));
		if (raw === null) return null;
		const value = JSON.parse(raw) as Partial<LocalDraft>;
		if (
			typeof value.title !== "string" ||
			typeof value.savedAt !== "string" ||
			value.bodyDoc?.type !== "doc"
		) {
			return null;
		}
		return {
			title: value.title,
			bodyDoc: value.bodyDoc,
			labels: Array.isArray(value.labels) ? value.labels : [],
			baseVersion:
				typeof value.baseVersion === "number" ? value.baseVersion : null,
			savedAt: value.savedAt,
		};
	} catch {
		return null;
	}
}

export function clearLocalDraft(
	storage: KeyValueStorage,
	pageId: string,
): void {
	try {
		storage.removeItem(localDraftKey(pageId));
	} catch {
		// nothing to clear
	}
}

export type ResumeOffer = {
	title: string;
	bodyDoc: WikiDoc;
	labels: string[];
	baseVersion: number | null;
	savedAt: string;
	source: "server" | "browser";
};

/**
 * The draft to offer with "Resume editing": the newest of the server draft and the copy kept
 * in this browser, provided it is newer than the published page.
 */
export function chooseResume(
	serverDraft: DraftInfo | null,
	local: LocalDraft | null,
	pageUpdated: string | null,
): ResumeOffer | null {
	const floor = pageUpdated === null ? 0 : Date.parse(pageUpdated);
	const offers: ResumeOffer[] = [];
	if (serverDraft?.bodyDoc) {
		offers.push({
			title: serverDraft.title,
			bodyDoc: serverDraft.bodyDoc,
			labels: serverDraft.labels,
			baseVersion: serverDraft.baseVersion,
			savedAt: serverDraft.updatedAt,
			source: "server",
		});
	}
	if (local) offers.push({ ...local, source: "browser" });
	const newer = offers.filter((offer) => Date.parse(offer.savedAt) > floor);
	newer.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
	return newer[0] ?? null;
}

export function formatClock(date: Date): string {
	const two = (value: number) => String(value).padStart(2, "0");
	return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

// ---- location picker

export type Location = { spaceKey: string; parentId: string | null };

export type ChosenLocation = Location & {
	spaceName: string;
	path: { id: string; title: string }[];
};

/** The spaces a location picker offers; the current space stays visible unless create is required. */
export function locationSpaceOptions(
	spaces: EditorSpace[],
	currentSpaceKey: string,
	requireCreate = false,
): EditorSpace[] {
	return spaces.filter(
		(space) =>
			space.canCreate || (!requireCreate && space.key === currentSpaceKey),
	);
}

/** An unpublished page and its attachments stay in the space that holds the draft row. */
export function newPageLocationSpaces(
	spaces: EditorSpace[],
	spaceKey: string,
): EditorSpace[] {
	return spaces.filter((space) => space.key === spaceKey);
}

/** `YYYY-MM-DD` in the browser's own timezone, the value `<input type="date">` expects. */
export function localDateValue(date: Date): string {
	const two = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}
