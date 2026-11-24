import { expect, test, vi } from "vitest";

const appUrl = vi.hoisted(() => ({ value: "http://localhost:3000" }));

vi.mock("../src/lib/server/env.ts", async (original) => {
	const real = await original<typeof import("../src/lib/server/env.ts")>();
	return {
		...real,
		env: new Proxy(real.env, {
			get: (target, property) =>
				property === "APP_URL" ? appUrl.value : Reflect.get(target, property),
		}),
	};
});
vi.mock("../src/lib/server/runtime.ts", () => ({
	start: vi.fn(),
	stop: vi.fn(),
}));

import { securityHeadersHandle } from "../src/hooks.server.ts";
import { sessionCookieOptions } from "../src/lib/server/auth.ts";

const HSTS = "max-age=31536000; includeSubDomains";

function respond(resolve: () => Response | Promise<Response>) {
	return securityHeadersHandle({
		event: { locals: { user: null } },
		resolve,
	} as never);
}

test("every response carries HSTS when APP_URL is https", async () => {
	appUrl.value = "https://tracker.example.com";
	const page = await respond(() => new Response("ok"));
	const json = await respond(() =>
		Response.json({ error: "Not found" }, { status: 404 }),
	);
	const redirect = await respond(() =>
		Response.redirect("https://tracker.example.com/login.jsp", 302),
	);
	for (const response of [page, json, redirect]) {
		expect(response.headers.get("strict-transport-security")).toBe(HSTS);
	}
});

test("a plain http APP_URL sends no HSTS", async () => {
	appUrl.value = "http://localhost:3000";
	const response = await respond(() => new Response("ok"));
	expect(response.headers.get("strict-transport-security")).toBeNull();
});

test("the session cookie is Secure exactly when APP_URL is https", () => {
	appUrl.value = "https://tracker.example.com";
	expect(sessionCookieOptions().secure).toBe(true);
	appUrl.value = "http://localhost:3000";
	expect(sessionCookieOptions().secure).toBe(false);
});
