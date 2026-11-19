import { expect, test } from "./fixtures.ts";

const link = '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />';

test("the tab icon answers without a session and both front ends link it", async ({
	request,
}) => {
	const icon = await request.get("/favicon.svg", { maxRedirects: 0 });
	expect(icon.status()).toBe(200);
	expect(icon.headers()["content-type"]).toContain("image/svg+xml");
	expect(await icon.text()).toContain("<svg");

	// The sign-in page, before any sign-in.
	expect(await (await request.get("/login.jsp")).text()).toContain(link);

	// A signed-in page, after the dev sign-in.
	await request.get("/auth/login?returnTo=/secure/ViewProfile.jspa");
	expect(
		await (await request.get("/secure/ViewProfile.jspa")).text(),
	).toContain(link);
});
