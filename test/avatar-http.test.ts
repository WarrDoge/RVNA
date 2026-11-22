import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { avatarResponse } from "../src/lib/server/avatar-http.ts";

test("a stored file that cannot be opened is a 404, not a broken 200", async () => {
	const response = await avatarResponse({
		kind: "stored",
		path: join(process.env.AVATARS_DIR as string, "missing-avatar.png"),
		contentType: "image/png",
		svg: false,
	});
	expect(response.status).toBe(404);
});

test("a stored file streams with its content type", async () => {
	const directory = process.env.AVATARS_DIR as string;
	await mkdir(directory, { recursive: true });
	const path = join(directory, "avatar-http-test.png");
	const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	await writeFile(path, bytes);

	const response = await avatarResponse({
		kind: "stored",
		path,
		contentType: "image/png",
		svg: false,
	});
	expect(response.status).toBe(200);
	expect(response.headers.get("content-type")).toBe("image/png");
	expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
});
