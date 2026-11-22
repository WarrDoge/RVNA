import { expect, test } from "vitest";

// A deployment without single sign-on: the legacy sign-in redirect must reach
// the page that shows the local form, not the SSO start endpoint.
delete process.env.OIDC_ISSUER;
delete process.env.OIDC_CLIENT_ID;
delete process.env.OIDC_CLIENT_SECRET;

test("a legacy page without a session goes to the login page", async () => {
	const { legacyResponse } = await import("../src/lib/server/legacy/http.ts");
	const { startLogin } = await import("../src/lib/server/oidc.ts");
	const returnTo = "/secure/QuickSearch.jspa?searchString=DEMO-1";

	const response = await legacyResponse(
		{ url: new URL(`http://127.0.0.1:3000${returnTo}`) } as never,
		{ kind: "login" },
	);
	expect(response.headers.get("location")).toBe(
		`/login.jsp?returnTo=${encodeURIComponent(returnTo)}`,
	);

	await expect(
		startLogin({ returnTo: "/", ip: "127.0.0.1" }),
	).rejects.toMatchObject({ status: 404 });
});
