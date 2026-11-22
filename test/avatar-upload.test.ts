import { randomUUID } from "node:crypto";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { userForSession } from "../src/lib/server/auth.ts";
import { MAX_AVATAR_BYTES, uploadAvatar } from "../src/lib/server/avatars.ts";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { adminGroup, buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = randomUUID().slice(0, 8);
const prefix = `fixture-avatar-route:${run}`;
const png = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	Buffer.from("avatar-route"),
]);
const svg = Buffer.from(
	'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#fff"/></svg>',
);

let app: TestApp;
let client: Client;
let owner: { id: string; username: string; session: string };
let other: { id: string; username: string; session: string };
let admin: { id: string; username: string; session: string };
let issueTypeId: string;
let priorityId: string;
let emptyTypeId: string;
let badTypeId: string;
let storedFile: string | null = null;

async function userSession(username: string, groups: string[] = []) {
	const loggedIn = await login(app, {
		sub: `sub-${username}`,
		username,
		name: username,
		groups,
	});
	const session = loggedIn.sessionId as string;
	const me = await app.inject({
		method: "GET",
		url: "/api/me",
		cookies: { sid: session },
	});
	return {
		id: me.json().id as string,
		username,
		session,
	};
}

function get(url: string, session = owner.session) {
	return app.inject({ method: "GET", url, cookies: { sid: session } });
}

function multipart(
	filename: string,
	contentType: string,
	bytes: Buffer,
	boundary = `----fat-${randomUUID()}`,
) {
	const head = Buffer.from(
		`--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
	);
	const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
	return {
		payload: Buffer.concat([head, bytes, tail]),
		headers: {
			"content-type": `multipart/form-data; boundary=${boundary}`,
		},
	};
}

async function upload(
	username: string,
	session: string,
	filename: string,
	contentType: string,
	bytes: Buffer,
) {
	const body = multipart(filename, contentType, bytes);
	return app.inject({
		method: "POST",
		url: `/api/users/${username}/avatar`,
		cookies: { sid: session },
		headers: { ...body.headers, "x-requested-with": "rvna" },
		payload: body.payload,
	});
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	owner = await userSession(`t-${run}-owner`);
	other = await userSession(`t-${run}-other`);
	admin = await userSession(`t-${run}-admin`, [adminGroup()]);

	const avatarsDir = process.env.AVATARS_DIR as string;
	await mkdir(avatarsDir, { recursive: true });
	await writeFile(join(avatarsDir, `icon-${run}.svg`), svg);
	await writeFile(join(avatarsDir, `icon-${run}.png`), png);
	await writeFile(join(avatarsDir, `bad-${run}.txt`), Buffer.from("text"));

	const types = await client.query<{ id: string }>(
		`insert into issue_types (source_id, name, icon_file)
		 values ($1, 'Icon type', $2), ($3, 'Empty type', null), ($4, 'Bad type', $5)
		 returning id`,
		[
			`${prefix}:type`,
			`icon-${run}.svg`,
			`${prefix}:type:empty`,
			`${prefix}:type:bad`,
			`bad-${run}.txt`,
		],
	);
	issueTypeId = types.rows[0].id;
	emptyTypeId = types.rows[1].id;
	badTypeId = types.rows[2].id;

	const priority = await client.query<{ id: string }>(
		`insert into priorities (source_id, name, sequence, icon_file)
		 values ($1, 'Icon priority', 1, $2) returning id`,
		[`${prefix}:priority`, `icon-${run}.png`],
	);
	priorityId = priority.rows[0].id;
});

afterAll(async () => {
	if (client) {
		await client.query("delete from issue_types where source_id like $1", [
			`${prefix}:%`,
		]);
		await client.query("delete from priorities where source_id like $1", [
			`${prefix}:%`,
		]);
		await client.end();
	}
	if (storedFile) {
		await unlink(join(process.env.AVATARS_DIR as string, storedFile)).catch(
			() => undefined,
		);
	}
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

test("serves issue type and priority icons with fixed headers", async () => {
	const typeIcon = await get(`/api/avatars/issuetypes/${issueTypeId}`);
	expect(typeIcon.statusCode).toBe(200);
	expect(typeIcon.headers["content-type"]).toBe("image/svg+xml");
	expect(typeIcon.headers["content-security-policy"]).toBe("sandbox");
	expect(typeIcon.headers["x-content-type-options"]).toBe("nosniff");
	expect(typeIcon.headers["cache-control"]).toBe("private, max-age=300");
	expect(typeIcon.rawPayload.equals(svg)).toBe(true);

	const priorityIcon = await get(`/api/avatars/priorities/${priorityId}`);
	expect(priorityIcon.statusCode).toBe(200);
	expect(priorityIcon.headers["content-type"]).toBe("image/png");
	expect(priorityIcon.rawPayload.equals(png)).toBe(true);
});

test("missing icons and files are 404", async () => {
	expect(
		(await get("/api/avatars/issuetypes/00000000-0000-4000-8000-000000000000"))
			.statusCode,
	).toBe(404);
	expect((await get(`/api/avatars/issuetypes/${emptyTypeId}`)).statusCode).toBe(
		404,
	);
	expect((await get(`/api/avatars/issuetypes/${badTypeId}`)).statusCode).toBe(
		404,
	);
	expect(
		(await get("/api/avatars/priorities/00000000-0000-4000-8000-000000000000"))
			.statusCode,
	).toBe(404);
});

test("icon routes require a session", async () => {
	const response = await app.inject({
		method: "GET",
		url: `/api/avatars/issuetypes/${issueTypeId}`,
	});
	expect(response.statusCode).toBe(401);
});

test("the owner uploads a PNG and the avatar is served", async () => {
	const response = await upload(
		owner.username,
		owner.session,
		"avatar.png",
		"image/png",
		png,
	);
	expect(response.statusCode).toBe(200);
	const avatarUrl = response.json().avatarUrl as string;
	expect(avatarUrl).toMatch(
		new RegExp(`^/api/avatars/users/${owner.id}\\?v=[0-9a-f]{12}$`),
	);

	const stored = await client.query<{ avatar_file: string }>(
		"select avatar_file from users where id = $1",
		[owner.id],
	);
	storedFile = stored.rows[0].avatar_file;
	expect(storedFile).toMatch(/^[0-9a-f]{64}\.png$/);
	expect(
		(await stat(join(process.env.AVATARS_DIR as string, storedFile))).isFile(),
	).toBe(true);

	const served = await get(`/api/avatars/users/${owner.id}`);
	expect(served.statusCode).toBe(200);
	expect(served.headers["content-type"]).toBe("image/png");
	expect(served.headers["x-content-type-options"]).toBe("nosniff");
	expect(served.rawPayload.equals(png)).toBe(true);
});

test("upload validation rejects wrong magic, SVG and oversize files", async () => {
	const wrongMagic = await upload(
		owner.username,
		owner.session,
		"avatar.png",
		"image/png",
		Buffer.from("not an image"),
	);
	expect(wrongMagic.statusCode).toBe(400);

	const svgUpload = await upload(
		owner.username,
		owner.session,
		"avatar.svg",
		"image/svg+xml",
		svg,
	);
	expect(svgUpload.statusCode).toBe(400);

	const oversized = await upload(
		owner.username,
		owner.session,
		"avatar.png",
		"image/png",
		Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024)]),
	);
	expect(oversized.statusCode).toBe(413);

	const declared = multipart("avatar.png", "image/png", png);
	const declaredTooLarge = await app.inject({
		method: "POST",
		url: `/api/users/${owner.username}/avatar`,
		cookies: { sid: owner.session },
		headers: {
			...declared.headers,
			"x-requested-with": "rvna",
			"content-length": String(8 * 1024 * 1024),
		},
		payload: declared.payload,
	});
	expect(declaredTooLarge.statusCode).toBe(413);
});

test("only the owner or an administrator may change an avatar", async () => {
	const forbidden = await upload(
		owner.username,
		other.session,
		"avatar.png",
		"image/png",
		png,
	);
	expect(forbidden.statusCode).toBe(403);

	const allowed = await upload(
		owner.username,
		admin.session,
		"avatar.png",
		"image/png",
		png,
	);
	expect(allowed.statusCode).toBe(200);
});

test("replacing an avatar deletes the file the old one used", async () => {
	const avatarsDir = process.env.AVATARS_DIR as string;
	const first = await upload(
		owner.username,
		owner.session,
		"first.png",
		"image/png",
		Buffer.concat([png, Buffer.from("first replacement")]),
	);
	expect(first.statusCode).toBe(200);
	const firstRows = await client.query<{ avatar_file: string }>(
		"select avatar_file from users where id = $1",
		[owner.id],
	);
	const firstFile = firstRows.rows[0]?.avatar_file as string;

	const second = await upload(
		owner.username,
		owner.session,
		"second.png",
		"image/png",
		Buffer.concat([png, Buffer.from("second replacement")]),
	);
	expect(second.statusCode).toBe(200);
	const secondRows = await client.query<{ avatar_file: string }>(
		"select avatar_file from users where id = $1",
		[owner.id],
	);
	const secondFile = secondRows.rows[0]?.avatar_file as string;
	expect(secondFile).not.toBe(firstFile);
	await expect(stat(join(avatarsDir, firstFile))).rejects.toMatchObject({
		code: "ENOENT",
	});
	expect((await stat(join(avatarsDir, secondFile))).isFile()).toBe(true);
});

test("replacing an avatar keeps a file another record still uses", async () => {
	const avatarsDir = process.env.AVATARS_DIR as string;
	const shared = await upload(
		owner.username,
		owner.session,
		"shared.png",
		"image/png",
		Buffer.concat([png, Buffer.from("shared replacement")]),
	);
	expect(shared.statusCode).toBe(200);
	const sharedRows = await client.query<{ avatar_file: string }>(
		"select avatar_file from users where id = $1",
		[owner.id],
	);
	const sharedFile = sharedRows.rows[0]?.avatar_file as string;
	await client.query("update users set avatar_file = $1 where id = $2", [
		sharedFile,
		other.id,
	]);
	try {
		const next = await upload(
			owner.username,
			owner.session,
			"next.png",
			"image/png",
			Buffer.concat([png, Buffer.from("next replacement")]),
		);
		expect(next.statusCode).toBe(200);
		expect((await stat(join(avatarsDir, sharedFile))).isFile()).toBe(true);
	} finally {
		await client.query("update users set avatar_file = null where id = $1", [
			other.id,
		]);
		await unlink(join(avatarsDir, sharedFile)).catch(() => undefined);
	}
});

test("uploadAvatar enforces the size limit even when its reader forgets", async () => {
	const actor = await userForSession(owner.session);
	if (!actor) throw new Error("The test session has no user");
	await expect(
		uploadAvatar(actor, owner.username, async () => ({
			bytes: Buffer.alloc(MAX_AVATAR_BYTES + 1),
			tooLarge: false,
		})),
	).rejects.toMatchObject({
		status: 413,
		message: "Avatar must be 2 MB or smaller",
	});
});
