import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { importConfluenceAvatars } from "../src/importer/avatars.ts";
import { pool, runMigrations } from "../src/importer/db.ts";

const run = randomUUID().slice(0, 8);
const baseUrl = "https://confluence.example.test";
const prefix = `fixture-confluence-avatar:${run}`;

const oldPng = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	Buffer.from("old-avatar"),
]);
const newPng = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	Buffer.from("new-avatar"),
]);

class MockConfluenceClient {
	readonly downloads: string[] = [];
	users: {
		userKey?: string;
		username?: string;
		profilePicture?: { path?: string; isDefault?: boolean };
	}[] = [];
	bytes = new Map<string, Buffer>();

	async listUsers() {
		return this.users;
	}

	async getBytes(path: string): Promise<Buffer> {
		this.downloads.push(path);
		const bytes = this.bytes.get(new URL(path, baseUrl).pathname);
		if (!bytes) throw new Error(`Unexpected download ${path}`);
		return bytes;
	}
}

let avatarsDir: string;

beforeAll(async () => {
	await runMigrations();
	avatarsDir = await mkdtemp(join(tmpdir(), "rvna-confluence-avatar-"));
});

afterAll(async () => {
	await pool.query("delete from spaces where source_id like $1", [
		`${prefix}:%`,
	]);
	await pool.query("delete from users where username like $1", [`t-${run}-%`]);
	await rm(avatarsDir, { recursive: true, force: true });
	await pool.end();
});

async function insertSpace(
	iconPath: string,
	iconFile: string,
	iconSource: string,
) {
	const result = await pool.query<{ id: string }>(
		`insert into spaces (source_id, key, name, icon_path, icon_file, icon_source)
		 values ($1, $2, $3, $4, $5, $6)
		 returning id`,
		[
			`${prefix}:space:${randomUUID()}`,
			`C${randomUUID().slice(0, 8).toUpperCase()}`,
			"Confluence avatar space",
			iconPath,
			iconFile,
			iconSource,
		],
	);
	const row = result.rows[0];
	if (!row) throw new Error("space was not inserted");
	return row.id;
}

async function insertUser(avatarFile: string, avatarSource: string) {
	const username = `t-${run}-${randomUUID().slice(0, 6)}`;
	const sourceKey = `${prefix}:user:${randomUUID()}`;
	const result = await pool.query<{ id: string }>(
		`insert into users (source_key, username, display_name, avatar_file, avatar_source)
		 values ($1, $2, 'Confluence avatar user', $3, $4)
		 returning id`,
		[sourceKey, username, avatarFile, avatarSource],
	);
	const row = result.rows[0];
	if (!row) throw new Error("user was not inserted");
	return { id: row.id, sourceKey, username };
}

async function storedSpace(id: string) {
	const result = await pool.query<{
		icon_file: string | null;
		icon_source: string | null;
	}>("select icon_file, icon_source from spaces where id = $1", [id]);
	return result.rows[0];
}

async function storedUser(id: string) {
	const result = await pool.query<{
		avatar_file: string | null;
		avatar_source: string | null;
	}>("select avatar_file, avatar_source from users where id = $1", [id]);
	return result.rows[0];
}

describe("confluence avatar import", () => {
	test("a changed space logo replaces the stored file", async () => {
		const oldFile = `${"a".repeat(64)}.png`;
		const oldSource = "/download/space/old-logo.png";
		const newSource = "/download/space/new-logo.png";
		await writeFile(join(avatarsDir, oldFile), oldPng);
		const id = await insertSpace(newSource, oldFile, oldSource);
		const client = new MockConfluenceClient();
		client.bytes.set(newSource, newPng);

		try {
			const counts = await importConfluenceAvatars(client as never, {
				baseUrl,
				avatarsDir,
				scope: { spaceIds: [id], userIds: [] },
			});
			expect(counts.spaces).toMatchObject({
				stored: 0,
				updated: 1,
				unchanged: 0,
				skipped: 0,
				failed: 0,
			});
			const row = await storedSpace(id);
			expect(row?.icon_file).toMatch(/^[0-9a-f]{64}\.png$/);
			expect(row?.icon_file).not.toBe(oldFile);
			expect(row?.icon_source).toBe(newSource);
			await expect(readFile(join(avatarsDir, oldFile))).rejects.toMatchObject({
				code: "ENOENT",
			});
		} finally {
			await pool.query("delete from spaces where id = $1", [id]);
		}
	});

	test("a default space picture clears the stored logo", async () => {
		const oldFile = `${"b".repeat(64)}.png`;
		await writeFile(join(avatarsDir, oldFile), oldPng);
		const id = await insertSpace(
			"/images/icons/emoticons/default-space-logo.png",
			oldFile,
			"/download/space/old-logo.png",
		);

		try {
			const counts = await importConfluenceAvatars(
				new MockConfluenceClient() as never,
				{
					baseUrl,
					avatarsDir,
					scope: { spaceIds: [id], userIds: [] },
				},
			);
			expect(counts.spaces).toMatchObject({ skipped: 1, updated: 0 });
			expect(await storedSpace(id)).toMatchObject({
				icon_file: null,
				icon_source: null,
			});
			await expect(readFile(join(avatarsDir, oldFile))).rejects.toMatchObject({
				code: "ENOENT",
			});
		} finally {
			await pool.query("delete from spaces where id = $1", [id]);
		}
	});

	test("a changed user picture replaces the stored file", async () => {
		const oldFile = `${"c".repeat(64)}.png`;
		const oldSource = "/download/user/old.png";
		const newSource = "/download/user/new.png";
		await writeFile(join(avatarsDir, oldFile), oldPng);
		const user = await insertUser(oldFile, oldSource);
		const client = new MockConfluenceClient();
		client.users = [
			{
				userKey: user.sourceKey,
				username: user.username,
				profilePicture: { path: newSource },
			},
		];
		client.bytes.set(newSource, newPng);

		try {
			const counts = await importConfluenceAvatars(client as never, {
				baseUrl,
				avatarsDir,
				scope: { spaceIds: [], userIds: [user.id] },
			});
			expect(counts.confluenceUsers).toMatchObject({
				stored: 0,
				updated: 1,
				unchanged: 0,
				skipped: 0,
				failed: 0,
			});
			const row = await storedUser(user.id);
			expect(row?.avatar_file).toMatch(/^[0-9a-f]{64}\.png$/);
			expect(row?.avatar_file).not.toBe(oldFile);
			expect(row?.avatar_source).toBe(newSource);
			await expect(readFile(join(avatarsDir, oldFile))).rejects.toMatchObject({
				code: "ENOENT",
			});
		} finally {
			await pool.query("delete from users where id = $1", [user.id]);
		}
	});

	test("a default user picture clears the stored avatar", async () => {
		const oldFile = `${"d".repeat(64)}.png`;
		await writeFile(join(avatarsDir, oldFile), oldPng);
		const user = await insertUser(oldFile, "/download/user/old.png");
		const client = new MockConfluenceClient();
		client.users = [
			{
				userKey: user.sourceKey,
				username: user.username,
				profilePicture: {
					path: "/images/icons/emoticons/default-user.png",
					isDefault: true,
				},
			},
		];

		try {
			const counts = await importConfluenceAvatars(client as never, {
				baseUrl,
				avatarsDir,
				scope: { spaceIds: [], userIds: [user.id] },
			});
			expect(counts.confluenceUsers).toMatchObject({
				skipped: 1,
				updated: 0,
			});
			expect(await storedUser(user.id)).toMatchObject({
				avatar_file: null,
				avatar_source: null,
			});
			await expect(readFile(join(avatarsDir, oldFile))).rejects.toMatchObject({
				code: "ENOENT",
			});
		} finally {
			await pool.query("delete from users where id = $1", [user.id]);
		}
	});
});
