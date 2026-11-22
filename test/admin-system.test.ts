import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { audit } from "../src/lib/server/admin/audit.ts";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	attachments,
	issues,
	issueTypes,
	priorities,
	projects,
	statuses,
} from "../src/lib/server/schema.ts";
import { appSettings, auditLog } from "../src/lib/server/schema-admin.ts";
import {
	defaultIssueTypeKey,
	readSettingValues,
	readSiteSettings,
	settingKeys,
	siteTitleKey,
} from "../src/lib/server/site.ts";
import { injectAs, makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import { buildServer, cleanupTestData, swapTransaction } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = newRun();
const tag = `t-${run}`;
const auditTag = `${tag}-audit`;
const pagedToken = `paged${run}`;
const projectKey = `S${run.slice(0, 6).toUpperCase()}`;

let app: TestApp;
let admin: TestUser;
let member: TestUser;
let issueTypeId: string;
let subtaskTypeId: string;
let priorityId: string;
let projectId: string;
let issueId: string;

const originalSettings = new Map<string, unknown>();

function json<T = Record<string, unknown>>(response: { body: string }): T {
	return JSON.parse(response.body) as T;
}

function swapSelect(next: typeof db.select) {
	const target = db as unknown as { select: typeof db.select };
	const previous = target.select;
	target.select = next;
	return () => {
		target.select = previous;
	};
}

type ThenableQuery = {
	then: (
		onFulfilled?: (value: unknown) => unknown,
		onRejected?: (reason: unknown) => unknown,
	) => unknown;
};

function isAuditSelect(args: unknown[]) {
	const fields = args[0];
	return (
		typeof fields === "object" &&
		fields !== null &&
		"createdAt" in fields &&
		"summary" in fields
	);
}

function insertBetweenPages(
	query: ThenableQuery,
	state: { pages: number; inserted: boolean },
	insert: () => Promise<void>,
): ThenableQuery {
	if (state.pages++ > 0) return query;
	return wrapThenable(query, state, insert);
}

function wrapThenable(
	query: ThenableQuery,
	state: { pages: number; inserted: boolean },
	insert: () => Promise<void>,
): ThenableQuery {
	return new Proxy(query, {
		get(target, property, receiver) {
			if (property === "then") {
				const then = target.then.bind(target);
				return (
					onFulfilled?: (value: unknown) => unknown,
					onRejected?: (reason: unknown) => unknown,
				) =>
					then(async (value) => {
						if (!state.inserted) {
							state.inserted = true;
							await insert();
						}
						return onFulfilled?.(value);
					}, onRejected);
			}
			const value = Reflect.get(target, property, receiver);
			if (typeof value !== "function") return value;
			return (...args: unknown[]) => {
				const result = value.apply(target, args);
				if (result === target) return receiver;
				if (
					typeof result === "object" &&
					result !== null &&
					typeof (result as ThenableQuery).then === "function"
				) {
					return wrapThenable(result as ThenableQuery, state, insert);
				}
				return result;
			};
		},
	});
}

function actorOf(user: TestUser, label: string): CurrentUser {
	return {
		id: user.id,
		username: user.username,
		displayName: `Test ${label} ${run}`,
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin: label === "admin",
		mustChangePassword: false,
		hasPassword: false,
	};
}

async function mySettingsRows() {
	return db
		.select()
		.from(auditLog)
		.where(eq(auditLog.action, "settings.update"))
		.orderBy(auditLog.createdAt, auditLog.id);
}

async function restoreSettings() {
	await db
		.delete(appSettings)
		.where(inArray(appSettings.key, [...settingKeys]));
	for (const [key, value] of originalSettings) {
		await db.insert(appSettings).values({ key, value });
	}
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	await app.ready();
	admin = await makeUser(run, "admin", { admin: true });
	member = await makeUser(run, "member");

	for (const [key, value] of await readSettingValues()) {
		originalSettings.set(key, value);
	}

	const [type] = await db
		.insert(issueTypes)
		.values({ sourceId: `${tag}-type`, name: `Test type ${run}` })
		.returning({ id: issueTypes.id });
	issueTypeId = type.id;

	const [subtask] = await db
		.insert(issueTypes)
		.values({
			sourceId: `${tag}-subtask`,
			name: `Test sub-task ${run}`,
			subtask: true,
		})
		.returning({ id: issueTypes.id });
	subtaskTypeId = subtask.id;

	const [priority] = await db
		.insert(priorities)
		.values({ sourceId: `${tag}-priority`, name: `Test priority ${run}` })
		.returning({ id: priorities.id });
	priorityId = priority.id;

	const [status] = await db
		.insert(statuses)
		.values({
			sourceId: `${tag}-status`,
			name: `Test status ${run}`,
			category: "new",
		})
		.returning({ id: statuses.id });

	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `${tag}-project`,
			key: projectKey,
			name: `Test project ${run}`,
			projectType: "software",
		})
		.returning({ id: projects.id });
	projectId = project.id;

	const [issue] = await db
		.insert(issues)
		.values({
			sourceId: `${tag}-issue`,
			projectId,
			number: 1,
			key: `${projectKey}-1`,
			typeId: issueTypeId,
			statusId: status.id,
			summary: `Test issue ${run}`,
		})
		.returning({ id: issues.id });
	issueId = issue.id;

	await db.insert(attachments).values({
		sourceId: `${tag}-attachment`,
		issueId,
		fileName: "note.txt",
		mimeType: "text/plain",
		size: 1234,
		storagePath: `/tmp/${tag}/note.txt`,
		sha256: "0".repeat(64),
	});
});

afterAll(async () => {
	await db.delete(projects).where(eq(projects.id, projectId));
	await db
		.delete(issueTypes)
		.where(inArray(issueTypes.sourceId, [`${tag}-type`, `${tag}-subtask`]));
	await db.delete(priorities).where(eq(priorities.sourceId, `${tag}-priority`));
	await db.delete(statuses).where(eq(statuses.sourceId, `${tag}-status`));
	await restoreSettings();
	await pool.query(
		"delete from audit_log where action like $1 or actor_id in (select id from users where username like $2)",
		[`${tag}%`, `${tag}-%`],
	);
	await app.close();
	await cleanupTestData(run);
});

describe("general configuration", () => {
	test("returns the settings shape with the base URL from APP_URL", async () => {
		const response = await injectAs(
			app,
			admin.session,
			"GET",
			"/api/admin/settings",
		);
		expect(response.statusCode).toBe(200);
		const body = json(response);
		expect(Object.keys(body).sort()).toEqual([
			"baseUrl",
			"defaultIssueTypeId",
			"defaultPriorityId",
			"title",
		]);
		expect(body.baseUrl).toBe("http://127.0.0.1:3000");
		expect(typeof body.title).toBe("string");
	});

	test("round trips the title and both defaults", async () => {
		const title = `Team ${run}`;
		const save = await injectAs(
			app,
			admin.session,
			"PUT",
			"/api/admin/settings",
			{
				title,
				defaultIssueTypeId: issueTypeId,
				defaultPriorityId: priorityId,
			},
		);
		expect(save.statusCode).toBe(200);
		expect(json(save).title).toBe(title);

		const site = await injectAs(app, member.session, "GET", "/api/site");
		expect(site.statusCode).toBe(200);
		expect(json(site)).toEqual({
			title,
			baseUrl: "http://127.0.0.1:3000",
			defaultIssueTypeId: issueTypeId,
			defaultPriorityId: priorityId,
		});

		const stored = await readSettingValues();
		expect(stored.get(siteTitleKey)).toBe(title);
	});

	test("trims the title", async () => {
		const response = await injectAs(
			app,
			admin.session,
			"PUT",
			"/api/admin/settings",
			{
				title: `  Spaced ${run}  `,
				defaultIssueTypeId: null,
				defaultPriorityId: null,
			},
		);
		expect(response.statusCode).toBe(200);
		expect(json(response).title).toBe(`Spaced ${run}`);
	});

	test("rejects a blank title and a title over 100 characters", async () => {
		const blank = await injectAs(
			app,
			admin.session,
			"PUT",
			"/api/admin/settings",
			{
				title: "   ",
				defaultIssueTypeId: null,
				defaultPriorityId: null,
			},
		);
		expect(blank.statusCode).toBe(400);

		const long = await injectAs(
			app,
			admin.session,
			"PUT",
			"/api/admin/settings",
			{
				title: "x".repeat(101),
				defaultIssueTypeId: null,
				defaultPriorityId: null,
			},
		);
		expect(long.statusCode).toBe(400);
	});

	test("rejects unknown ids and a sub-task default", async () => {
		const unknownType = await injectAs(
			app,
			admin.session,
			"PUT",
			"/api/admin/settings",
			{
				title: `Team ${run}`,
				defaultIssueTypeId: "00000000-0000-4000-8000-000000000000",
				defaultPriorityId: null,
			},
		);
		expect(unknownType.statusCode).toBe(400);
		expect(json<{ error: string }>(unknownType).error).toContain("issue type");

		const unknownPriority = await injectAs(
			app,
			admin.session,
			"PUT",
			"/api/admin/settings",
			{
				title: `Team ${run}`,
				defaultIssueTypeId: null,
				defaultPriorityId: "00000000-0000-4000-8000-000000000000",
			},
		);
		expect(unknownPriority.statusCode).toBe(400);
		expect(json<{ error: string }>(unknownPriority).error).toContain(
			"priority",
		);

		const subtask = await injectAs(
			app,
			admin.session,
			"PUT",
			"/api/admin/settings",
			{
				title: `Team ${run}`,
				defaultIssueTypeId: subtaskTypeId,
				defaultPriorityId: null,
			},
		);
		expect(subtask.statusCode).toBe(400);
		expect(json<{ error: string }>(subtask).error).toBe(
			"The default issue type cannot be a sub-task",
		);
	});

	test("a stored default that became a sub-task falls back to null", async () => {
		const [existing] = await db
			.select()
			.from(appSettings)
			.where(eq(appSettings.key, defaultIssueTypeKey));
		try {
			await db
				.insert(appSettings)
				.values({ key: defaultIssueTypeKey, value: subtaskTypeId })
				.onConflictDoUpdate({
					target: appSettings.key,
					set: { value: subtaskTypeId, updatedAt: new Date() },
				});

			const settings = await readSiteSettings();
			expect(settings.defaultIssueTypeId).toBeNull();
		} finally {
			if (existing) {
				await db
					.update(appSettings)
					.set({ value: existing.value, updatedAt: existing.updatedAt })
					.where(eq(appSettings.key, defaultIssueTypeKey));
			} else {
				await db
					.delete(appSettings)
					.where(eq(appSettings.key, defaultIssueTypeKey));
			}
		}
	});

	test("writes one audit row with only the changed keys", async () => {
		await injectAs(app, admin.session, "PUT", "/api/admin/settings", {
			title: `First ${run}`,
			defaultIssueTypeId: issueTypeId,
			defaultPriorityId: priorityId,
		});

		const before = await mySettingsRows();
		const save = await injectAs(
			app,
			admin.session,
			"PUT",
			"/api/admin/settings",
			{
				title: `Second ${run}`,
				defaultIssueTypeId: issueTypeId,
				defaultPriorityId: priorityId,
			},
		);
		expect(save.statusCode).toBe(200);

		const after = await mySettingsRows();
		expect(after.length).toBe(before.length + 1);
		const row = after[after.length - 1];
		expect(row.action).toBe("settings.update");
		expect(row.entityType).toBe("settings");
		expect(row.actorId).toBe(admin.id);
		expect(row.summary).toContain("general configuration");
		const changes = row.changes as {
			from: Record<string, unknown>;
			to: Record<string, unknown>;
		};
		expect(Object.keys(changes.from)).toEqual(["title"]);
		expect(Object.keys(changes.to)).toEqual(["title"]);
		expect(changes.from.title).toBe(`First ${run}`);
		expect(changes.to.title).toBe(`Second ${run}`);
	});

	test("does not write an audit row when nothing changed", async () => {
		await injectAs(app, admin.session, "PUT", "/api/admin/settings", {
			title: `Same ${run}`,
			defaultIssueTypeId: issueTypeId,
			defaultPriorityId: priorityId,
		});
		const before = await mySettingsRows();
		const save = await injectAs(
			app,
			admin.session,
			"PUT",
			"/api/admin/settings",
			{
				title: `Same ${run}`,
				defaultIssueTypeId: issueTypeId,
				defaultPriorityId: priorityId,
			},
		);
		expect(save.statusCode).toBe(200);
		expect((await mySettingsRows()).length).toBe(before.length);
	});

	test("keeps no settings row for a cleared default", async () => {
		await injectAs(app, admin.session, "PUT", "/api/admin/settings", {
			title: `Cleared ${run}`,
			defaultIssueTypeId: issueTypeId,
			defaultPriorityId: priorityId,
		});
		await injectAs(app, admin.session, "PUT", "/api/admin/settings", {
			title: `Cleared ${run}`,
			defaultIssueTypeId: null,
			defaultPriorityId: null,
		});
		const values = await readSettingValues();
		expect(values.has("site.defaultIssueTypeId")).toBe(false);
		expect(values.has("site.defaultPriorityId")).toBe(false);
	});

	test("serves the site settings to a non-admin and refuses anonymous", async () => {
		await injectAs(app, admin.session, "PUT", "/api/admin/settings", {
			title: `Public ${run}`,
			defaultIssueTypeId: null,
			defaultPriorityId: null,
		});
		const memberResponse = await injectAs(
			app,
			member.session,
			"GET",
			"/api/site",
		);
		expect(memberResponse.statusCode).toBe(200);
		expect(json(memberResponse).title).toBe(`Public ${run}`);

		const anonymous = await injectAs(app, null, "GET", "/api/site");
		expect(anonymous.statusCode).toBe(401);
	});

	test("keeps a concurrent edit to a key this request does not change", async () => {
		const title = `Race ${run}`;
		await injectAs(app, admin.session, "PUT", "/api/admin/settings", {
			title,
			defaultIssueTypeId: issueTypeId,
			defaultPriorityId: null,
		});

		const client = await pool.connect();
		try {
			await client.query("begin");
			await client.query(
				"update app_settings set value = $1::jsonb where key = $2",
				[JSON.stringify("concurrent"), siteTitleKey],
			);
			const pending = injectAs(
				app,
				admin.session,
				"PUT",
				"/api/admin/settings",
				{
					title,
					defaultIssueTypeId: null,
					defaultPriorityId: null,
				},
			);
			await new Promise((resolve) => setTimeout(resolve, 300));
			await client.query("commit");
			const response = await pending;
			expect(response.statusCode).toBe(200);
		} finally {
			client.release();
		}

		const [row] = await db
			.select({ value: appSettings.value })
			.from(appSettings)
			.where(eq(appSettings.key, siteTitleKey));
		expect(row?.value).toBe("concurrent");
	});

	test("falls back to RVNA for a blank stored title", async () => {
		await db
			.insert(appSettings)
			.values({ key: siteTitleKey, value: "   " })
			.onConflictDoUpdate({
				target: appSettings.key,
				set: { value: "   " },
			});
		const response = await injectAs(app, admin.session, "GET", "/api/site");
		expect(json(response).title).toBe("RVNA");
	});

	test("returns null defaults once the referenced rows are gone", async () => {
		const [tempType] = await db
			.insert(issueTypes)
			.values({ sourceId: `${tag}-temp-type`, name: `Temp ${run}` })
			.returning({ id: issueTypes.id });
		const [tempPriority] = await db
			.insert(priorities)
			.values({ sourceId: `${tag}-temp-priority`, name: `Temp ${run}` })
			.returning({ id: priorities.id });

		await injectAs(app, admin.session, "PUT", "/api/admin/settings", {
			title: `Dangling ${run}`,
			defaultIssueTypeId: tempType.id,
			defaultPriorityId: tempPriority.id,
		});
		const before = json(await injectAs(app, admin.session, "GET", "/api/site"));
		expect(before.defaultIssueTypeId).toBe(tempType.id);
		expect(before.defaultPriorityId).toBe(tempPriority.id);

		await db.delete(issueTypes).where(eq(issueTypes.id, tempType.id));
		await db.delete(priorities).where(eq(priorities.id, tempPriority.id));

		const after = json(await injectAs(app, admin.session, "GET", "/api/site"));
		expect(after.defaultIssueTypeId).toBe(null);
		expect(after.defaultPriorityId).toBe(null);
	});
});

describe("audit log", () => {
	beforeAll(async () => {
		const rows = [
			{
				action: `${auditTag}.create`,
				entityType: `${auditTag}-project`,
				summary: `Created ${auditTag} widget`,
			},
			{
				action: `${auditTag}.update`,
				entityType: `${auditTag}-project`,
				summary: `Updated ${auditTag} widget`,
			},
			{
				action: `${auditTag}.delete`,
				entityType: `${auditTag}-user`,
				summary: `Deleted ${auditTag} widget, with a comma`,
			},
			{
				action: `${auditTag}.formula1`,
				entityType: `${auditTag}-project`,
				summary: `=HYPERLINK("${auditTag}")`,
			},
			{
				action: `${auditTag}.formula2`,
				entityType: `${auditTag}-project`,
				summary: `+${auditTag}`,
			},
			{
				action: `${auditTag}.formula3`,
				entityType: `${auditTag}-project`,
				summary: `-${auditTag}`,
			},
			{
				action: `${auditTag}.formula4`,
				entityType: `${auditTag}-project`,
				summary: `@${auditTag}`,
			},
		];
		for (const row of rows) {
			await audit(db, actorOf(admin, "admin"), {
				...row,
				entityId: null,
				changes: { from: { title: "before" }, to: { title: "after" } },
			});
		}

		await audit(db, actorOf(member, "member"), {
			action: `${auditTag}.member`,
			entityType: `${auditTag}-project`,
			entityId: null,
			summary: `Member ${auditTag} action`,
		});

		for (let index = 1; index <= 5; index += 1) {
			await new Promise((resolve) => setTimeout(resolve, 5));
			await audit(db, actorOf(admin, "admin"), {
				action: `${auditTag}.paged${index}`,
				entityType: `${auditTag}-project`,
				entityId: null,
				summary: `${pagedToken} item ${index}`,
			});
		}
	});

	test("lists my rows newest first", async () => {
		const response = await injectAs(
			app,
			admin.session,
			"GET",
			`/api/admin/audit?query=${pagedToken}`,
		);
		expect(response.statusCode).toBe(200);
		const body = json<{ entries: { createdAt: string }[]; total: number }>(
			response,
		);
		expect(body.total).toBe(5);
		expect(body.entries).toHaveLength(5);
		const times = body.entries.map((entry) =>
			new Date(entry.createdAt).getTime(),
		);
		expect(times).toEqual([...times].sort((a, b) => b - a));
	});

	test("pages through the rows it matched", async () => {
		const first = json<{ entries: { id: string }[]; total: number }>(
			await injectAs(
				app,
				admin.session,
				"GET",
				`/api/admin/audit?query=${pagedToken}&limit=2`,
			),
		);
		expect(first.total).toBe(5);
		expect(first.entries).toHaveLength(2);

		const second = json<{ entries: { id: string }[] }>(
			await injectAs(
				app,
				admin.session,
				"GET",
				`/api/admin/audit?query=${pagedToken}&limit=2&offset=2`,
			),
		);
		expect(second.entries).toHaveLength(2);
		const firstIds = first.entries.map((entry) => entry.id);
		expect(second.entries.some((entry) => firstIds.includes(entry.id))).toBe(
			false,
		);

		const third = json<{ entries: { id: string }[] }>(
			await injectAs(
				app,
				admin.session,
				"GET",
				`/api/admin/audit?query=${pagedToken}&limit=2&offset=4`,
			),
		);
		expect(third.entries).toHaveLength(1);
	});

	test("filters by actor id and by actor name", async () => {
		const byId = json<{ total: number }>(
			await injectAs(
				app,
				admin.session,
				"GET",
				`/api/admin/audit?action=${auditTag}*&actor=${member.id}`,
			),
		);
		expect(byId.total).toBe(1);

		const byName = json<{
			total: number;
			entries: { actor: { id: string } }[];
		}>(
			await injectAs(
				app,
				admin.session,
				"GET",
				`/api/admin/audit?action=${auditTag}*&actor=${encodeURIComponent(
					`Test member ${run}`,
				)}`,
			),
		);
		expect(byName.total).toBe(1);
		expect(byName.entries[0].actor.id).toBe(member.id);
	});

	test("matches an exact action and an action prefix", async () => {
		const exact = json<{ total: number }>(
			await injectAs(
				app,
				admin.session,
				"GET",
				`/api/admin/audit?action=${auditTag}.create`,
			),
		);
		expect(exact.total).toBe(1);

		const prefix = json<{ total: number }>(
			await injectAs(
				app,
				admin.session,
				"GET",
				`/api/admin/audit?action=${auditTag}.paged*`,
			),
		);
		expect(prefix.total).toBe(5);
	});

	test("filters by entity type", async () => {
		const users = json<{ total: number; entries: { entityType: string }[] }>(
			await injectAs(
				app,
				admin.session,
				"GET",
				`/api/admin/audit?action=${auditTag}*&entityType=${auditTag}-user`,
			),
		);
		expect(users.total).toBe(1);
		expect(users.entries[0].entityType).toBe(`${auditTag}-user`);
	});

	test("the audit filters have supporting indexes", async () => {
		const result = await pool.query<{ indexname: string }>(
			"select indexname from pg_indexes where tablename = 'audit_log'",
		);
		const names = result.rows.map((row) => row.indexname);
		expect(names).toContain("audit_log_entity_type_idx");
		expect(names).toContain("audit_log_actor_id_idx");
	});

	test("filters by a date range", async () => {
		const now = Date.now();
		const past = new Date(now - 60 * 60 * 1000).toISOString();
		const future = new Date(now + 60 * 60 * 1000).toISOString();

		const inside = json<{ total: number }>(
			await injectAs(
				app,
				admin.session,
				"GET",
				`/api/admin/audit?action=${auditTag}*&from=${past}&to=${future}`,
			),
		);
		expect(inside.total).toBeGreaterThanOrEqual(13);

		const futureOnly = json<{ total: number }>(
			await injectAs(
				app,
				admin.session,
				"GET",
				`/api/admin/audit?action=${auditTag}*&from=${future}`,
			),
		);
		expect(futureOnly.total).toBe(0);

		const pastOnly = json<{ total: number }>(
			await injectAs(
				app,
				admin.session,
				"GET",
				`/api/admin/audit?action=${auditTag}*&to=${past}`,
			),
		);
		expect(pastOnly.total).toBe(0);

		const today = new Date(now).toISOString().slice(0, 10);
		const dayOnly = json<{ total: number }>(
			await injectAs(
				app,
				admin.session,
				"GET",
				`/api/admin/audit?action=${auditTag}*&from=${today}`,
			),
		);
		expect(dayOnly.total).toBeGreaterThanOrEqual(13);
	});

	test("treats a date-only range as whole days", async () => {
		const action = `${auditTag}.boundary`;
		const row = (createdAt: string, summary: string) => ({
			createdAt: new Date(createdAt),
			actorName: `Test admin ${run}`,
			action,
			entityType: `${auditTag}-project`,
			entityId: null,
			summary,
		});
		await db
			.insert(auditLog)
			.values([
				row("2026-01-31T10:00:00Z", "inside the UTC day"),
				row("2026-01-31T23:30:00Z", "late in the UTC day"),
				row("2026-02-01T00:30:00Z", "after the UTC day"),
			]);
		const wholeDay = await app.inject({
			method: "GET",
			url: `/api/admin/audit?action=${action}&from=2026-01-31&to=2026-01-31`,
			cookies: { sid: admin.session, tz: "UTC" },
			headers: { "x-requested-with": "rvna" },
		});
		expect(wholeDay.statusCode).toBe(200);
		expect(json<{ total: number }>(wholeDay).total).toBe(2);

		await db
			.insert(auditLog)
			.values(row("2026-01-31T05:00:00Z", "previous day in Los Angeles"));
		const localDay = await app.inject({
			method: "GET",
			url: `/api/admin/audit?action=${action}&from=2026-01-31`,
			cookies: { sid: admin.session, tz: "America/Los_Angeles" },
			headers: { "x-requested-with": "rvna" },
		});
		expect(localDay.statusCode).toBe(200);
		expect(json<{ total: number }>(localDay).total).toBe(3);
	});

	test("rejects an unparsable date", async () => {
		const response = await injectAs(
			app,
			admin.session,
			"GET",
			"/api/admin/audit?from=yesterday",
		);
		expect(response.statusCode).toBe(400);
	});

	test("searches the summary and escapes LIKE wildcards", async () => {
		const match = json<{ total: number }>(
			await injectAs(
				app,
				admin.session,
				"GET",
				`/api/admin/audit?query=${encodeURIComponent(`${auditTag} widget`)}`,
			),
		);
		expect(match.total).toBe(3);

		for (const wildcard of ["%", "_"]) {
			const escaped = json<{ total: number }>(
				await injectAs(
					app,
					admin.session,
					"GET",
					`/api/admin/audit?action=${auditTag}*&query=${encodeURIComponent(
						wildcard,
					)}`,
				),
			);
			expect(escaped.total).toBe(0);
		}
	});

	test("caps the page size at 200", async () => {
		const bulkTag = `${tag}-bulk`;
		for (let index = 0; index < 205; index += 1) {
			await audit(db, actorOf(admin, "admin"), {
				action: `${bulkTag}.create`,
				entityType: bulkTag,
				entityId: null,
				summary: `Bulk ${index}`,
			});
		}
		const response = json<{ entries: unknown[]; total: number }>(
			await injectAs(
				app,
				admin.session,
				"GET",
				`/api/admin/audit?action=${bulkTag}*&limit=500`,
			),
		);
		expect(response.total).toBe(205);
		expect(response.entries).toHaveLength(200);
	});

	test("lists the filter options", async () => {
		const response = await injectAs(
			app,
			admin.session,
			"GET",
			"/api/admin/audit/filters",
		);
		expect(response.statusCode).toBe(200);
		const body = json<{
			actions: string[];
			entityTypes: string[];
			actors: { id: string | null; name: string }[];
		}>(response);
		expect(body.actions).toContain(`${auditTag}.create`);
		expect(body.entityTypes).toContain(`${auditTag}-project`);
		expect(body.actors).toContainEqual({
			id: admin.id,
			name: `Test admin ${run}`,
		});
		expect(body.actors).toContainEqual({
			id: member.id,
			name: `Test member ${run}`,
		});
	});

	test("exports the filtered rows as CSV and defuses formulas", async () => {
		const response = await injectAs(
			app,
			admin.session,
			"GET",
			`/api/admin/audit.csv?action=${auditTag}.formula*&limit=1`,
		);
		expect(response.statusCode).toBe(200);
		expect(response.headers["content-type"]).toContain("text/csv");
		expect(response.headers["content-disposition"]).toContain(
			"attachment; filename=",
		);

		const csv = response.body;
		const lines = csv.split("\r\n").filter((line) => line !== "");
		expect(lines[0]).toBe(
			"When,Who,Action,Entity type,Entity id,Summary,Changes",
		);
		// `limit` is not part of the export: the whole filter is exported.
		expect(lines).toHaveLength(5);
		expect(csv).toContain(`"'=HYPERLINK(""${auditTag}"")"`);
		expect(csv).toContain(`'+${auditTag}`);
		expect(csv).toContain(`'-${auditTag}`);
		expect(csv).toContain(`'@${auditTag}`);
	});

	test("defuses a formula behind a leading tab, carriage return or line feed", async () => {
		const action = `${auditTag}.injected`;
		for (const [index, prefix] of ["\t", "\r", "\n"].entries()) {
			await audit(db, actorOf(admin, "admin"), {
				action,
				entityType: `${auditTag}-project`,
				entityId: null,
				summary: `${prefix}=cmd|' /C calc'!A0 ${index}`,
			});
		}

		const csv = (
			await injectAs(
				app,
				admin.session,
				"GET",
				`/api/admin/audit.csv?action=${action}`,
			)
		).body;
		expect(csv).toContain("'\t=cmd");
		expect(csv).toContain(`"'\r=cmd`);
		expect(csv).toContain(`"'\n=cmd`);
	});

	test("exports every matching row past the page size", async () => {
		const action = `${tag}-export-bulk`;
		await pool.query(
			`insert into audit_log (actor_name, action, entity_type, summary)
			 select 'Bulk exporter', $1, $2, 'Bulk export row ' || g
			 from generate_series(1, 10001) g`,
			[action, `${tag}-bulk`],
		);

		const response = await injectAs(
			app,
			admin.session,
			"GET",
			`/api/admin/audit.csv?action=${action}`,
		);
		expect(response.statusCode).toBe(200);
		const lines = response.body.split("\r\n").filter((line) => line !== "");
		expect(lines).toHaveLength(10_002);
	});

	test("keeps one snapshot when a matching row is inserted between pages", async () => {
		const action = `${tag}-export-snapshot`;
		await pool.query(
			`insert into audit_log (actor_name, action, entity_type, summary)
			 select 'Snapshot writer', $1, $2, 'Snapshot row ' || g
			 from generate_series(1, 10001) g`,
			[action, `${tag}-snapshot`],
		);

		const state = { pages: 0, inserted: false };
		const insert = async () => {
			await pool.query(
				`insert into audit_log (actor_name, action, entity_type, summary)
				 values ('Late writer', $1, $2, 'Inserted between pages')`,
				[action, `${tag}-snapshot`],
			);
		};
		const originalTransaction = db.transaction.bind(db);
		const originalSelect = db.select.bind(db);
		const restoreTransaction = swapTransaction((callback, config) =>
			originalTransaction(async (tx) => {
				const proxy = new Proxy(tx, {
					get(target, property, receiver) {
						if (property === "select") {
							return (...args: unknown[]) => {
								let query = (target.select as (...args: unknown[]) => unknown)(
									...args,
								) as ThenableQuery;
								if (isAuditSelect(args)) {
									query = insertBetweenPages(query, state, insert);
								}
								return query;
							};
						}
						const value = Reflect.get(target, property, receiver);
						return typeof value === "function" ? value.bind(target) : value;
					},
				});
				return callback(proxy as typeof tx);
			}, config),
		);
		const restoreSelect = swapSelect(((
			...args: Parameters<typeof db.select>
		) => {
			let query = originalSelect(...args) as unknown as ThenableQuery;
			if (isAuditSelect(args)) {
				query = insertBetweenPages(query, state, insert);
			}
			return query;
		}) as unknown as typeof db.select);
		try {
			const response = await injectAs(
				app,
				admin.session,
				"GET",
				`/api/admin/audit.csv?action=${action}`,
			);
			expect(response.statusCode).toBe(200);
			expect(state.inserted).toBe(true);
			expect(state.pages).toBe(2);
			const lines = response.body.split("\r\n").filter((line) => line !== "");
			expect(lines).toHaveLength(10_002);
			const summaries = lines.slice(1).map((line) => line.split(",")[5]);
			expect(summaries).toHaveLength(10_001);
			expect(new Set(summaries).size).toBe(10_001);
			expect(summaries).not.toContain("Inserted between pages");
		} finally {
			restoreSelect();
			restoreTransaction();
		}
	});

	test("quotes a summary with a comma", async () => {
		const csv = (
			await injectAs(
				app,
				admin.session,
				"GET",
				`/api/admin/audit.csv?action=${auditTag}.delete`,
			)
		).body;
		expect(csv).toContain(`"Deleted ${auditTag} widget, with a comma"`);
	});

	test("refuses the audit log to a non-admin", async () => {
		for (const path of [
			"/api/admin/audit",
			"/api/admin/audit.csv",
			"/api/admin/audit/filters",
		]) {
			const response = await injectAs(app, member.session, "GET", path);
			expect(response.statusCode).toBe(403);
			expect(json<{ error: string }>(response).error).toBe("Forbidden");
		}
	});
});

describe("system info", () => {
	test("reports the runtime and the database", async () => {
		const previous = process.env.APP_VERSION;
		delete process.env.APP_VERSION;

		const response = await injectAs(
			app,
			admin.session,
			"GET",
			"/api/admin/system",
		);
		expect(response.statusCode).toBe(200);
		const body = json<{
			version: string | null;
			node: string;
			postgres: string;
			migrationCount: number;
			counts: Record<string, number>;
			attachmentBytes: number;
			appUrl: string;
			uptimeSeconds: number;
			startedAt: string;
		}>(response);

		expect(body.version).toBe(null);
		expect(body.node).toBe(process.version);
		expect(body.postgres).toMatch(/^PostgreSQL \d+\.\d+/);
		expect(body.migrationCount).toBeGreaterThanOrEqual(4);
		expect(body.appUrl).toBe("http://127.0.0.1:3000");
		expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
		expect(Number.isNaN(Date.parse(body.startedAt))).toBe(false);
		for (const key of [
			"users",
			"activeUsers",
			"projects",
			"issues",
			"attachments",
		]) {
			expect(typeof body.counts[key]).toBe("number");
		}
		expect(body.attachmentBytes).toBeGreaterThanOrEqual(1234);

		if (previous === undefined) delete process.env.APP_VERSION;
		else process.env.APP_VERSION = previous;
	});

	test("reads the version from APP_VERSION when it is set", async () => {
		const previous = process.env.APP_VERSION;
		process.env.APP_VERSION = `9.9.9-${run}`;
		const body = json<{ version: string | null }>(
			await injectAs(app, admin.session, "GET", "/api/admin/system"),
		);
		expect(body.version).toBe(`9.9.9-${run}`);

		process.env.APP_VERSION = "   ";
		const blank = json<{ version: string | null }>(
			await injectAs(app, admin.session, "GET", "/api/admin/system"),
		);
		expect(blank.version).toBe(null);

		if (previous === undefined) delete process.env.APP_VERSION;
		else process.env.APP_VERSION = previous;
	});

	test("counts grow with the rows it is given", async () => {
		const before = json<{
			counts: Record<string, number>;
			attachmentBytes: number;
		}>(await injectAs(app, admin.session, "GET", "/api/admin/system"));

		const [status] = await db
			.select({ id: statuses.id })
			.from(statuses)
			.where(eq(statuses.sourceId, `${tag}-status`));
		const [issue] = await db
			.insert(issues)
			.values({
				sourceId: `${tag}-issue-2`,
				projectId,
				number: 2,
				key: `${projectKey}-2`,
				typeId: issueTypeId,
				statusId: status.id,
				summary: `Test issue two ${run}`,
			})
			.returning({ id: issues.id });
		await db.insert(attachments).values({
			sourceId: `${tag}-attachment-2`,
			issueId: issue.id,
			fileName: "second.txt",
			mimeType: "text/plain",
			size: 4321,
			storagePath: `/tmp/${tag}/second.txt`,
			sha256: "1".repeat(64),
		});

		const after = json<{
			counts: Record<string, number>;
			attachmentBytes: number;
		}>(await injectAs(app, admin.session, "GET", "/api/admin/system"));

		expect(after.counts.issues).toBeGreaterThanOrEqual(
			before.counts.issues + 1,
		);
		expect(after.counts.attachments).toBeGreaterThanOrEqual(
			before.counts.attachments + 1,
		);
		expect(after.attachmentBytes).toBeGreaterThanOrEqual(
			before.attachmentBytes + 4321,
		);
	});

	test("refuses system info to a non-admin", async () => {
		const response = await injectAs(
			app,
			member.session,
			"GET",
			"/api/admin/system",
		);
		expect(response.statusCode).toBe(403);
	});
});
