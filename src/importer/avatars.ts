import { createHash } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { eq, inArray, isNotNull } from "drizzle-orm";
import {
	issueTypes,
	priorities,
	projects,
	userPreferences,
	users,
} from "../lib/server/schema.ts";
import { spaces } from "../lib/server/schema-wiki.ts";
import { storeAvatarFile } from "../lib/shared/avatar-storage.ts";
import type { ConfluenceClient } from "./confluence.ts";
import { db } from "./db.ts";
import type { JiraClient } from "./jira.ts";
import type { JiraIssueType, JiraPriority, JiraUser } from "./types.ts";

const GENERIC_PROJECT_AVATAR_IDS = new Set(["10001", "10324"]);

export interface AvatarKindCounts {
	stored: number;
	updated: number;
	unchanged: number;
	skipped: number;
	failed: number;
}

export interface AvatarImportCounts {
	users: AvatarKindCounts;
	projects: AvatarKindCounts;
	issueTypes: AvatarKindCounts;
	priorities: AvatarKindCounts;
	spaces: AvatarKindCounts;
	confluenceUsers: AvatarKindCounts;
}

export interface AvatarImportScope {
	userIds?: string[];
	projectIds?: string[];
	issueTypeIds?: string[];
	priorityIds?: string[];
	spaceIds?: string[];
}

export interface AvatarImportOptions {
	baseUrl: string;
	avatarsDir: string;
	scope?: AvatarImportScope;
}

export function emptyAvatarCounts(): AvatarKindCounts {
	return { stored: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 };
}

export function emptyAvatarImportCounts(): AvatarImportCounts {
	return {
		users: emptyAvatarCounts(),
		projects: emptyAvatarCounts(),
		issueTypes: emptyAvatarCounts(),
		priorities: emptyAvatarCounts(),
		spaces: emptyAvatarCounts(),
		confluenceUsers: emptyAvatarCounts(),
	};
}

export function largestAvatarUrl(
	urls: Record<string, string> | undefined,
): string | null {
	let best: { size: number; url: string } | null = null;
	for (const [key, url] of Object.entries(urls ?? {})) {
		if (!url) continue;
		const match = key.match(/(\d+)\s*x\s*(\d+)/i);
		const size = match ? Number(match[1]) * Number(match[2]) : Number.NaN;
		if (!best || (Number.isFinite(size) && size > best.size)) {
			best = { size: Number.isFinite(size) ? size : 0, url };
		}
	}
	return best?.url ?? null;
}

export function avatarIdFromUrl(url: string | null, baseUrl: string) {
	if (!url) return null;
	try {
		return new URL(url, baseUrl).searchParams.get("avatarId");
	} catch {
		return null;
	}
}

function sameOrigin(url: string | null, baseUrl: string) {
	if (!url) return false;
	try {
		return new URL(url, baseUrl).origin === new URL(baseUrl).origin;
	} catch {
		return false;
	}
}

function requestPath(url: string, baseUrl: string) {
	const parsed = new URL(url, baseUrl);
	return `${parsed.pathname}${parsed.search}`;
}

export function isDefaultUserAvatar(input: {
	url: string | null;
	baseUrl: string;
	systemIds: ReadonlySet<string>;
	sha256?: string | null;
	systemHashes?: ReadonlySet<string>;
}) {
	const id = avatarIdFromUrl(input.url, input.baseUrl);
	if (id && input.systemIds.has(id)) return true;
	if (input.sha256 && input.systemHashes?.has(input.sha256)) return true;
	return !sameOrigin(input.url, input.baseUrl);
}

export function isGenericProjectAvatar(input: {
	url: string | null;
	baseUrl: string;
	sha256?: string | null;
	genericHashes?: ReadonlySet<string>;
}) {
	const id = avatarIdFromUrl(input.url, input.baseUrl);
	if (id && GENERIC_PROJECT_AVATAR_IDS.has(id)) return true;
	if (input.sha256 && input.genericHashes?.has(input.sha256)) return true;
	return !sameOrigin(input.url, input.baseUrl);
}

/**
 * Jira serves its built-in issue type and priority artwork from `/images/icons/`
 * (also below a context path) or from a system avatar id. Everything else on the
 * configured server is a custom icon; a missing, foreign or unreadable address
 * counts as built-in. A null system id list means the list is unavailable, so an
 * icon addressed by avatar id is built-in when in doubt.
 */
export function isBuiltInJiraIcon(input: {
	url: string | null;
	baseUrl: string;
	systemIds?: ReadonlySet<string> | null;
}) {
	if (!sameOrigin(input.url, input.baseUrl)) return true;
	try {
		const parsed = new URL(input.url as string, input.baseUrl);
		if (parsed.pathname.includes("/images/icons/")) return true;
		const id = parsed.searchParams.get("avatarId");
		if (id && (input.systemIds === null || input.systemIds?.has(id))) {
			return true;
		}
		return false;
	} catch {
		return true;
	}
}

interface SystemAvatars {
	ids: Set<string>;
	hashes: () => Promise<Set<string>>;
}

async function loadSystemAvatars(
	client: JiraClient,
	baseUrl: string,
	kind: "user" | "project" | "issuetype",
	onlyIds?: ReadonlySet<string>,
): Promise<SystemAvatars> {
	const response = await client.getJson<{
		system?: { id: string; urls?: Record<string, string> }[];
	}>(`/rest/api/2/avatar/${kind}/system`);
	const ids = new Set<string>();
	const candidates: string[] = [];
	for (const avatar of response.system ?? []) {
		const id = String(avatar.id);
		ids.add(id);
		if (onlyIds && !onlyIds.has(id)) continue;
		const url = largestAvatarUrl(avatar.urls);
		if (url && sameOrigin(url, baseUrl)) candidates.push(url);
	}

	let pending: Promise<Set<string>> | null = null;
	return {
		ids,
		hashes: () => {
			pending ??= (async () => {
				const hashes = new Set<string>();
				for (const url of candidates) {
					const bytes = await client.getBytes(requestPath(url, baseUrl));
					hashes.add(createHash("sha256").update(bytes).digest("hex"));
				}
				return hashes;
			})();
			return pending;
		},
	};
}

async function setTimeZone(userId: string, timeZone: string) {
	const [row] = await db
		.select({ timeZone: userPreferences.timeZone })
		.from(userPreferences)
		.where(eq(userPreferences.userId, userId))
		.limit(1);
	if (row?.timeZone === timeZone) return;
	await db
		.insert(userPreferences)
		.values({ userId, timeZone })
		.onConflictDoUpdate({
			target: userPreferences.userId,
			set: { timeZone, updatedAt: new Date() },
		});
}

async function saveAvatar(
	table: typeof users | typeof projects,
	id: string,
	file: string,
	sourceUrl: string | null,
) {
	if (table === users) {
		await db
			.update(users)
			.set({ avatarFile: file, avatarUrl: sourceUrl, updatedAt: new Date() })
			.where(eq(users.id, id));
	} else {
		await db
			.update(projects)
			.set({ avatarFile: file, avatarUrl: sourceUrl, updatedAt: new Date() })
			.where(eq(projects.id, id));
	}
}

async function saveUserSource(
	id: string,
	sourceUrl: string | null,
	file: string | null,
	avatarsDir: string,
) {
	await db
		.update(users)
		.set({
			avatarUrl: sourceUrl,
			avatarFile: file ? null : undefined,
			updatedAt: new Date(),
		})
		.where(eq(users.id, id));
	if (file) await deleteAvatarFileIfUnused(avatarsDir, file);
}

async function saveProjectSource(id: string, sourceUrl: string | null) {
	await db
		.update(projects)
		.set({ avatarUrl: sourceUrl, updatedAt: new Date() })
		.where(eq(projects.id, id));
}

function addResult(
	counts: AvatarKindCounts,
	previous: string | null,
	file: string,
) {
	if (previous === file) counts.unchanged++;
	else if (previous) counts.updated++;
	else counts.stored++;
}

async function deleteAvatarFileIfUnused(directory: string, file: string) {
	if (!/^[0-9a-f]{64}\.(?:png|jpe?g|webp|gif|svg)$/.test(file)) return;
	const used = await Promise.all([
		db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.avatarFile, file))
			.limit(1)
			.then((rows) => rows.length > 0),
		db
			.select({ id: projects.id })
			.from(projects)
			.where(eq(projects.avatarFile, file))
			.limit(1)
			.then((rows) => rows.length > 0),
		db
			.select({ id: issueTypes.id })
			.from(issueTypes)
			.where(eq(issueTypes.iconFile, file))
			.limit(1)
			.then((rows) => rows.length > 0),
		db
			.select({ id: priorities.id })
			.from(priorities)
			.where(eq(priorities.iconFile, file))
			.limit(1)
			.then((rows) => rows.length > 0),
	]);
	if (used.some(Boolean)) return;

	if (await wikiTablesExist()) {
		const [space] = await db
			.select({ id: spaces.id })
			.from(spaces)
			.where(eq(spaces.iconFile, file))
			.limit(1);
		if (space) return;
	}

	await unlink(join(directory, file)).catch(() => undefined);
}

async function clearStoredIcon(
	table: typeof issueTypes | typeof priorities,
	id: string,
	file: string | null,
	avatarsDir: string,
) {
	if (table === issueTypes) {
		await db
			.update(issueTypes)
			.set({ iconUrl: null, iconFile: null, updatedAt: new Date() })
			.where(eq(issueTypes.id, id));
	} else {
		await db
			.update(priorities)
			.set({ iconFile: null, updatedAt: new Date() })
			.where(eq(priorities.id, id));
	}
	if (file) await deleteAvatarFileIfUnused(avatarsDir, file);
}

async function importJiraUsers(
	client: JiraClient,
	baseUrl: string,
	options: AvatarImportOptions,
	counts: AvatarKindCounts,
	system: SystemAvatars,
) {
	const scope = options.scope?.userIds;
	const rows = await db
		.select({
			id: users.id,
			username: users.username,
			sourceKey: users.sourceKey,
			avatarFile: users.avatarFile,
			avatarUrl: users.avatarUrl,
		})
		.from(users)
		.where(scope ? inArray(users.id, scope) : isNotNull(users.sourceKey));

	for (const row of rows) {
		let detail: JiraUser;
		try {
			detail = await client.getJson<JiraUser>("/rest/api/2/user", {
				username: row.username,
			});
		} catch (error) {
			if ((error as { status?: number }).status === 404) {
				counts.skipped++;
				continue;
			}
			throw error;
		}

		if (detail.timeZone) await setTimeZone(row.id, detail.timeZone);

		const url = largestAvatarUrl(detail.avatarUrls);
		const id = avatarIdFromUrl(url, baseUrl);
		if (!url || !sameOrigin(url, baseUrl) || (id && system.ids.has(id))) {
			if (url !== row.avatarUrl || row.avatarFile) {
				await saveUserSource(row.id, url, row.avatarFile, options.avatarsDir);
			}
			counts.skipped++;
			continue;
		}

		if (row.avatarFile && row.avatarUrl === null) {
			counts.unchanged++;
			continue;
		}
		if (row.avatarFile && row.avatarUrl === url) {
			counts.unchanged++;
			continue;
		}

		let bytes: Buffer;
		try {
			bytes = await client.getBytes(requestPath(url, baseUrl));
		} catch {
			counts.failed++;
			continue;
		}
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		if (
			isDefaultUserAvatar({
				url,
				baseUrl,
				systemIds: system.ids,
				sha256,
				systemHashes: await system.hashes(),
			})
		) {
			if (url !== row.avatarUrl || row.avatarFile) {
				await saveUserSource(row.id, url, row.avatarFile, options.avatarsDir);
			}
			counts.skipped++;
			continue;
		}

		const stored = await storeAvatarFile(options.avatarsDir, bytes);
		if (!stored) {
			counts.failed++;
			continue;
		}
		if (row.avatarFile === stored.file && row.avatarUrl === url) {
			counts.unchanged++;
			continue;
		}
		await saveAvatar(users, row.id, stored.file, url);
		addResult(counts, row.avatarFile, stored.file);
	}
}

async function importJiraProjects(
	client: JiraClient,
	baseUrl: string,
	options: AvatarImportOptions,
	counts: AvatarKindCounts,
	system: SystemAvatars,
) {
	const scope = options.scope?.projectIds;
	const rows = await db
		.select({
			id: projects.id,
			key: projects.key,
			avatarFile: projects.avatarFile,
			avatarUrl: projects.avatarUrl,
		})
		.from(projects)
		.where(scope ? inArray(projects.id, scope) : undefined);

	for (const row of rows) {
		let detail: { avatarUrls?: Record<string, string> };
		try {
			detail = await client.getJson(
				`/rest/api/2/project/${encodeURIComponent(row.key)}`,
			);
		} catch (error) {
			if ((error as { status?: number }).status === 404) {
				counts.skipped++;
				continue;
			}
			throw error;
		}
		const url = largestAvatarUrl(detail.avatarUrls);
		if (!url || isGenericProjectAvatar({ url, baseUrl })) {
			if (url !== row.avatarUrl) await saveProjectSource(row.id, url);
			counts.skipped++;
			continue;
		}
		if (row.avatarFile && row.avatarUrl === url) {
			counts.unchanged++;
			continue;
		}
		let bytes: Buffer;
		try {
			bytes = await client.getBytes(requestPath(url, baseUrl));
		} catch {
			counts.failed++;
			continue;
		}
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		if (
			isGenericProjectAvatar({
				url,
				baseUrl,
				sha256,
				genericHashes: await system.hashes(),
			})
		) {
			if (url !== row.avatarUrl) await saveProjectSource(row.id, url);
			counts.skipped++;
			continue;
		}
		const stored = await storeAvatarFile(options.avatarsDir, bytes);
		if (!stored) {
			counts.failed++;
			continue;
		}
		if (row.avatarFile === stored.file && row.avatarUrl === url) {
			counts.unchanged++;
			continue;
		}
		await saveAvatar(projects, row.id, stored.file, url);
		addResult(counts, row.avatarFile, stored.file);
	}
}

async function importJiraIssueTypes(
	client: JiraClient,
	baseUrl: string,
	options: AvatarImportOptions,
	counts: AvatarKindCounts,
	systemIds: ReadonlySet<string> | null,
) {
	const remote = await client.getJson<JiraIssueType[]>("/rest/api/2/issuetype");
	const wanted = new Set(remote.map((item) => item.id));
	const rows = await db
		.select({
			id: issueTypes.id,
			sourceId: issueTypes.sourceId,
			iconUrl: issueTypes.iconUrl,
			iconFile: issueTypes.iconFile,
		})
		.from(issueTypes)
		.where(
			options.scope?.issueTypeIds
				? inArray(issueTypes.id, options.scope.issueTypeIds)
				: inArray(issueTypes.sourceId, [...wanted]),
		);
	const bySource = new Map(rows.map((row) => [row.sourceId, row]));

	for (const item of remote) {
		const row = bySource.get(item.id);
		if (!row) continue;
		const url = item.iconUrl ?? null;
		if (isBuiltInJiraIcon({ url, baseUrl, systemIds })) {
			if (row.iconFile || row.iconUrl !== null) {
				await clearStoredIcon(
					issueTypes,
					row.id,
					row.iconFile,
					options.avatarsDir,
				);
			}
			counts.skipped++;
			continue;
		}
		if (row.iconFile && row.iconUrl === url) {
			counts.unchanged++;
			continue;
		}
		if (!url) {
			counts.skipped++;
			continue;
		}
		let bytes: Buffer;
		try {
			bytes = await client.getBytes(requestPath(url, baseUrl));
		} catch {
			counts.failed++;
			continue;
		}
		const stored = await storeAvatarFile(options.avatarsDir, bytes);
		if (!stored) {
			counts.failed++;
			continue;
		}
		if (row.iconFile === stored.file && row.iconUrl === url) {
			counts.unchanged++;
			continue;
		}
		await db
			.update(issueTypes)
			.set({ iconUrl: url, iconFile: stored.file, updatedAt: new Date() })
			.where(eq(issueTypes.id, row.id));
		if (row.iconFile && row.iconFile !== stored.file) {
			await deleteAvatarFileIfUnused(options.avatarsDir, row.iconFile);
		}
		addResult(counts, row.iconFile, stored.file);
	}
}

async function importJiraPriorities(
	client: JiraClient,
	baseUrl: string,
	options: AvatarImportOptions,
	counts: AvatarKindCounts,
) {
	const remote = await client.getJson<JiraPriority[]>("/rest/api/2/priority");
	const wanted = new Set(remote.map((item) => item.id));
	const rows = await db
		.select({
			id: priorities.id,
			sourceId: priorities.sourceId,
			iconFile: priorities.iconFile,
		})
		.from(priorities)
		.where(
			options.scope?.priorityIds
				? inArray(priorities.id, options.scope.priorityIds)
				: inArray(priorities.sourceId, [...wanted]),
		);
	const bySource = new Map(rows.map((row) => [row.sourceId, row]));

	for (const item of remote) {
		const row = bySource.get(item.id);
		if (!row) continue;
		const url = item.iconUrl ?? null;
		if (isBuiltInJiraIcon({ url, baseUrl })) {
			if (row.iconFile) {
				await clearStoredIcon(
					priorities,
					row.id,
					row.iconFile,
					options.avatarsDir,
				);
			}
			counts.skipped++;
			continue;
		}
		if (row.iconFile) {
			counts.unchanged++;
			continue;
		}
		if (!url) {
			counts.skipped++;
			continue;
		}
		let bytes: Buffer;
		try {
			bytes = await client.getBytes(requestPath(url, baseUrl));
		} catch {
			counts.failed++;
			continue;
		}
		const stored = await storeAvatarFile(options.avatarsDir, bytes);
		if (!stored) {
			counts.failed++;
			continue;
		}
		await db
			.update(priorities)
			.set({ iconFile: stored.file, updatedAt: new Date() })
			.where(eq(priorities.id, row.id));
		if (row.iconFile && row.iconFile !== stored.file) {
			await deleteAvatarFileIfUnused(options.avatarsDir, row.iconFile);
		}
		addResult(counts, row.iconFile, stored.file);
	}
}

export async function importJiraAvatars(
	client: JiraClient,
	options: AvatarImportOptions,
): Promise<AvatarImportCounts> {
	const baseUrl = options.baseUrl;
	const counts = emptyAvatarImportCounts();
	const [userSystem, projectSystem, issueTypeSystemIds] = await Promise.all([
		loadSystemAvatars(client, baseUrl, "user"),
		loadSystemAvatars(client, baseUrl, "project", GENERIC_PROJECT_AVATAR_IDS),
		loadSystemAvatars(client, baseUrl, "issuetype")
			.then((system) => system.ids)
			.catch(() => null),
	]);
	await importJiraUsers(client, baseUrl, options, counts.users, userSystem);
	await importJiraProjects(
		client,
		baseUrl,
		options,
		counts.projects,
		projectSystem,
	);
	await importJiraIssueTypes(
		client,
		baseUrl,
		options,
		counts.issueTypes,
		issueTypeSystemIds,
	);
	await importJiraPriorities(client, baseUrl, options, counts.priorities);
	return counts;
}

function defaultConfluencePicture(path: string | null | undefined) {
	if (!path) return true;
	return /(?:^|\/)default(?:-space-logo|-space-logo-large)?\.(?:svg|png)$/i.test(
		path,
	);
}

async function importConfluenceSpaces(
	client: ConfluenceClient,
	baseUrl: string,
	options: AvatarImportOptions,
	counts: AvatarKindCounts,
) {
	if (!(await wikiTablesExist())) return;
	const scope = options.scope?.spaceIds;
	const rows = await db
		.select({
			id: spaces.id,
			key: spaces.key,
			iconPath: spaces.iconPath,
			iconFile: spaces.iconFile,
		})
		.from(spaces)
		.where(scope ? inArray(spaces.id, scope) : undefined);

	for (const row of rows) {
		if (defaultConfluencePicture(row.iconPath)) {
			counts.skipped++;
			continue;
		}
		if (row.iconFile) {
			counts.unchanged++;
			continue;
		}
		let bytes: Buffer;
		try {
			bytes = await client.getBytes(
				requestPath(row.iconPath as string, baseUrl),
			);
		} catch {
			counts.failed++;
			continue;
		}
		const stored = await storeAvatarFile(options.avatarsDir, bytes);
		if (!stored) {
			counts.failed++;
			continue;
		}
		await db
			.update(spaces)
			.set({ iconFile: stored.file, updatedAt: new Date() })
			.where(eq(spaces.id, row.id));
		addResult(counts, row.iconFile, stored.file);
	}
}

async function importConfluenceUsers(
	client: ConfluenceClient,
	baseUrl: string,
	options: AvatarImportOptions,
	counts: AvatarKindCounts,
) {
	const directory = await client.listUsers();
	const scope = options.scope?.userIds;
	const rows = await db
		.select({
			id: users.id,
			username: users.username,
			sourceKey: users.sourceKey,
			avatarFile: users.avatarFile,
		})
		.from(users)
		.where(scope ? inArray(users.id, scope) : isNotNull(users.sourceKey));
	const bySource = new Map<string, (typeof rows)[number]>();
	const byUsername = new Map<string, (typeof rows)[number]>();
	for (const row of rows) {
		if (row.sourceKey) bySource.set(row.sourceKey, row);
		byUsername.set(row.username.toLowerCase(), row);
	}

	for (const user of directory) {
		const key = user.userKey ?? user.username ?? "";
		const row =
			bySource.get(key) ??
			(user.username ? byUsername.get(user.username.toLowerCase()) : undefined);
		if (!row) continue;
		if (row.avatarFile) {
			counts.unchanged++;
			continue;
		}
		const path = user.profilePicture?.path ?? null;
		if (
			!path ||
			user.profilePicture?.isDefault === true ||
			defaultConfluencePicture(path)
		) {
			counts.skipped++;
			continue;
		}
		if (!sameOrigin(path, baseUrl)) {
			counts.skipped++;
			continue;
		}
		let bytes: Buffer;
		try {
			bytes = await client.getBytes(requestPath(path, baseUrl));
		} catch {
			counts.failed++;
			continue;
		}
		const stored = await storeAvatarFile(options.avatarsDir, bytes);
		if (!stored) {
			counts.failed++;
			continue;
		}
		await db
			.update(users)
			.set({ avatarFile: stored.file, updatedAt: new Date() })
			.where(eq(users.id, row.id));
		addResult(counts, row.avatarFile, stored.file);
	}
}

export async function importConfluenceAvatars(
	client: ConfluenceClient,
	options: AvatarImportOptions,
): Promise<AvatarImportCounts> {
	const baseUrl = options.baseUrl;
	const counts = emptyAvatarImportCounts();
	if (!(await wikiTablesExist())) return counts;
	await importConfluenceSpaces(client, baseUrl, options, counts.spaces);
	await importConfluenceUsers(client, baseUrl, options, counts.confluenceUsers);
	return counts;
}

async function wikiTablesExist() {
	const result = await db.execute(
		"select to_regclass('public.spaces') is not null as present",
	);
	return Boolean(
		(result.rows[0] as { present?: boolean } | undefined)?.present,
	);
}

export function printAvatarCounts(counts: AvatarImportCounts) {
	for (const [kind, value] of Object.entries(counts)) {
		console.log(
			`${kind}: stored=${value.stored} updated=${value.updated} unchanged=${value.unchanged} skipped=${value.skipped} failed=${value.failed}`,
		);
	}
}
