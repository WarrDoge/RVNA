import { expect, test } from "./fixtures.ts";

const png = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	Buffer.from("uploads-e2e"),
]);

test("the API keeps uploads, downloads, limits and URL shapes", async ({
	request,
}) => {
	const login = await request.get("/auth/login?returnTo=/");
	expect(login.status()).toBe(200);

	const large = JSON.stringify({ padding: "x".repeat(1024 * 1024) });
	const webhook = await request.post("/api/integrations/gitlab/webhook", {
		headers: { "content-type": "application/json" },
		data: large,
	});
	expect(webhook.status()).toBe(401);

	const created = await request.post("/api/me/tokens", {
		headers: { "x-requested-with": "rvna" },
		data: { name: "upload token" },
	});
	expect(created.status()).toBe(201);
	const { token } = await created.json();

	// A token-authenticated multipart upload has no Origin header; the server must accept it.
	const upload = await request.post("/api/users/dev/avatar", {
		headers: { authorization: `Bearer ${token}` },
		multipart: {
			file: { name: "avatar.png", mimeType: "image/png", buffer: png },
		},
	});
	expect(upload.status()).toBe(200);
	const { avatarUrl } = await upload.json();
	expect(avatarUrl).toMatch(/^\/api\/avatars\/users\/[0-9a-f-]+\?v=/);

	const avatar = await request.get(avatarUrl, {
		headers: { authorization: `Bearer ${token}` },
	});
	expect(avatar.status()).toBe(200);
	expect(avatar.headers()["content-type"]).toContain("image/png");
	expect(Buffer.from(await avatar.body())).toEqual(png);

	const head = await request.head("/api/health");
	expect(head.status()).toBe(200);
	expect(await head.text()).toBe("");

	const options = await request.fetch("/api/health", { method: "OPTIONS" });
	expect(options.status()).toBe(405);

	const trailing = await request.get("/api/health/", { maxRedirects: 0 });
	expect(trailing.status()).toBe(308);
	expect(trailing.headers().location).toBe("../health");

	const redirect = await request.get("/browse/DEMO", { maxRedirects: 0 });
	expect(redirect.status()).toBe(302);
	expect(redirect.headers().location).toBe("/projects/DEMO/summary");
});
