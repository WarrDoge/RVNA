import { beforeEach, expect, test } from "vitest";
import { recentBoards, rememberBoard } from "../src/lib/recent-boards.ts";
import { recentProjects, rememberProject } from "../src/lib/recent-projects.ts";

const alice = "00000000-0000-4000-8000-00000000000a";
const bob = "00000000-0000-4000-8000-00000000000b";

function installStorage() {
	const values = new Map<string, string>();
	const localStorage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key),
	};
	Object.defineProperty(globalThis, "window", {
		value: { localStorage },
		configurable: true,
	});
	return values;
}

beforeEach(() => {
	installStorage();
});

test("recent projects are stored per user", () => {
	rememberProject(alice, {
		key: "ALICE",
		name: "Alice project",
		avatarUrl: null,
	});
	expect(recentProjects(alice)).toEqual([
		{ key: "ALICE", name: "Alice project", avatarUrl: null },
	]);
	expect(recentProjects(bob)).toEqual([]);
});

test("recent boards are stored per user", () => {
	rememberBoard(alice, {
		rapidViewId: 1,
		name: "Alice board",
		type: "scrum",
		projectKey: "ALICE",
	});
	expect(recentBoards(alice)).toEqual([
		{
			rapidViewId: 1,
			name: "Alice board",
			type: "scrum",
			projectKey: "ALICE",
		},
	]);
	expect(recentBoards(bob)).toEqual([]);
});
