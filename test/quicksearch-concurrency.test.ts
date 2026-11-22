import { sql } from "drizzle-orm";
import { expect, test, vi } from "vitest";

const state = vi.hoisted(() => {
	const calls: string[] = [];
	const deferred = () => {
		let resolve!: () => void;
		const promise = new Promise<void>((done) => {
			resolve = done;
		});
		return { promise, resolve };
	};
	return {
		calls,
		visible: deferred(),
		agent: deferred(),
		issue: deferred(),
		project: deferred(),
		pages: deferred(),
	};
});

vi.mock("../src/lib/server/permissions.ts", () => ({
	viewerProjectIds: vi.fn(async () => {
		state.calls.push("visible:start");
		await state.visible.promise;
		state.calls.push("visible:end");
		return [];
	}),
}));

vi.mock("../src/lib/server/servicedesk/access.ts", () => ({
	agentProjectIds: vi.fn(async () => {
		state.calls.push("agent:start");
		await state.agent.promise;
		state.calls.push("agent:end");
		return [];
	}),
	readableCommentCondition: vi.fn(() => sql`true`),
}));

vi.mock("../src/lib/server/avatars.ts", () => ({
	projectAvatarSql: vi.fn(
		() => sql`'/api/avatars/projects/' || projects.id::text`,
	),
}));

vi.mock("../src/lib/server/search-pages.ts", () => ({
	searchPages: vi.fn(async () => {
		state.calls.push("pages:start");
		await state.pages.promise;
		state.calls.push("pages:end");
		return { total: 0, pages: [] };
	}),
}));

vi.mock("../src/lib/server/db.ts", () => {
	let calls = 0;
	return {
		db: {
			execute: vi.fn(async () => {
				calls += 1;
				const name = calls === 1 ? "issue" : "project";
				state.calls.push(`${name}:start`);
				await state[name].promise;
				state.calls.push(`${name}:end`);
				return { rows: [] };
			}),
		},
	};
});

const { quickSearch } = await import("../src/lib/server/quicksearch.ts");

const user = {
	id: "00000000-0000-4000-8000-000000000001",
	username: "quick-user",
	displayName: "Quick User",
	email: null,
	avatarUrl: null,
	groups: [],
	isAdmin: false,
	mustChangePassword: false,
	hasPassword: true,
};

function tick() {
	return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

test("quick search starts its independent lookups together", async () => {
	const pending = quickSearch(user, "x");
	try {
		await tick();
		expect(state.calls).toContain("visible:start");
		expect(state.calls).toContain("agent:start");

		state.visible.resolve();
		state.agent.resolve();
		await tick();
		expect(state.calls).toContain("issue:start");
		expect(state.calls).toContain("project:start");
		expect(state.calls).toContain("pages:start");
	} finally {
		state.visible.resolve();
		state.agent.resolve();
		state.issue.resolve();
		state.project.resolve();
		state.pages.resolve();
	}
	await expect(pending).resolves.toEqual({
		issues: [],
		projects: [],
		pages: [],
	});
});
