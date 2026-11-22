import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
	importJiraAvatars,
	isBuiltInJiraIcon,
	isDefaultUserAvatar,
	largestAvatarUrl,
} from "../src/importer/avatars.ts";
import { pool, runMigrations } from "../src/importer/db.ts";
import {
	issueTypeIconKeyForName,
	priorityIconName,
} from "../src/lib/components/icons.ts";

const run = randomUUID().slice(0, 8);
const baseUrl = "https://jira.example.test";
const prefix = `fixture-avatar:${run}`;
const userNames = {
	custom: `t-${run}-custom`,
	same: `t-${run}-same`,
	default: `t-${run}-default`,
};
const projectKeys = {
	custom: `AV${run.slice(0, 5).toUpperCase()}`,
	default: `AD${run.slice(0, 5).toUpperCase()}`,
};

const systemUserPng = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	Buffer.from("system-user"),
]);
const customPng = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	Buffer.from("custom-user"),
]);
const genericProjectPng = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	Buffer.from("generic-project"),
]);
const customProjectPng = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	Buffer.from("custom-project"),
]);
const typeSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const priorityPng = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	Buffer.from("priority"),
]);
const customPriorityAvatarPng = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	Buffer.from("custom-priority-avatar"),
]);
const firstRefreshPriorityPng = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	Buffer.from("priority-one"),
]);
const secondPriorityPng = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	Buffer.from("priority-two"),
]);

const systemUserUrl = `${baseUrl}/system-user.png?avatarId=10335`;
const systemProjectUrl = `${baseUrl}/system-project.png?avatarId=10324`;
const customUserUrl = `${baseUrl}/custom-user.png?ownerId=JIRAUSER1&avatarId=10904`;
const customProjectUrl = `${baseUrl}/custom-project.png?ownerId=1&avatarId=11000`;
const typeIconUrl = `${baseUrl}/type.svg`;
const priorityIconUrl = `${baseUrl}/priority.png`;
const prioritySystemUrl = `${baseUrl}/secure/viewavatar?avatarId=10000&avatarType=priority`;
const customPriorityAvatarUrl = `${baseUrl}/secure/viewavatar?avatarId=10904&avatarType=priority`;
const builtinTypeUrl = `${baseUrl}/images/icons/issuetypes/bug.svg`;
const builtinPriorityUrl = `${baseUrl}/images/icons/priorities/highest.svg`;
const staleTypeFile = `${"a".repeat(64)}.svg`;
const stalePriorityFile = `${"b".repeat(64)}.png`;
const reimportStaleFile = `${"c".repeat(64)}.svg`;

interface MockCall {
	path: string;
	params?: Record<string, string | number | boolean | undefined>;
}

class MockJiraClient {
	readonly baseUrl = baseUrl;
	readonly calls: MockCall[] = [];
	readonly downloads: string[] = [];

	async getJson<T>(
		path: string,
		params?: Record<string, string | number | boolean | undefined>,
	): Promise<T> {
		this.calls.push({ path, params });
		if (path === "/rest/api/2/avatar/user/system") {
			return {
				system: [
					{
						id: "10335",
						urls: { "48x48": systemUserUrl },
					},
				],
			} as T;
		}
		if (path === "/rest/api/2/avatar/project/system") {
			return {
				system: [
					{
						id: "10324",
						urls: { "48x48": systemProjectUrl },
					},
				],
			} as T;
		}
		if (path === "/rest/api/2/avatar/issuetype/system") {
			return {
				system: [
					{
						id: "10300",
						urls: {
							"48x48": `${baseUrl}/images/icons/issuetypes/generic.svg`,
						},
					},
				],
			} as T;
		}
		if (path === "/rest/api/2/avatar/priority/system") {
			return {
				system: [
					{
						id: "10000",
						urls: {
							"48x48": `${baseUrl}/images/icons/priorities/highest.svg`,
						},
					},
				],
			} as T;
		}
		if (path === "/rest/api/2/user") {
			const username = String(params?.username);
			if (username === userNames.default) {
				return {
					name: username,
					displayName: "Default User",
					avatarUrls: { "48x48": systemUserUrl },
				} as T;
			}
			return {
				name: username,
				displayName:
					username === userNames.custom ? "Custom User" : "Same User",
				avatarUrls: { "48x48": customUserUrl },
				timeZone: "Europe/Helsinki",
			} as T;
		}
		if (path.startsWith("/rest/api/2/project/")) {
			const key = decodeURIComponent(path.split("/").at(-1) ?? "");
			return {
				key,
				avatarUrls: {
					"48x48":
						key === projectKeys.custom ? customProjectUrl : systemProjectUrl,
				},
			} as T;
		}
		if (path === "/rest/api/2/issuetype") {
			return [
				{
					id: `${prefix}:type`,
					name: "Fixture Avatar Type",
					iconUrl: typeIconUrl,
				},
				{
					id: `${prefix}:builtin-type`,
					name: "Bug",
					iconUrl: builtinTypeUrl,
				},
				{
					id: `${prefix}:stale-type`,
					name: "Task",
					iconUrl: builtinTypeUrl,
				},
			] as T;
		}
		if (path === "/rest/api/2/priority") {
			return [
				{
					id: `${prefix}:priority`,
					name: "Fixture Avatar Priority",
					iconUrl: priorityIconUrl,
				},
				{
					id: `${prefix}:builtin-priority`,
					name: "Highest",
					iconUrl: builtinPriorityUrl,
				},
				{
					id: `${prefix}:stale-priority`,
					name: "Lowest",
					iconUrl: builtinPriorityUrl,
				},
			] as T;
		}
		throw new Error(`Unexpected GET ${path}`);
	}

	async getBytes(path: string): Promise<Buffer> {
		this.downloads.push(path);
		const url = new URL(path, baseUrl);
		if (url.pathname === "/secure/viewavatar") {
			const avatarId = url.searchParams.get("avatarId");
			if (avatarId === "10000") return priorityPng;
			if (avatarId === "10904") return customPriorityAvatarPng;
			throw new Error(`Unexpected avatar id ${avatarId}`);
		}
		switch (url.pathname) {
			case "/system-user.png":
				return systemUserPng;
			case "/custom-user.png":
				return customPng;
			case "/system-project.png":
				return genericProjectPng;
			case "/custom-project.png":
				return customProjectPng;
			case "/type.svg":
				return typeSvg;
			case "/priority.png":
				return priorityPng;
			default:
				throw new Error(`Unexpected download ${url.pathname}`);
		}
	}
}

class BrokenSystemClient extends MockJiraClient {
	override async getJson<T>(
		path: string,
		params?: Record<string, string | number | boolean | undefined>,
	): Promise<T> {
		if (path === "/rest/api/2/avatar/user/system") {
			return {
				system: [
					{
						id: "10335",
						urls: {
							"48x48": `${baseUrl}/broken-system.png?avatarId=10335`,
						},
					},
				],
			} as T;
		}
		return super.getJson<T>(path, params);
	}

	override async getBytes(path: string): Promise<Buffer> {
		if (new URL(path, baseUrl).pathname === "/broken-system.png") {
			throw new Error("system avatar unavailable");
		}
		return super.getBytes(path);
	}
}

class PriorityListClient extends MockJiraClient {
	private readonly priorities: {
		id: string;
		name: string;
		iconUrl: string;
	}[];

	constructor(priorities: { id: string; name: string; iconUrl: string }[]) {
		super();
		this.priorities = priorities;
	}

	override async getJson<T>(
		path: string,
		params?: Record<string, string | number | boolean | undefined>,
	): Promise<T> {
		if (path === "/rest/api/2/priority") return this.priorities as T;
		return super.getJson<T>(path, params);
	}
}

class ChangingPriorityClient extends MockJiraClient {
	private readonly iconUrl: string;
	private readonly bytes: Buffer;

	constructor(iconUrl: string, bytes: Buffer) {
		super();
		this.iconUrl = iconUrl;
		this.bytes = bytes;
	}

	override async getJson<T>(
		path: string,
		params?: Record<string, string | number | boolean | undefined>,
	): Promise<T> {
		if (path === "/rest/api/2/priority") {
			return [
				{
					id: `${prefix}:priority-refresh`,
					name: "Refresh Priority",
					iconUrl: this.iconUrl,
				},
			] as T;
		}
		return super.getJson<T>(path, params);
	}

	override async getBytes(path: string): Promise<Buffer> {
		if (new URL(path, baseUrl).href === this.iconUrl) {
			this.downloads.push(path);
			return this.bytes;
		}
		return super.getBytes(path);
	}
}

let avatarsDir: string;
let client: MockJiraClient;
let userIds: string[];
let projectIds: string[];
let issueTypeIds: Record<"custom" | "builtin" | "stale", string>;
let priorityIds: Record<"custom" | "builtin" | "stale", string>;

async function cleanup() {
	await pool.query("delete from projects where key = any($1::text[])", [
		Object.values(projectKeys),
	]);
	await pool.query("delete from issue_types where source_id like $1", [
		`${prefix}:%`,
	]);
	await pool.query("delete from priorities where source_id like $1", [
		`${prefix}:%`,
	]);
	await pool.query("delete from users where username = any($1::text[])", [
		Object.values(userNames),
	]);
}

beforeAll(async () => {
	await runMigrations();
	await cleanup();
	avatarsDir = await mkdtemp(join(tmpdir(), "rvna-avatar-import-"));

	const users = await pool.query<{ id: string }>(
		`insert into users (source_key, username, display_name)
		 values ($1, $2, 'Custom User'), ($3, $4, 'Same User'), ($5, $6, 'Default User')
		 returning id`,
		[
			`${prefix}:user:custom`,
			userNames.custom,
			`${prefix}:user:same`,
			userNames.same,
			`${prefix}:user:default`,
			userNames.default,
		],
	);
	userIds = users.rows.map((row) => row.id);

	const projects = await pool.query<{ id: string }>(
		`insert into projects (source_id, key, name, project_type)
		 values ($1, $2, 'Avatar project', 'software'),
		        ($3, $4, 'Default avatar project', 'software')
		 returning id`,
		[
			`${prefix}:project:custom`,
			projectKeys.custom,
			`${prefix}:project:default`,
			projectKeys.default,
		],
	);
	projectIds = projects.rows.map((row) => row.id);

	const issueTypes = await pool.query<{ id: string; source_id: string }>(
		`insert into issue_types (source_id, name, icon_url, icon_file)
		 values ($1, 'Fixture Avatar Type', null, null),
		        ($2, 'Bug', $4, $5),
		        ($3, 'Task', $4, null)
		 returning id, source_id`,
		[
			`${prefix}:type`,
			`${prefix}:builtin-type`,
			`${prefix}:stale-type`,
			builtinTypeUrl,
			staleTypeFile,
		],
	);
	const issueTypeIdsBySource = new Map(
		issueTypes.rows.map((row) => [row.source_id, row.id]),
	);
	issueTypeIds = {
		custom: issueTypeIdsBySource.get(`${prefix}:type`) as string,
		builtin: issueTypeIdsBySource.get(`${prefix}:builtin-type`) as string,
		stale: issueTypeIdsBySource.get(`${prefix}:stale-type`) as string,
	};

	const priorities = await pool.query<{ id: string; source_id: string }>(
		`insert into priorities (source_id, name, sequence, icon_file)
		 values ($1, 'Fixture Avatar Priority', 9, null),
		        ($2, 'Highest', 1, $4),
		        ($3, 'Lowest', 5, null)
		 returning id, source_id`,
		[
			`${prefix}:priority`,
			`${prefix}:builtin-priority`,
			`${prefix}:stale-priority`,
			stalePriorityFile,
		],
	);
	const priorityIdsBySource = new Map(
		priorities.rows.map((row) => [row.source_id, row.id]),
	);
	priorityIds = {
		custom: priorityIdsBySource.get(`${prefix}:priority`) as string,
		builtin: priorityIdsBySource.get(`${prefix}:builtin-priority`) as string,
		stale: priorityIdsBySource.get(`${prefix}:stale-priority`) as string,
	};

	await writeFile(join(avatarsDir, staleTypeFile), typeSvg);
	await writeFile(join(avatarsDir, stalePriorityFile), priorityPng);

	client = new MockJiraClient();
});

afterAll(async () => {
	await cleanup();
	await rm(avatarsDir, { recursive: true, force: true });
	await pool.end();
});

function scope() {
	return {
		userIds,
		projectIds,
		issueTypeIds: Object.values(issueTypeIds),
		priorityIds: Object.values(priorityIds),
	};
}

async function rows() {
	const users = await pool.query<{
		id: string;
		avatar_file: string | null;
		avatar_url: string | null;
		updated_at: string;
	}>(
		"select id, avatar_file, avatar_url, updated_at::text from users where id = any($1::uuid[]) order by id",
		[userIds],
	);
	const projects = await pool.query<{
		id: string;
		avatar_file: string | null;
		avatar_url: string | null;
		updated_at: string;
	}>(
		"select id, avatar_file, avatar_url, updated_at::text from projects where id = any($1::uuid[]) order by id",
		[projectIds],
	);
	const types = await pool.query<{
		source_id: string;
		icon_file: string | null;
		icon_url: string | null;
		updated_at: string;
	}>(
		"select source_id, icon_file, icon_url, updated_at::text from issue_types where source_id like $1 order by source_id",
		[`${prefix}:%`],
	);
	const priorities = await pool.query<{
		source_id: string;
		icon_file: string | null;
		icon_url: string | null;
		updated_at: string;
	}>(
		"select source_id, icon_file, icon_url, updated_at::text from priorities where source_id like $1 order by source_id",
		[`${prefix}:%`],
	);
	return {
		users: users.rows,
		projects: projects.rows,
		types: types.rows,
		priorities: priorities.rows,
	};
}

describe("jira avatar import", () => {
	test("detects defaults by id or content hash", () => {
		const systemIds = new Set(["10335"]);
		expect(
			isDefaultUserAvatar({
				url: systemUserUrl,
				baseUrl,
				systemIds,
			}),
		).toBe(true);
		expect(
			isDefaultUserAvatar({
				url: customUserUrl,
				baseUrl,
				systemIds,
				sha256: "abc",
				systemHashes: new Set(["abc"]),
			}),
		).toBe(true);
		expect(
			isDefaultUserAvatar({
				url: customUserUrl,
				baseUrl,
				systemIds,
				sha256: "def",
				systemHashes: new Set(["abc"]),
			}),
		).toBe(false);
		expect(
			largestAvatarUrl({
				"16x16": `${baseUrl}/small.png`,
				"48x48": `${baseUrl}/large.png`,
			}),
		).toBe(`${baseUrl}/large.png`);
		expect(isBuiltInJiraIcon({ url: builtinTypeUrl, baseUrl })).toBe(true);
		expect(isBuiltInJiraIcon({ url: builtinPriorityUrl, baseUrl })).toBe(true);
		expect(
			isBuiltInJiraIcon({
				url: `${baseUrl}/jira/images/icons/issuetypes/bug.svg`,
				baseUrl,
			}),
		).toBe(true);
		expect(isBuiltInJiraIcon({ url: typeIconUrl, baseUrl })).toBe(false);
		const avatarTypeUrl = `${baseUrl}/secure/viewavatar?avatarId=10904&avatarType=issuetype`;
		expect(
			isBuiltInJiraIcon({
				url: avatarTypeUrl,
				baseUrl,
				systemIds: new Set(["10300"]),
			}),
		).toBe(false);
		expect(
			isBuiltInJiraIcon({ url: avatarTypeUrl, baseUrl, systemIds: null }),
		).toBe(true);
	});

	test("built-in type and priority names use our own icons", () => {
		expect(issueTypeIconKeyForName("Bug")).toBe("bug");
		expect(issueTypeIconKeyForName("Task")).toBe("task");
		expect(issueTypeIconKeyForName("Story")).toBe("story");
		expect(issueTypeIconKeyForName("Epic")).toBe("epic");
		expect(issueTypeIconKeyForName("Sub-task")).toBe("subtask");
		expect(issueTypeIconKeyForName("New Feature")).toBe("story");
		expect(issueTypeIconKeyForName("Improvement")).toBe("story");
		expect(priorityIconName("Highest")).toBe("priority-highest");
		expect(priorityIconName("High")).toBe("priority-high");
		expect(priorityIconName("Medium")).toBe("priority-medium");
		expect(priorityIconName("Low")).toBe("priority-low");
		expect(priorityIconName("Lowest")).toBe("priority-lowest");
		expect(priorityIconName("Blocker")).toBe("priority-highest");
	});

	test("stores content-addressed files and skips defaults", async () => {
		const first = await importJiraAvatars(client as never, {
			baseUrl,
			avatarsDir,
			scope: scope(),
		});

		expect(first.users).toEqual({
			stored: 2,
			updated: 0,
			unchanged: 0,
			skipped: 1,
			failed: 0,
		});
		expect(first.projects).toEqual({
			stored: 1,
			updated: 0,
			unchanged: 0,
			skipped: 1,
			failed: 0,
		});
		expect(first.issueTypes).toEqual({
			stored: 1,
			updated: 0,
			unchanged: 0,
			skipped: 2,
			failed: 0,
		});
		expect(first.priorities).toEqual({
			stored: 1,
			updated: 0,
			unchanged: 0,
			skipped: 2,
			failed: 0,
		});

		const stored = await rows();
		const custom = stored.users.find((row) => row.id === userIds[0]);
		const same = stored.users.find((row) => row.id === userIds[1]);
		const defaultUser = stored.users.find((row) => row.id === userIds[2]);
		expect(custom?.avatar_file).toMatch(/^[0-9a-f]{64}\.png$/);
		expect(same?.avatar_file).toBe(custom?.avatar_file);
		expect(defaultUser?.avatar_file).toBeNull();
		expect(defaultUser?.avatar_url).toBe(systemUserUrl);
		expect(
			stored.projects.find((row) => row.id === projectIds[0])?.avatar_file,
		).toMatch(/^[0-9a-f]{64}\.png$/);
		expect(
			stored.projects.find((row) => row.id === projectIds[1])?.avatar_file,
		).toBeNull();
		const customType = stored.types.find(
			(row) => row.source_id === `${prefix}:type`,
		);
		const builtinType = stored.types.find(
			(row) => row.source_id === `${prefix}:builtin-type`,
		);
		const staleType = stored.types.find(
			(row) => row.source_id === `${prefix}:stale-type`,
		);
		const customPriority = stored.priorities.find(
			(row) => row.source_id === `${prefix}:priority`,
		);
		const builtinPriority = stored.priorities.find(
			(row) => row.source_id === `${prefix}:builtin-priority`,
		);
		const stalePriority = stored.priorities.find(
			(row) => row.source_id === `${prefix}:stale-priority`,
		);
		expect(customType?.icon_file).toMatch(/^[0-9a-f]{64}\.svg$/);
		expect(customPriority?.icon_file).toMatch(/^[0-9a-f]{64}\.png$/);
		expect(customPriority?.icon_url).toBe(priorityIconUrl);
		expect(builtinType).toMatchObject({ icon_file: null, icon_url: null });
		expect(staleType).toMatchObject({ icon_file: null, icon_url: null });
		expect(builtinPriority).toMatchObject({ icon_file: null, icon_url: null });
		expect(stalePriority).toMatchObject({ icon_file: null, icon_url: null });
		expect(
			client.downloads.some((path) => path.includes("/images/icons/")),
		).toBe(false);
		await expect(
			readFile(join(avatarsDir, staleTypeFile)),
		).rejects.toMatchObject({
			code: "ENOENT",
		});
		await expect(
			readFile(join(avatarsDir, stalePriorityFile)),
		).rejects.toMatchObject({ code: "ENOENT" });

		expect(await readFile(join(avatarsDir, custom?.avatar_file ?? ""))).toEqual(
			customPng,
		);

		const before = await rows();
		const downloadsBefore = client.downloads.length;
		const second = await importJiraAvatars(client as never, {
			baseUrl,
			avatarsDir,
			scope: scope(),
		});
		expect(second.users.stored).toBe(0);
		expect(second.users.updated).toBe(0);
		expect(second.projects.stored).toBe(0);
		expect(second.projects.updated).toBe(0);
		expect(second.issueTypes.updated).toBe(0);
		expect(second.priorities.updated).toBe(0);
		expect(await rows()).toEqual(before);
		expect(client.downloads.length).toBe(downloadsBefore);
	});

	test("an unavailable system avatar list treats avatar ids as built-in", async () => {
		const sourceId = `${prefix}:fallback-type`;
		const inserted = await pool.query<{ id: string }>(
			"insert into issue_types (source_id, name) values ($1, $2) returning id",
			[sourceId, "Fallback Type"],
		);
		const row = inserted.rows[0];
		if (!row) throw new Error("fallback issue type was not inserted");
		const downloads: string[] = [];
		const fallbackClient = {
			async getJson(path: string) {
				if (path === "/rest/api/2/avatar/issuetype/system") {
					throw new Error("system avatar list unavailable");
				}
				if (
					path === "/rest/api/2/avatar/user/system" ||
					path === "/rest/api/2/avatar/project/system"
				) {
					return { system: [] };
				}
				if (path === "/rest/api/2/issuetype") {
					return [
						{
							id: sourceId,
							name: "Fallback Type",
							iconUrl: `${baseUrl}/secure/viewavatar?avatarId=10999&avatarType=issuetype`,
						},
					];
				}
				if (path === "/rest/api/2/priority") return [];
				throw new Error(`Unexpected GET ${path}`);
			},
			async getBytes(path: string) {
				downloads.push(path);
				throw new Error(`Unexpected download ${path}`);
			},
		};

		try {
			const counts = await importJiraAvatars(fallbackClient as never, {
				baseUrl,
				avatarsDir,
				scope: {
					userIds: [],
					projectIds: [],
					issueTypeIds: [row.id],
					priorityIds: [],
				},
			});
			expect(counts.issueTypes).toMatchObject({ stored: 0, skipped: 1 });
			expect(downloads).toEqual([]);
			const stored = await pool.query<{ icon_file: string | null }>(
				"select icon_file from issue_types where id = $1",
				[row.id],
			);
			expect(stored.rows[0]?.icon_file).toBeNull();
		} finally {
			await pool.query("delete from issue_types where id = $1", [row.id]);
		}
	});

	test("removes a built-in icon stored by an earlier import", async () => {
		await pool.query(
			`update issue_types
			 set icon_file = $1, icon_url = $2
			 where source_id = $3`,
			[reimportStaleFile, builtinTypeUrl, `${prefix}:stale-type`],
		);
		await writeFile(join(avatarsDir, reimportStaleFile), typeSvg);

		await importJiraAvatars(client as never, {
			baseUrl,
			avatarsDir,
			scope: scope(),
		});

		const type = (await rows()).types.find(
			(row) => row.source_id === `${prefix}:stale-type`,
		);
		expect(type).toMatchObject({ icon_file: null, icon_url: null });
		await expect(
			readFile(join(avatarsDir, reimportStaleFile)),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("one failing system avatar download does not abort the user import", async () => {
		const username = `t-${run}-hashfail`;
		const inserted = await pool.query<{ id: string }>(
			`insert into users (source_key, username, display_name)
			 values ($1, $2, 'Hash Fail')
			 returning id`,
			[`${prefix}:user:hashfail`, username],
		);
		const id = inserted.rows[0]?.id;
		if (!id) throw new Error("hash failure user was not inserted");

		try {
			const counts = await importJiraAvatars(
				new BrokenSystemClient() as never,
				{
					baseUrl,
					avatarsDir,
					scope: {
						userIds: [id],
						projectIds: [],
						issueTypeIds: [],
						priorityIds: [],
					},
				},
			);
			expect(counts.users).toMatchObject({ stored: 1, failed: 0 });
			const stored = await pool.query<{ avatar_file: string | null }>(
				"select avatar_file from users where id = $1",
				[id],
			);
			expect(stored.rows[0]?.avatar_file).toMatch(/^[0-9a-f]{64}\.png$/);
		} finally {
			await pool.query("delete from users where id = $1", [id]);
		}
	});

	test("replacing a user avatar removes the previous file", async () => {
		const oldFile = `${"f".repeat(64)}.png`;
		await writeFile(join(avatarsDir, oldFile), customPng);
		await pool.query(
			"update users set avatar_file = $1, avatar_url = $2 where id = $3",
			[oldFile, `${baseUrl}/old-user.png`, userIds[0]],
		);

		await importJiraAvatars(client as never, {
			baseUrl,
			avatarsDir,
			scope: scope(),
		});

		const user = (await rows()).users.find((row) => row.id === userIds[0]);
		expect(user?.avatar_file).toMatch(/^[0-9a-f]{64}\.png$/);
		expect(user?.avatar_file).not.toBe(oldFile);
		await expect(readFile(join(avatarsDir, oldFile))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	test("replacing a project logo removes the previous file", async () => {
		const oldFile = `${"1".repeat(64)}.png`;
		await writeFile(join(avatarsDir, oldFile), customProjectPng);
		await pool.query(
			"update projects set avatar_file = $1, avatar_url = $2 where id = $3",
			[oldFile, `${baseUrl}/old-project.png`, projectIds[0]],
		);

		await importJiraAvatars(client as never, {
			baseUrl,
			avatarsDir,
			scope: scope(),
		});

		const project = (await rows()).projects.find(
			(row) => row.id === projectIds[0],
		);
		expect(project?.avatar_file).toMatch(/^[0-9a-f]{64}\.png$/);
		expect(project?.avatar_file).not.toBe(oldFile);
		await expect(readFile(join(avatarsDir, oldFile))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	test("a built-in priority icon addressed by avatar id is not stored", async () => {
		const builtinSource = `${prefix}:priority-avatar-builtin`;
		const customSource = `${prefix}:priority-avatar-custom`;
		const inserted = await pool.query<{ id: string; source_id: string }>(
			`insert into priorities (source_id, name, sequence, icon_url)
			 values ($1, 'Builtin Avatar Priority', 10, $3),
			        ($2, 'Custom Avatar Priority', 11, $4)
			 returning id, source_id`,
			[builtinSource, customSource, prioritySystemUrl, customPriorityAvatarUrl],
		);
		const ids = new Map(
			inserted.rows.map((row) => [row.source_id, row.id] as const),
		);

		try {
			const avatarClient = new PriorityListClient([
				{
					id: builtinSource,
					name: "Builtin Avatar Priority",
					iconUrl: prioritySystemUrl,
				},
				{
					id: customSource,
					name: "Custom Avatar Priority",
					iconUrl: customPriorityAvatarUrl,
				},
			]);
			const counts = await importJiraAvatars(avatarClient as never, {
				baseUrl,
				avatarsDir,
				scope: {
					userIds: [],
					projectIds: [],
					issueTypeIds: [],
					priorityIds: [...ids.values()],
				},
			});
			expect(counts.priorities).toMatchObject({
				stored: 1,
				skipped: 1,
				failed: 0,
			});
			expect(
				avatarClient.downloads.some((path) => path.includes("avatarId=10000")),
			).toBe(false);

			const stored = await pool.query<{
				source_id: string;
				icon_file: string | null;
				icon_url: string | null;
			}>(
				`select source_id, icon_file, icon_url
				 from priorities where source_id = any($1::text[])`,
				[[builtinSource, customSource]],
			);
			const builtin = stored.rows.find(
				(row) => row.source_id === builtinSource,
			);
			const custom = stored.rows.find((row) => row.source_id === customSource);
			expect(builtin).toMatchObject({ icon_file: null, icon_url: null });
			expect(custom?.icon_file).toMatch(/^[0-9a-f]{64}\.png$/);
			expect(custom?.icon_url).toBe(customPriorityAvatarUrl);
		} finally {
			await pool.query(
				"delete from priorities where source_id = any($1::text[])",
				[[builtinSource, customSource]],
			);
		}
	});

	test("a changed priority icon is stored again", async () => {
		const sourceId = `${prefix}:priority-refresh`;
		const firstUrl = `${baseUrl}/priority-refresh-1.png`;
		const secondUrl = `${baseUrl}/priority-refresh-2.png`;
		const inserted = await pool.query<{ id: string }>(
			`insert into priorities (source_id, name, sequence, icon_url)
			 values ($1, 'Refresh Priority', 12, $2)
			 returning id`,
			[sourceId, firstUrl],
		);
		const id = inserted.rows[0]?.id;
		if (!id) throw new Error("refresh priority was not inserted");

		try {
			const first = await importJiraAvatars(
				new ChangingPriorityClient(firstUrl, firstRefreshPriorityPng) as never,
				{
					baseUrl,
					avatarsDir,
					scope: {
						userIds: [],
						projectIds: [],
						issueTypeIds: [],
						priorityIds: [id],
					},
				},
			);
			expect(first.priorities).toMatchObject({ stored: 1, failed: 0 });
			const firstRow = await pool.query<{
				icon_file: string | null;
				icon_url: string | null;
			}>("select icon_file, icon_url from priorities where id = $1", [id]);
			const oldFile = firstRow.rows[0]?.icon_file;
			expect(oldFile).toMatch(/^[0-9a-f]{64}\.png$/);
			expect(firstRow.rows[0]?.icon_url).toBe(firstUrl);

			const second = await importJiraAvatars(
				new ChangingPriorityClient(secondUrl, secondPriorityPng) as never,
				{
					baseUrl,
					avatarsDir,
					scope: {
						userIds: [],
						projectIds: [],
						issueTypeIds: [],
						priorityIds: [id],
					},
				},
			);
			expect(second.priorities).toMatchObject({ updated: 1, unchanged: 0 });
			const secondRow = await pool.query<{
				icon_file: string | null;
				icon_url: string | null;
			}>("select icon_file, icon_url from priorities where id = $1", [id]);
			expect(secondRow.rows[0]?.icon_url).toBe(secondUrl);
			expect(secondRow.rows[0]?.icon_file).not.toBe(oldFile);
			await expect(
				readFile(join(avatarsDir, oldFile ?? "")),
			).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await pool.query("delete from priorities where source_id = $1", [
				sourceId,
			]);
		}
	});
});

test("falling back to a default user avatar clears the stored custom image", async () => {
	const staleFile = `${"d".repeat(64)}.png`;
	await writeFile(join(avatarsDir, staleFile), customPng);
	await pool.query(
		"update users set avatar_file = $1, avatar_url = $2 where id = $3",
		[staleFile, customUserUrl, userIds[2]],
	);

	await importJiraAvatars(client as never, {
		baseUrl,
		avatarsDir,
		scope: scope(),
	});

	const stored = await rows();
	expect(
		stored.users.find((row) => row.id === userIds[2])?.avatar_file,
	).toBeNull();
	await expect(readFile(join(avatarsDir, staleFile))).rejects.toMatchObject({
		code: "ENOENT",
	});
});

test("falling back to a generic project avatar clears the stored custom logo", async () => {
	const staleFile = `${"e".repeat(64)}.png`;
	await writeFile(join(avatarsDir, staleFile), customProjectPng);
	await pool.query(
		"update projects set avatar_file = $1, avatar_url = $2 where id = $3",
		[staleFile, systemProjectUrl, projectIds[1]],
	);

	await importJiraAvatars(client as never, {
		baseUrl,
		avatarsDir,
		scope: scope(),
	});

	const stored = await rows();
	expect(
		stored.projects.find((row) => row.id === projectIds[1])?.avatar_file,
	).toBeNull();
	await expect(readFile(join(avatarsDir, staleFile))).rejects.toMatchObject({
		code: "ENOENT",
	});
});
