import { expect, test, vi } from "vitest";

const userForSession = vi.hoisted(() => vi.fn());

vi.mock("../src/lib/server/auth.ts", async (original) => ({
	...(await original<typeof import("../src/lib/server/auth.ts")>()),
	userForSession,
}));
vi.mock("../src/lib/server/runtime.ts", () => ({
	start: vi.fn(),
	stop: vi.fn(),
}));

import { sessionHandle as handle } from "../src/hooks.server.ts";

const mustChange = { mustChangePassword: true };

/** Runs `handle` on a request that no route answers, the way SvelteKit sees it. */
async function unmatchedGet(path: string) {
	userForSession.mockClear();
	userForSession.mockResolvedValue(mustChange);
	const resolve = vi.fn(async () => new Response("ok"));
	const event = {
		route: { id: null },
		url: new URL(path, "http://localhost"),
		request: new Request(new URL(path, "http://localhost")),
		cookies: { get: () => "session" },
		locals: {},
	};
	try {
		const response = await handle({ event, resolve } as never);
		return {
			status: response.status,
			resolved: resolve.mock.calls.length,
			lookups: userForSession.mock.calls.length,
		};
	} catch (thrown) {
		const { status, location } = thrown as { status: number; location: string };
		return { status, location, lookups: userForSession.mock.calls.length };
	}
}

test("an unknown data path answers 404 JSON without a session lookup", async () => {
	for (const path of [
		"/api/no-such-route",
		"/rest/no-such-route",
		"/%61pi/x",
	]) {
		expect(await unmatchedGet(path)).toEqual({
			status: 404,
			resolved: 0,
			lookups: 0,
		});
	}
});

test("an unknown page of a user who must change the password still redirects", async () => {
	expect(await unmatchedGet("/secure/NoSuchPage.jspa")).toEqual({
		status: 302,
		location: "/secure/ViewProfile.jspa?selectedTab=password",
		lookups: 1,
	});
});
