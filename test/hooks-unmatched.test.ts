import { redirect } from "@sveltejs/kit";
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

import {
	sessionHandle as handle,
	securityHeadersHandle,
} from "../src/hooks.server.ts";

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

test("security headers are added to a response whose headers are read-only", async () => {
	const redirect = Response.redirect("http://localhost/login.jsp", 302);
	const response = await securityHeadersHandle({
		event: { locals: { user: null } },
		resolve: async () => redirect,
	} as never);
	expect(response.status).toBe(302);
	expect(response.headers.get("location")).toBe("http://localhost/login.jsp");
	expect(response.headers.get("x-content-type-options")).toBe("nosniff");
	expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
	expect(response.headers.get("referrer-policy")).toBe("same-origin");
});

test("a redirect thrown by an inner hook still carries the security headers", async () => {
	const response = await securityHeadersHandle({
		event: { locals: { user: null } },
		resolve: async () => {
			redirect(302, "/login.jsp");
		},
	} as never);
	expect(response.status).toBe(302);
	expect(response.headers.get("location")).toBe("/login.jsp");
	expect(response.headers.get("x-content-type-options")).toBe("nosniff");
	expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
	expect(response.headers.get("referrer-policy")).toBe("same-origin");
});

test("a failed session lookup answers a data path with JSON 500", async () => {
	userForSession.mockRejectedValueOnce(new Error("database down"));
	const logged = vi.spyOn(console, "error").mockImplementation(() => {});
	const event = {
		route: { id: "/api/me" },
		url: new URL("http://localhost/api/me"),
		request: new Request("http://localhost/api/me"),
		cookies: { get: () => "session" },
		locals: {},
	};
	const response = await handle({
		event,
		resolve: async () => new Response("ok"),
	} as never);
	logged.mockRestore();
	expect(response.status).toBe(500);
	expect(response.headers.get("content-type")).toContain("application/json");
	expect(await response.json()).toEqual({ error: "Internal server error" });
});

test("a failed session lookup still rethrows for a page route", async () => {
	userForSession.mockRejectedValueOnce(new Error("database down"));
	const event = {
		route: { id: "/dashboard" },
		url: new URL("http://localhost/dashboard"),
		request: new Request("http://localhost/dashboard"),
		cookies: { get: () => "session" },
		locals: {},
	};
	await expect(
		handle({ event, resolve: async () => new Response("ok") } as never),
	).rejects.toThrow("database down");
});
