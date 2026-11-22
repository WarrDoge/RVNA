import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	issueHistory,
	issueHistoryItems,
	issueLinks,
	issues,
	issueTypes,
	linkTypes,
	priorities,
	projects,
	projectWorkflows,
	resolutions,
	statuses,
	workflowStatuses,
	workflows,
} from "../src/lib/server/schema.ts";
import { auditLog } from "../src/lib/server/schema-admin.ts";
import { injectAs, makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import { buildServer, cleanupTestData } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = newRun();
const tag = `cfg-${run}`;
const name = (base: string) => `${base} ${tag}`;
/** `makeUser` builds the display name from the label. */
const adminName = `Test admin ${run}`;

let app: TestApp;
let admin: TestUser;
let projectId: string;
let issueCounter = 0;

const created = {
	issueTypes: [] as string[],
	statuses: [] as string[],
	priorities: [] as string[],
	resolutions: [] as string[],
	linkTypes: [] as string[],
	issues: [] as string[],
	workflows: [] as string[],
	projectWorkflows: [] as string[],
};

type IssueTypeRow = {
	id: string;
	name: string;
	description: string | null;
	subtask: boolean;
	iconUrl: string | null;
	issueCount: number;
	projectCount: number;
};
type PriorityRow = {
	id: string;
	name: string;
	iconColor: string | null;
	sequence: number;
	issueCount: number;
};
type ResolutionRow = {
	id: string;
	name: string;
	description: string | null;
	sequence: number;
	issueCount: number;
};
type StatusRow = {
	id: string;
	name: string;
	category: string;
	issueCount: number;
	workflows: { id: string; name: string }[];
};
type LinkTypeRow = {
	id: string;
	name: string;
	inward: string;
	outward: string;
	linkCount: number;
};

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	await app.ready();
	admin = await makeUser(run, "admin", { admin: true });

	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `${tag}:project`,
			key: `C${run.slice(0, 6).toUpperCase()}`,
			name: `Config test project ${tag}`,
			projectType: "software",
		})
		.returning({ id: projects.id });
	projectId = project.id;
});

afterAll(async () => {
	await app.close();
	if (created.issues.length > 0) {
		await db.delete(issues).where(inArray(issues.id, created.issues));
	}
	if (created.projectWorkflows.length > 0) {
		await db
			.delete(projectWorkflows)
			.where(inArray(projectWorkflows.id, created.projectWorkflows));
	}
	if (created.workflows.length > 0) {
		await db.delete(workflows).where(inArray(workflows.id, created.workflows));
	}
	if (projectId) await db.delete(projects).where(eq(projects.id, projectId));
	const tables = [
		[issueTypes, created.issueTypes],
		[statuses, created.statuses],
		[priorities, created.priorities],
		[resolutions, created.resolutions],
		[linkTypes, created.linkTypes],
	] as const;
	for (const [table, ids] of tables) {
		if (ids.length > 0) await db.delete(table).where(inArray(table.id, ids));
	}
	await db.delete(auditLog).where(eq(auditLog.actorId, admin.id));
	await cleanupTestData(run);
});

function call(
	method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
	url: string,
	payload?: unknown,
) {
	return injectAs(app, admin.session, method, url, payload);
}

async function createRow<T>(
	url: string,
	body: unknown,
	collection: string[],
): Promise<T> {
	const response = await call("POST", url, body);
	expect(response.statusCode, response.body).toBe(201);
	const row = response.json() as T & { id: string };
	collection.push(row.id);
	return row;
}

async function insertIssue(overrides: {
	typeId: string;
	statusId: string;
	priorityId?: string | null;
	resolutionId?: string | null;
}) {
	issueCounter += 1;
	const suffix = `${run}${issueCounter}`;
	const [row] = await db
		.insert(issues)
		.values({
			sourceId: `${tag}:issue:${suffix}`,
			projectId,
			number: 10_000 + issueCounter,
			key: `C${run.slice(0, 4).toUpperCase()}-${issueCounter}`,
			typeId: overrides.typeId,
			statusId: overrides.statusId,
			priorityId: overrides.priorityId ?? null,
			resolutionId: overrides.resolutionId ?? null,
			summary: `Config fixture issue ${suffix}`,
			created: new Date("2020-01-01T00:00:00Z"),
			updated: new Date("2020-01-01T00:00:00Z"),
		})
		.returning();
	created.issues.push(row.id);
	return row;
}

async function auditRows(entityId: string) {
	return db
		.select()
		.from(auditLog)
		.where(eq(auditLog.entityId, entityId))
		.orderBy(auditLog.createdAt);
}

describe("issue types", () => {
	test("creates, updates and deletes, with audit rows", async () => {
		const created1 = await createRow<IssueTypeRow>(
			"/api/admin/issue-types",
			{ name: name("Story"), description: "As a user", subtask: false },
			created.issueTypes,
		);
		expect(created1.name).toBe(name("Story"));
		expect(created1.subtask).toBe(false);
		expect(created1.issueCount).toBe(0);
		expect(created1.projectCount).toBe(0);

		const patched = await call(
			"PATCH",
			`/api/admin/issue-types/${created1.id}`,
			{
				name: name("Story v2"),
				description: "As a person",
			},
		);
		expect(patched.statusCode, patched.body).toBe(200);
		expect(patched.json()).toMatchObject({
			name: name("Story v2"),
			description: "As a person",
		});

		const deleted = await call(
			"DELETE",
			`/api/admin/issue-types/${created1.id}`,
		);
		expect(deleted.statusCode, deleted.body).toBe(204);

		const audit = await auditRows(created1.id);
		expect(audit.map((row) => row.action)).toEqual([
			"issuetype.create",
			"issuetype.update",
			"issuetype.delete",
		]);
		expect(audit.every((row) => row.actorName === adminName)).toBe(true);
		expect(audit[1].changes).toEqual({
			from: { name: name("Story"), description: "As a user" },
			to: { name: name("Story v2"), description: "As a person" },
		});
	});

	test("stores a built-in icon and rejects unknown icons", async () => {
		const row = await createRow<IssueTypeRow>(
			"/api/admin/issue-types",
			{ name: name("Bug"), icon: "builtin:bug" },
			created.issueTypes,
		);
		expect(row.iconUrl).toBe("builtin:bug");

		for (const icon of ["builtin:banana", "https://example.test/bug.png"]) {
			const response = await call("POST", "/api/admin/issue-types", {
				name: name(`Bad icon ${icon}`),
				icon,
			});
			expect(response.statusCode, icon).toBe(400);
		}

		const list = await call("GET", "/api/admin/issue-types");
		expect(list.statusCode).toBe(200);
		const listed = (list.json() as IssueTypeRow[]).find(
			(entry) => entry.id === row.id,
		);
		expect(listed?.iconUrl).toBe("builtin:bug");
	});

	test("rejects duplicate names and invalid input", async () => {
		const row = await createRow<IssueTypeRow>(
			"/api/admin/issue-types",
			{ name: name("Duplicate") },
			created.issueTypes,
		);
		const clash = await call("POST", "/api/admin/issue-types", {
			name: name("duplicate").toUpperCase(),
		});
		expect(clash.statusCode).toBe(409);
		expect((clash.json() as { error: string }).error).toContain(
			"already exists",
		);

		const rename = await call("PATCH", `/api/admin/issue-types/${row.id}`, {
			name: name("Duplicate"),
		});
		expect(rename.statusCode).toBe(200);

		for (const body of [{}, { name: "" }, { name: "x".repeat(300) }]) {
			const response = await call("POST", "/api/admin/issue-types", body);
			expect(response.statusCode, JSON.stringify(body)).toBe(400);
		}
		const missing = await call(
			"PATCH",
			`/api/admin/issue-types/${randomUUID()}`,
			{ name: name("Nope") },
		);
		expect(missing.statusCode).toBe(404);
	});

	test("refuses to turn a used issue type into a sub-task type", async () => {
		const row = await createRow<IssueTypeRow>(
			"/api/admin/issue-types",
			{ name: name("Used") },
			created.issueTypes,
		);
		const open = await createRow<StatusRow>(
			"/api/admin/statuses",
			{ name: name("Open for type"), category: "new" },
			created.statuses,
		);
		await insertIssue({ typeId: row.id, statusId: open.id });

		const response = await call("PATCH", `/api/admin/issue-types/${row.id}`, {
			subtask: true,
		});
		expect(response.statusCode).toBe(409);
		expect(response.json()).toMatchObject({ count: 1 });
	});

	test("refuses to delete a used type and migrates its issues", async () => {
		const source = await createRow<IssueTypeRow>(
			"/api/admin/issue-types",
			{ name: name("Source type") },
			created.issueTypes,
		);
		const target = await createRow<IssueTypeRow>(
			"/api/admin/issue-types",
			{ name: name("Target type") },
			created.issueTypes,
		);
		const subtaskTarget = await createRow<IssueTypeRow>(
			"/api/admin/issue-types",
			{ name: name("Subtask target"), subtask: true },
			created.issueTypes,
		);
		const open = await createRow<StatusRow>(
			"/api/admin/statuses",
			{ name: name("Open for type migration"), category: "new" },
			created.statuses,
		);
		const first = await insertIssue({ typeId: source.id, statusId: open.id });
		const second = await insertIssue({ typeId: source.id, statusId: open.id });

		const references = await call(
			"GET",
			`/api/admin/issue-types/${source.id}/references`,
		);
		expect(references.statusCode).toBe(200);
		expect(references.json()).toMatchObject({ count: 2, canMigrate: true });

		const refused = await call("DELETE", `/api/admin/issue-types/${source.id}`);
		expect(refused.statusCode).toBe(409);
		expect(refused.json()).toMatchObject({
			count: 2,
			canMigrate: true,
			error: `2 issues use the issue type "${source.name}"`,
		});

		const self = await call(
			"DELETE",
			`/api/admin/issue-types/${source.id}?migrateTo=${source.id}`,
		);
		expect(self.statusCode).toBe(400);

		const incompatible = await call(
			"DELETE",
			`/api/admin/issue-types/${source.id}?migrateTo=${subtaskTarget.id}`,
		);
		expect(incompatible.statusCode).toBe(400);

		const unknown = await call(
			"DELETE",
			`/api/admin/issue-types/${source.id}?migrateTo=${randomUUID()}`,
		);
		expect(unknown.statusCode).toBe(400);

		const migrated = await call(
			"DELETE",
			`/api/admin/issue-types/${source.id}?migrateTo=${target.id}`,
		);
		expect(migrated.statusCode, migrated.body).toBe(204);

		const moved = await db
			.select({ id: issues.id, typeId: issues.typeId, updated: issues.updated })
			.from(issues)
			.where(inArray(issues.id, [first.id, second.id]));
		expect(moved.map((row) => row.typeId)).toEqual([target.id, target.id]);
		for (const row of moved) {
			expect(row.updated?.getTime()).toBeGreaterThan(
				new Date("2020-01-01T00:00:00Z").getTime(),
			);
		}

		const history = await db
			.select({
				issueId: issueHistory.issueId,
				field: issueHistoryItems.field,
				fieldType: issueHistoryItems.fieldType,
				fromText: issueHistoryItems.fromText,
				toText: issueHistoryItems.toText,
				authorId: issueHistory.authorId,
			})
			.from(issueHistoryItems)
			.innerJoin(issueHistory, eq(issueHistory.id, issueHistoryItems.historyId))
			.where(inArray(issueHistory.issueId, [first.id, second.id]));
		expect(history).toHaveLength(2);
		for (const item of history) {
			expect(item).toMatchObject({
				field: "issuetype",
				fieldType: "jira",
				fromText: source.name,
				toText: target.name,
				authorId: admin.id,
			});
		}

		const audit = await auditRows(source.id);
		expect(audit.map((row) => row.action)).toContain("issuetype.migrate");

		const stillThere = await call(
			"GET",
			`/api/admin/issue-types/${source.id}/references`,
		);
		expect(stillThere.statusCode).toBe(404);
	});

	test("migrates a type used by more issues than one insert can bind", async () => {
		const source = await createRow<IssueTypeRow>(
			"/api/admin/issue-types",
			{ name: name("Bulk source type") },
			created.issueTypes,
		);
		const target = await createRow<IssueTypeRow>(
			"/api/admin/issue-types",
			{ name: name("Bulk target type") },
			created.issueTypes,
		);
		const open = await createRow<StatusRow>(
			"/api/admin/statuses",
			{ name: name("Open for bulk migration"), category: "new" },
			created.statuses,
		);
		const total = 8200;
		const rows = Array.from({ length: total }, (_, index) => {
			issueCounter += 1;
			return {
				sourceId: `${tag}:issue:bulk:${index}`,
				projectId,
				number: 20_000 + issueCounter,
				key: `C${run.slice(0, 4).toUpperCase()}-B${index}`,
				typeId: source.id,
				statusId: open.id,
				summary: `Bulk fixture issue ${index}`,
				created: new Date("2020-01-01T00:00:00Z"),
				updated: new Date("2020-01-01T00:00:00Z"),
			};
		});
		for (let start = 0; start < rows.length; start += 500) {
			const inserted = await db
				.insert(issues)
				.values(rows.slice(start, start + 500))
				.returning({ id: issues.id });
			created.issues.push(...inserted.map((row) => row.id));
		}

		const migrated = await call(
			"DELETE",
			`/api/admin/issue-types/${source.id}?migrateTo=${target.id}`,
		);
		expect(migrated.statusCode, migrated.body).toBe(204);

		const [history] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(issueHistoryItems)
			.where(
				and(
					eq(issueHistoryItems.field, "issuetype"),
					eq(issueHistoryItems.fromText, source.name),
				),
			);
		expect(history?.count).toBe(total);

		// Keep the 8200 rows from slowing every later test in this file.
		await db.delete(issues).where(inArray(issues.id, created.issues));
		created.issues.length = 0;
	}, 120_000);

	test("a concurrent create with the same name returns a conflict", async () => {
		const fn = `cfg_slow_issue_type_${run}`;
		await pool.query(`drop trigger if exists ${fn} on issue_types`);
		await pool.query(`drop function if exists ${fn}()`);
		await pool.query(
			`create function ${fn}() returns trigger language plpgsql as $$ begin perform pg_sleep(0.3); return new; end $$`,
		);
		await pool.query(
			`create trigger ${fn} before insert on issue_types for each row execute function ${fn}()`,
		);
		try {
			const body = { name: name("Concurrent type") };
			const responses = await Promise.all([
				call("POST", "/api/admin/issue-types", body),
				call("POST", "/api/admin/issue-types", body),
			]);
			for (const response of responses) {
				if (response.statusCode === 201) {
					created.issueTypes.push((response.json() as { id: string }).id);
				}
			}
			expect(responses.map((response) => response.statusCode).sort()).toEqual([
				201, 409,
			]);
			const rows = await db
				.select({ id: issueTypes.id })
				.from(issueTypes)
				.where(sql`lower(${issueTypes.name}) = lower(${body.name})`);
			expect(rows).toHaveLength(1);
		} finally {
			await pool.query(`drop trigger if exists ${fn} on issue_types`);
			await pool.query(`drop function if exists ${fn}()`);
		}
	});
});

describe("priorities", () => {
	test("creates, updates and deletes, with audit rows", async () => {
		const row = await createRow<PriorityRow>(
			"/api/admin/priorities",
			{ name: name("Blocker"), iconColor: "#DE350B" },
			created.priorities,
		);
		expect(row.iconColor).toBe("#DE350B");
		expect(row.sequence).toBeGreaterThan(0);

		const patched = await call("PATCH", `/api/admin/priorities/${row.id}`, {
			name: name("Blocker v2"),
			iconColor: "#FF5630",
		});
		expect(patched.statusCode, patched.body).toBe(200);
		expect(patched.json()).toMatchObject({
			name: name("Blocker v2"),
			iconColor: "#FF5630",
		});

		const deleted = await call("DELETE", `/api/admin/priorities/${row.id}`);
		expect(deleted.statusCode, deleted.body).toBe(204);

		const audit = await auditRows(row.id);
		expect(audit.map((entry) => entry.action)).toEqual([
			"priority.create",
			"priority.update",
			"priority.delete",
		]);
		expect(audit.every((entry) => entry.actorName === adminName)).toBe(true);
	});

	test("rejects duplicates, bad colours and empty bodies", async () => {
		await createRow<PriorityRow>(
			"/api/admin/priorities",
			{ name: name("Duplicate priority") },
			created.priorities,
		);
		const clash = await call("POST", "/api/admin/priorities", {
			name: name("duplicate priority"),
		});
		expect(clash.statusCode).toBe(409);

		const colour = await call("POST", "/api/admin/priorities", {
			name: name("Bad colour"),
			iconColor: "red",
		});
		expect(colour.statusCode).toBe(400);

		const empty = await call("POST", "/api/admin/priorities", {});
		expect(empty.statusCode).toBe(400);
	});

	test("refuses to delete a used priority and migrates its issues", async () => {
		const source = await createRow<PriorityRow>(
			"/api/admin/priorities",
			{ name: name("Source priority"), iconColor: "#2684FF" },
			created.priorities,
		);
		const target = await createRow<PriorityRow>(
			"/api/admin/priorities",
			{ name: name("Target priority") },
			created.priorities,
		);
		const type = await createRow<IssueTypeRow>(
			"/api/admin/issue-types",
			{ name: name("Type for priorities") },
			created.issueTypes,
		);
		const open = await createRow<StatusRow>(
			"/api/admin/statuses",
			{ name: name("Open for priorities"), category: "new" },
			created.statuses,
		);
		const first = await insertIssue({
			typeId: type.id,
			statusId: open.id,
			priorityId: source.id,
		});
		const second = await insertIssue({
			typeId: type.id,
			statusId: open.id,
			priorityId: source.id,
		});

		const refused = await call("DELETE", `/api/admin/priorities/${source.id}`);
		expect(refused.statusCode).toBe(409);
		expect(refused.json()).toMatchObject({
			count: 2,
			canMigrate: true,
			error: `2 issues use the priority "${source.name}"`,
		});

		const self = await call(
			"DELETE",
			`/api/admin/priorities/${source.id}?migrateTo=${source.id}`,
		);
		expect(self.statusCode).toBe(400);

		const migrated = await call(
			"DELETE",
			`/api/admin/priorities/${source.id}?migrateTo=${target.id}`,
		);
		expect(migrated.statusCode, migrated.body).toBe(204);

		const moved = await db
			.select({ priorityId: issues.priorityId })
			.from(issues)
			.where(inArray(issues.id, [first.id, second.id]));
		expect(moved.map((row) => row.priorityId)).toEqual([target.id, target.id]);

		const history = await db
			.select({
				field: issueHistoryItems.field,
				fromText: issueHistoryItems.fromText,
				toText: issueHistoryItems.toText,
			})
			.from(issueHistoryItems)
			.innerJoin(issueHistory, eq(issueHistory.id, issueHistoryItems.historyId))
			.where(inArray(issueHistory.issueId, [first.id, second.id]));
		expect(history).toHaveLength(2);
		expect(history[0]).toMatchObject({
			field: "priority",
			fromText: source.name,
			toText: target.name,
		});
	});

	test("reorders and rejects a list that does not match", async () => {
		await createRow<PriorityRow>(
			"/api/admin/priorities",
			{ name: name("Order one") },
			created.priorities,
		);
		await createRow<PriorityRow>(
			"/api/admin/priorities",
			{ name: name("Order two") },
			created.priorities,
		);
		const before = await call("GET", "/api/admin/priorities");
		const original = before.json() as PriorityRow[];
		const reversed = [...original].reverse().map((row) => row.id);

		try {
			const saved = await call("PUT", "/api/admin/priorities/order", {
				ids: reversed,
			});
			expect(saved.statusCode, saved.body).toBe(204);

			const after = (
				await call("GET", "/api/admin/priorities")
			).json() as PriorityRow[];
			expect(after.map((row) => row.id)).toEqual(reversed);
			expect(after.map((row) => row.sequence)).toEqual(
				reversed.map((_, index) => index + 1),
			);

			const short = await call("PUT", "/api/admin/priorities/order", {
				ids: reversed.slice(1),
			});
			expect(short.statusCode).toBe(400);

			const duplicate = await call("PUT", "/api/admin/priorities/order", {
				ids: [...reversed.slice(1), reversed[1]],
			});
			expect(duplicate.statusCode).toBe(400);

			const unknown = await call("PUT", "/api/admin/priorities/order", {
				ids: [...reversed.slice(1), randomUUID()],
			});
			expect(unknown.statusCode).toBe(400);
		} finally {
			await call("PUT", "/api/admin/priorities/order", {
				ids: original.map((row) => row.id),
			});
		}

		const audit = await db
			.select({ action: auditLog.action })
			.from(auditLog)
			.where(eq(auditLog.action, "priority.reorder"));
		expect(audit.length).toBeGreaterThan(0);
	});

	test("records the previous sequence order in the audit", async () => {
		const first = await createRow<PriorityRow>(
			"/api/admin/priorities",
			{ name: name("Audit order one") },
			created.priorities,
		);
		await createRow<PriorityRow>(
			"/api/admin/priorities",
			{ name: name("Audit order two") },
			created.priorities,
		);
		// Move the first row to the front and to the end of the heap, so a
		// fetch without ORDER BY no longer matches the sequence order.
		await db
			.update(priorities)
			.set({ sequence: 0 })
			.where(eq(priorities.id, first.id));

		const before = (
			await call("GET", "/api/admin/priorities")
		).json() as PriorityRow[];
		const beforeOrder = before.map((row) => row.name);
		expect(beforeOrder[0]).toBe(first.name);
		const reversed = [...before].reverse().map((row) => row.id);

		try {
			const saved = await call("PUT", "/api/admin/priorities/order", {
				ids: reversed,
			});
			expect(saved.statusCode, saved.body).toBe(204);

			const [audit] = await db
				.select({ changes: auditLog.changes })
				.from(auditLog)
				.where(
					and(
						eq(auditLog.action, "priority.reorder"),
						eq(auditLog.actorId, admin.id),
					),
				)
				.orderBy(desc(auditLog.createdAt))
				.limit(1);
			const changes = audit?.changes as
				| { from: { order: string[] } }
				| undefined;
			expect(changes?.from.order).toEqual(beforeOrder);
		} finally {
			await call("PUT", "/api/admin/priorities/order", {
				ids: before.map((row) => row.id),
			});
		}
	});
});

describe("resolutions", () => {
	test("creates, updates and deletes, with audit rows", async () => {
		const row = await createRow<ResolutionRow>(
			"/api/admin/resolutions",
			{ name: name("Fixed"), description: "A fix shipped" },
			created.resolutions,
		);
		expect(row.description).toBe("A fix shipped");

		const patched = await call("PATCH", `/api/admin/resolutions/${row.id}`, {
			description: "A fix shipped to production",
		});
		expect(patched.statusCode, patched.body).toBe(200);
		expect(patched.json()).toMatchObject({
			description: "A fix shipped to production",
		});

		const deleted = await call("DELETE", `/api/admin/resolutions/${row.id}`);
		expect(deleted.statusCode, deleted.body).toBe(204);

		const audit = await auditRows(row.id);
		expect(audit.map((entry) => entry.action)).toEqual([
			"resolution.create",
			"resolution.update",
			"resolution.delete",
		]);
		expect(audit.every((entry) => entry.actorName === adminName)).toBe(true);
	});

	test("rejects duplicates and empty bodies", async () => {
		await createRow<ResolutionRow>(
			"/api/admin/resolutions",
			{ name: name("Duplicate resolution") },
			created.resolutions,
		);
		const clash = await call("POST", "/api/admin/resolutions", {
			name: name("DUPLICATE RESOLUTION"),
		});
		expect(clash.statusCode).toBe(409);
		const empty = await call("POST", "/api/admin/resolutions", {});
		expect(empty.statusCode).toBe(400);
	});

	test("refuses to delete a used resolution and migrates its issues", async () => {
		const source = await createRow<ResolutionRow>(
			"/api/admin/resolutions",
			{ name: name("Source resolution") },
			created.resolutions,
		);
		const target = await createRow<ResolutionRow>(
			"/api/admin/resolutions",
			{ name: name("Target resolution") },
			created.resolutions,
		);
		const type = await createRow<IssueTypeRow>(
			"/api/admin/issue-types",
			{ name: name("Type for resolutions") },
			created.issueTypes,
		);
		const open = await createRow<StatusRow>(
			"/api/admin/statuses",
			{ name: name("Open for resolutions"), category: "new" },
			created.statuses,
		);
		const issue = await insertIssue({
			typeId: type.id,
			statusId: open.id,
			resolutionId: source.id,
		});

		const refused = await call("DELETE", `/api/admin/resolutions/${source.id}`);
		expect(refused.statusCode).toBe(409);
		expect(refused.json()).toMatchObject({ count: 1, canMigrate: true });

		const migrated = await call(
			"DELETE",
			`/api/admin/resolutions/${source.id}?migrateTo=${target.id}`,
		);
		expect(migrated.statusCode, migrated.body).toBe(204);

		const [moved] = await db
			.select({ resolutionId: issues.resolutionId })
			.from(issues)
			.where(eq(issues.id, issue.id));
		expect(moved.resolutionId).toBe(target.id);
	});

	test("reorders and rejects a list that does not match", async () => {
		await createRow<ResolutionRow>(
			"/api/admin/resolutions",
			{ name: name("Order one") },
			created.resolutions,
		);
		await createRow<ResolutionRow>(
			"/api/admin/resolutions",
			{ name: name("Order two") },
			created.resolutions,
		);
		const before = (
			await call("GET", "/api/admin/resolutions")
		).json() as ResolutionRow[];
		const reversed = [...before].reverse().map((row) => row.id);

		try {
			const saved = await call("PUT", "/api/admin/resolutions/order", {
				ids: reversed,
			});
			expect(saved.statusCode, saved.body).toBe(204);
			const after = (
				await call("GET", "/api/admin/resolutions")
			).json() as ResolutionRow[];
			expect(after.map((row) => row.id)).toEqual(reversed);
			expect(after.map((row) => row.sequence)).toEqual(
				reversed.map((_, index) => index + 1),
			);

			const short = await call("PUT", "/api/admin/resolutions/order", {
				ids: reversed.slice(1),
			});
			expect(short.statusCode).toBe(400);
		} finally {
			await call("PUT", "/api/admin/resolutions/order", {
				ids: before.map((row) => row.id),
			});
		}
	});
});

describe("statuses", () => {
	test("creates, updates and deletes, with audit rows", async () => {
		const row = await createRow<StatusRow>(
			"/api/admin/statuses",
			{ name: name("Review"), category: "indeterminate" },
			created.statuses,
		);
		expect(row.category).toBe("indeterminate");
		expect(row.workflows).toEqual([]);

		const patched = await call("PATCH", `/api/admin/statuses/${row.id}`, {
			category: "done",
		});
		expect(patched.statusCode, patched.body).toBe(200);
		expect(patched.json()).toMatchObject({ category: "done" });

		const deleted = await call("DELETE", `/api/admin/statuses/${row.id}`);
		expect(deleted.statusCode, deleted.body).toBe(204);

		const audit = await auditRows(row.id);
		expect(audit.map((entry) => entry.action)).toEqual([
			"status.create",
			"status.update",
			"status.delete",
		]);
		expect(audit.every((entry) => entry.actorName === adminName)).toBe(true);
	});

	test("answers 404 when the status disappears during the update", async () => {
		const row = await createRow<StatusRow>(
			"/api/admin/statuses",
			{ name: name("Vanishing status"), category: "new" },
			created.statuses,
		);
		const fn = `cfg_delete_status_${run}`;
		await pool.query(`drop trigger if exists ${fn} on statuses`);
		await pool.query(`drop function if exists ${fn}()`);
		await pool.query(
			`create function ${fn}() returns trigger language plpgsql as $$ begin delete from statuses where id = new.id; return new; end $$`,
		);
		await pool.query(
			`create trigger ${fn} after update on statuses for each row when (new.id = '${row.id}') execute function ${fn}()`,
		);
		try {
			const patched = await call("PATCH", `/api/admin/statuses/${row.id}`, {
				category: "done",
			});
			expect(patched.statusCode, patched.body).toBe(404);
		} finally {
			await pool.query(`drop trigger if exists ${fn} on statuses`);
			await pool.query(`drop function if exists ${fn}()`);
		}
	});

	test("rejects duplicates and invalid categories", async () => {
		await createRow<StatusRow>(
			"/api/admin/statuses",
			{ name: name("Duplicate status"), category: "new" },
			created.statuses,
		);
		const clash = await call("POST", "/api/admin/statuses", {
			name: name("duplicate status"),
			category: "new",
		});
		expect(clash.statusCode).toBe(409);
		const category = await call("POST", "/api/admin/statuses", {
			name: name("Bad category"),
			category: "sideways",
		});
		expect(category.statusCode).toBe(400);
	});

	test("refuses to delete a status a workflow uses", async () => {
		const row = await createRow<StatusRow>(
			"/api/admin/statuses",
			{ name: name("In workflow"), category: "new" },
			created.statuses,
		);
		const [workflow] = await db
			.insert(workflows)
			.values({ sourceId: `${tag}:workflow`, name: name("Test workflow") })
			.returning();
		created.workflows.push(workflow.id);
		await db.insert(workflowStatuses).values({
			sourceId: `${tag}:workflow-status`,
			workflowId: workflow.id,
			statusId: row.id,
		});

		const list = (
			await call("GET", "/api/admin/statuses")
		).json() as StatusRow[];
		expect(list.find((entry) => entry.id === row.id)?.workflows).toEqual([
			{ id: workflow.id, name: workflow.name },
		]);

		const references = await call(
			"GET",
			`/api/admin/statuses/${row.id}/references`,
		);
		expect(references.json()).toMatchObject({
			count: 0,
			canMigrate: false,
			workflows: [{ id: workflow.id, name: workflow.name }],
		});

		const refused = await call("DELETE", `/api/admin/statuses/${row.id}`);
		expect(refused.statusCode).toBe(409);
		const body = refused.json() as {
			error: string;
			canMigrate: boolean;
			workflows: { id: string; name: string }[];
		};
		expect(body.canMigrate).toBe(false);
		expect(body.error).toContain(workflow.name);
		expect(body.workflows).toEqual([{ id: workflow.id, name: workflow.name }]);
	});

	test("refuses to delete a status a workflow starts with", async () => {
		const row = await createRow<StatusRow>(
			"/api/admin/statuses",
			{ name: name("Initial status"), category: "new" },
			created.statuses,
		);
		const [workflow] = await db
			.insert(workflows)
			.values({
				sourceId: `${tag}:workflow:initial`,
				name: name("Initial workflow"),
				initialStatusId: row.id,
			})
			.returning();
		created.workflows.push(workflow.id);

		const references = await call(
			"GET",
			`/api/admin/statuses/${row.id}/references`,
		);
		expect(references.json()).toMatchObject({
			count: 0,
			canMigrate: false,
			workflows: [{ id: workflow.id, name: workflow.name }],
		});

		const refused = await call("DELETE", `/api/admin/statuses/${row.id}`);
		expect(refused.statusCode).toBe(409);
		expect((refused.json() as { error: string }).error).toContain(
			workflow.name,
		);
	});

	test("refuses to migrate issues to a status of another workflow", async () => {
		const source = await createRow<StatusRow>(
			"/api/admin/statuses",
			{ name: name("Workflow source"), category: "new" },
			created.statuses,
		);
		const other = await createRow<StatusRow>(
			"/api/admin/statuses",
			{ name: name("Workflow other"), category: "indeterminate" },
			created.statuses,
		);
		const target = await createRow<StatusRow>(
			"/api/admin/statuses",
			{ name: name("Workflow target"), category: "done" },
			created.statuses,
		);
		const [issueWorkflow] = await db
			.insert(workflows)
			.values({
				sourceId: `${tag}:workflow:issue`,
				name: name("Issue workflow"),
			})
			.returning();
		created.workflows.push(issueWorkflow.id);
		await db.insert(workflowStatuses).values({
			sourceId: `${tag}:workflow-status:issue`,
			workflowId: issueWorkflow.id,
			statusId: other.id,
		});
		const [targetWorkflow] = await db
			.insert(workflows)
			.values({
				sourceId: `${tag}:workflow:target`,
				name: name("Target workflow"),
			})
			.returning();
		created.workflows.push(targetWorkflow.id);
		await db.insert(workflowStatuses).values({
			sourceId: `${tag}:workflow-status:target`,
			workflowId: targetWorkflow.id,
			statusId: target.id,
		});
		const [projectWorkflow] = await db
			.insert(projectWorkflows)
			.values({
				sourceId: `${tag}:project-workflow:target`,
				projectId,
				workflowId: issueWorkflow.id,
			})
			.returning();
		created.projectWorkflows.push(projectWorkflow.id);

		const type = await createRow<IssueTypeRow>(
			"/api/admin/issue-types",
			{ name: name("Type for workflow statuses") },
			created.issueTypes,
		);
		const issue = await insertIssue({ typeId: type.id, statusId: source.id });

		try {
			const refused = await call(
				"DELETE",
				`/api/admin/statuses/${source.id}?migrateTo=${target.id}`,
			);
			expect(refused.statusCode).toBe(400);
			expect(refused.json().error).toContain(issueWorkflow.name);

			const [kept] = await db
				.select({ statusId: issues.statusId })
				.from(issues)
				.where(eq(issues.id, issue.id));
			expect(kept?.statusId).toBe(source.id);
			const [stillThere] = await db
				.select({ id: statuses.id })
				.from(statuses)
				.where(eq(statuses.id, source.id));
			expect(stillThere?.id).toBe(source.id);
		} finally {
			await db
				.delete(projectWorkflows)
				.where(eq(projectWorkflows.id, projectWorkflow.id));
		}
	});

	test("refuses to delete a used status and migrates its issues", async () => {
		const source = await createRow<StatusRow>(
			"/api/admin/statuses",
			{ name: name("Source status"), category: "indeterminate" },
			created.statuses,
		);
		const target = await createRow<StatusRow>(
			"/api/admin/statuses",
			{ name: name("Target status"), category: "done" },
			created.statuses,
		);
		const type = await createRow<IssueTypeRow>(
			"/api/admin/issue-types",
			{ name: name("Type for statuses") },
			created.issueTypes,
		);
		const first = await insertIssue({ typeId: type.id, statusId: source.id });
		const second = await insertIssue({ typeId: type.id, statusId: source.id });

		const refused = await call("DELETE", `/api/admin/statuses/${source.id}`);
		expect(refused.statusCode).toBe(409);
		expect(refused.json()).toMatchObject({
			count: 2,
			canMigrate: true,
			error: `2 issues use the status "${source.name}"`,
		});

		const migrated = await call(
			"DELETE",
			`/api/admin/statuses/${source.id}?migrateTo=${target.id}`,
		);
		expect(migrated.statusCode, migrated.body).toBe(204);

		const moved = await db
			.select({ statusId: issues.statusId })
			.from(issues)
			.where(inArray(issues.id, [first.id, second.id]));
		expect(moved.map((row) => row.statusId)).toEqual([target.id, target.id]);

		const history = await db
			.select({
				field: issueHistoryItems.field,
				fromText: issueHistoryItems.fromText,
				toText: issueHistoryItems.toText,
			})
			.from(issueHistoryItems)
			.innerJoin(issueHistory, eq(issueHistory.id, issueHistoryItems.historyId))
			.where(inArray(issueHistory.issueId, [first.id, second.id]));
		expect(history).toHaveLength(2);
		expect(history[0]).toMatchObject({
			field: "status",
			fromText: source.name,
			toText: target.name,
		});
	});
});

describe("link types", () => {
	test("creates, updates and deletes, with audit rows", async () => {
		const row = await createRow<LinkTypeRow>(
			"/api/admin/link-types",
			{
				name: name("Blocks"),
				inward: "is blocked by",
				outward: "blocks",
			},
			created.linkTypes,
		);
		expect(row.linkCount).toBe(0);

		const patched = await call("PATCH", `/api/admin/link-types/${row.id}`, {
			outward: "blocks this",
		});
		expect(patched.statusCode, patched.body).toBe(200);
		expect(patched.json()).toMatchObject({ outward: "blocks this" });

		const deleted = await call("DELETE", `/api/admin/link-types/${row.id}`);
		expect(deleted.statusCode, deleted.body).toBe(204);

		const audit = await auditRows(row.id);
		expect(audit.map((entry) => entry.action)).toEqual([
			"linktype.create",
			"linktype.update",
			"linktype.delete",
		]);
		expect(audit.every((entry) => entry.actorName === adminName)).toBe(true);
	});

	test("rejects duplicates and incomplete bodies", async () => {
		await createRow<LinkTypeRow>(
			"/api/admin/link-types",
			{
				name: name("Duplicate link"),
				inward: "is related to",
				outward: "relates to",
			},
			created.linkTypes,
		);
		const clash = await call("POST", "/api/admin/link-types", {
			name: name("Duplicate link"),
			inward: "is related to",
			outward: "relates to",
		});
		expect(clash.statusCode).toBe(409);

		for (const body of [
			{ name: name("No inward"), outward: "relates to" },
			{ name: name("No outward"), inward: "is related to" },
			{},
		]) {
			const response = await call("POST", "/api/admin/link-types", body);
			expect(response.statusCode, JSON.stringify(body)).toBe(400);
		}
	});

	test("refuses to delete a used link type and repoints the links", async () => {
		const source = await createRow<LinkTypeRow>(
			"/api/admin/link-types",
			{
				name: name("Source link"),
				inward: "is caused by",
				outward: "causes",
			},
			created.linkTypes,
		);
		const target = await createRow<LinkTypeRow>(
			"/api/admin/link-types",
			{
				name: name("Target link"),
				inward: "is followed by",
				outward: "follows",
			},
			created.linkTypes,
		);
		const type = await createRow<IssueTypeRow>(
			"/api/admin/issue-types",
			{ name: name("Type for links") },
			created.issueTypes,
		);
		const open = await createRow<StatusRow>(
			"/api/admin/statuses",
			{ name: name("Open for links"), category: "new" },
			created.statuses,
		);
		const first = await insertIssue({ typeId: type.id, statusId: open.id });
		const second = await insertIssue({ typeId: type.id, statusId: open.id });
		const [link] = await db
			.insert(issueLinks)
			.values({
				sourceId: `${tag}:link`,
				typeId: source.id,
				sourceIssueId: first.id,
				targetIssueId: second.id,
			})
			.returning();

		const refused = await call("DELETE", `/api/admin/link-types/${source.id}`);
		expect(refused.statusCode).toBe(409);
		expect(refused.json()).toMatchObject({
			count: 1,
			canMigrate: true,
			error: `1 link uses the link type "${source.name}"`,
		});

		const migrated = await call(
			"DELETE",
			`/api/admin/link-types/${source.id}?migrateTo=${target.id}`,
		);
		expect(migrated.statusCode, migrated.body).toBe(204);

		const [repointed] = await db
			.select({ typeId: issueLinks.typeId })
			.from(issueLinks)
			.where(eq(issueLinks.id, link.id));
		expect(repointed.typeId).toBe(target.id);
	});
});

describe("deleting with an unused migration target", () => {
	test("records a plain delete when nothing moves", async () => {
		const cases: {
			url: string;
			source: Record<string, unknown>;
			target: Record<string, unknown>;
			collection: string[];
			action: string;
		}[] = [
			{
				url: "/api/admin/issue-types",
				source: { name: name("Unused type source") },
				target: { name: name("Unused type target") },
				collection: created.issueTypes,
				action: "issuetype.delete",
			},
			{
				url: "/api/admin/priorities",
				source: { name: name("Unused priority source") },
				target: { name: name("Unused priority target") },
				collection: created.priorities,
				action: "priority.delete",
			},
			{
				url: "/api/admin/resolutions",
				source: { name: name("Unused resolution source") },
				target: { name: name("Unused resolution target") },
				collection: created.resolutions,
				action: "resolution.delete",
			},
			{
				url: "/api/admin/statuses",
				source: { name: name("Unused status source"), category: "new" },
				target: { name: name("Unused status target"), category: "done" },
				collection: created.statuses,
				action: "status.delete",
			},
			{
				url: "/api/admin/link-types",
				source: {
					name: name("Unused link source"),
					inward: "is caused by",
					outward: "causes",
				},
				target: {
					name: name("Unused link target"),
					inward: "is followed by",
					outward: "follows",
				},
				collection: created.linkTypes,
				action: "linktype.delete",
			},
		];

		for (const entry of cases) {
			const source = await createRow<{ id: string }>(
				entry.url,
				entry.source,
				entry.collection,
			);
			const target = await createRow<{ id: string }>(
				entry.url,
				entry.target,
				entry.collection,
			);
			const deleted = await call(
				"DELETE",
				`${entry.url}/${source.id}?migrateTo=${target.id}`,
			);
			expect(deleted.statusCode, deleted.body).toBe(204);
			const audit = await auditRows(source.id);
			expect(audit.at(-1)).toMatchObject({
				action: entry.action,
				changes: { to: null },
			});
		}
	});
});
