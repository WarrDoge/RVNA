import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
	type AdminFieldType,
	adminFieldTypes,
	type LoadedField,
	type LoadedOption,
	validateCustomValue,
} from "../src/lib/server/custom-fields.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	auditLog,
	fields,
	issues,
	issueTypes,
	projectIssueTypes,
	projects,
	projectWorkflows,
	statuses,
	workflowStatuses,
	workflows,
} from "../src/lib/server/schema.ts";
import { injectAs, makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import {
	buildServer,
	cleanupTestData,
	grantDefaultProjectRole,
} from "./helpers.ts";
import type { InjectResponse, TestApp } from "./server.ts";

const run = newRun();
const tag = `test-${run}`;
const projectKey = `F${run.slice(0, 6).toUpperCase()}`;

let app: TestApp;
let admin: TestUser;
let member: TestUser;
let otherUser: TestUser;
let inactiveUser: TestUser;

let projectId: string;
let workflowId: string;
let taskTypeId: string;
let bugTypeId: string;
let todoStatusId: string;
let doneStatusId: string;

const createdFieldIds: string[] = [];
const extraTypeIds: string[] = [];

async function newIssueType(label: string) {
	const [type] = await db
		.insert(issueTypes)
		.values({
			sourceId: `${tag}:type:${label}`,
			name: `${tag} ${label}`,
			subtask: false,
		})
		.returning();
	extraTypeIds.push(type.id);
	await db.insert(projectIssueTypes).values({
		sourceId: `${tag}:project-type:${label}`,
		projectId,
		issueTypeId: type.id,
	});
	return type.id;
}

function expectStatus(response: InjectResponse, status: number) {
	if (response.statusCode !== status) {
		throw new Error(
			`Expected ${status}, got ${response.statusCode}: ${response.body}`,
		);
	}
}

function inject(
	method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
	url: string,
	payload?: unknown,
) {
	return injectAs(app, admin.session, method, url, payload);
}

async function createField(body: {
	name: string;
	type: AdminFieldType;
	required?: boolean;
	description?: string;
}) {
	const response = await inject("POST", "/api/admin/custom-fields", body);
	expectStatus(response, 201);
	const field = response.json();
	createdFieldIds.push(field.id);
	return field;
}

async function addOption(
	fieldId: string,
	value: string,
	parentOptionId?: string,
) {
	const response = await inject(
		"POST",
		`/api/admin/custom-fields/${fieldId}/options`,
		parentOptionId ? { value, parentOptionId } : { value },
	);
	expectStatus(response, 201);
	return response.json();
}

async function setContexts(
	fieldId: string,
	contexts: { projectId?: string | null; issueTypeId?: string | null }[],
) {
	const response = await inject(
		"PUT",
		`/api/admin/custom-fields/${fieldId}/contexts`,
		{ contexts },
	);
	expectStatus(response, 200);
	return response.json();
}

async function createIssue(body: Record<string, unknown> = {}) {
	return injectAs(app, member.session, "POST", "/api/issues", {
		project: projectKey,
		type: taskTypeId,
		summary: `Issue ${randomUUID().slice(0, 8)}`,
		...body,
	});
}

async function detail(key: string) {
	const response = await injectAs(
		app,
		member.session,
		"GET",
		`/api/issues/${key}`,
	);
	expectStatus(response, 200);
	return response.json();
}

function publicFields(issueType?: string) {
	const query = issueType ? `?issueType=${issueType}` : "";
	return injectAs(
		app,
		member.session,
		"GET",
		`/api/projects/${projectKey}/custom-fields${query}`,
	);
}

function unitField(
	type: AdminFieldType,
	specs: { value: string; disabled?: boolean; parent?: number }[] = [],
): LoadedField {
	const ids = specs.map(() => randomUUID());
	const options: LoadedOption[] = specs.map((spec, index) => ({
		id: ids[index],
		value: spec.value,
		parentOptionId: spec.parent === undefined ? null : ids[spec.parent],
		sequence: index,
		disabled: spec.disabled ?? false,
	}));
	return {
		id: randomUUID(),
		sourceId: "customfield_99001",
		name: "Unit field",
		description: null,
		type,
		required: false,
		options,
	};
}

function ok(value: unknown) {
	return { ok: true, value };
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	await app.ready();

	admin = await makeUser(run, "admin", { admin: true });
	member = await makeUser(run, "member");
	otherUser = await makeUser(run, "other");
	inactiveUser = await makeUser(run, "inactive", { active: false });

	const typeRows = await db
		.insert(issueTypes)
		.values([
			{ sourceId: `${tag}:type:task`, name: `${tag} Task`, subtask: false },
			{ sourceId: `${tag}:type:bug`, name: `${tag} Bug`, subtask: false },
		])
		.returning();
	taskTypeId = typeRows[0].id;
	bugTypeId = typeRows[1].id;

	const statusRows = await db
		.insert(statuses)
		.values([
			{ sourceId: `${tag}:status:todo`, name: `${tag} To Do`, category: "new" },
			{ sourceId: `${tag}:status:done`, name: `${tag} Done`, category: "done" },
		])
		.returning();
	todoStatusId = statusRows[0].id;
	doneStatusId = statusRows[1].id;

	const [workflow] = await db
		.insert(workflows)
		.values({
			sourceId: `${tag}:workflow`,
			name: `${tag} workflow`,
			initialStatusId: todoStatusId,
		})
		.returning();
	workflowId = workflow.id;
	await db.insert(workflowStatuses).values([
		{
			sourceId: `${tag}:workflow-status:todo`,
			workflowId,
			statusId: todoStatusId,
		},
		{
			sourceId: `${tag}:workflow-status:done`,
			workflowId,
			statusId: doneStatusId,
		},
	]);

	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `${tag}:project`,
			key: projectKey,
			name: `${tag} Project`,
			projectType: "software",
			lastIssueNumber: 0,
		})
		.returning();
	projectId = project.id;
	await grantDefaultProjectRole(projectId, [member.username]);
	await db.insert(projectIssueTypes).values([
		{
			sourceId: `${tag}:project-type:task`,
			projectId,
			issueTypeId: taskTypeId,
		},
		{ sourceId: `${tag}:project-type:bug`, projectId, issueTypeId: bugTypeId },
	]);
	await db.insert(projectWorkflows).values({
		sourceId: `${tag}:project-workflow`,
		projectId,
		issueTypeId: null,
		workflowId,
	});
});

afterAll(async () => {
	await pool.query("delete from projects where id = $1", [projectId]);
	if (createdFieldIds.length > 0) {
		await pool.query("delete from fields where id = any($1::uuid[])", [
			createdFieldIds,
		]);
	}
	await pool.query("delete from workflows where id = $1", [workflowId]);
	await pool.query("delete from issue_types where id = any($1::uuid[])", [
		[taskTypeId, bugTypeId, ...extraTypeIds],
	]);
	await pool.query("delete from statuses where id = any($1::uuid[])", [
		[todoStatusId, doneStatusId],
	]);
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

describe("validateCustomValue", () => {
	test("text and paragraph enforce their length", () => {
		const text = unitField("text");
		expect(validateCustomValue(text, "  hello ")).toEqual(ok("hello"));
		expect(validateCustomValue(text, "")).toEqual(ok(null));
		expect(validateCustomValue(text, "x".repeat(255)).ok).toBe(true);
		expect(validateCustomValue(text, "x".repeat(256)).ok).toBe(false);
		expect(validateCustomValue(text, 42).ok).toBe(false);

		const paragraph = unitField("paragraph");
		expect(validateCustomValue(paragraph, "x".repeat(32_000)).ok).toBe(true);
		expect(validateCustomValue(paragraph, "x".repeat(32_001)).ok).toBe(false);
	});

	test("number rejects NaN and Infinity", () => {
		const number = unitField("number");
		expect(validateCustomValue(number, 42)).toEqual(ok(42));
		expect(validateCustomValue(number, "4.5")).toEqual(ok(4.5));
		expect(validateCustomValue(number, Number.NaN).ok).toBe(false);
		expect(validateCustomValue(number, Number.POSITIVE_INFINITY).ok).toBe(
			false,
		);
		expect(validateCustomValue(number, "abc").ok).toBe(false);
	});

	test("date and datetime need a real date and an offset", () => {
		const date = unitField("date");
		expect(validateCustomValue(date, "2026-01-31")).toEqual(ok("2026-01-31"));
		expect(validateCustomValue(date, "2026-02-30").ok).toBe(false);
		expect(validateCustomValue(date, "31-01-2026").ok).toBe(false);

		const datetime = unitField("datetime");
		expect(validateCustomValue(datetime, "2026-01-31T10:00:00Z")).toEqual(
			ok("2026-01-31T10:00:00.000Z"),
		);
		expect(validateCustomValue(datetime, "2026-01-31T10:00:00+02:00")).toEqual(
			ok("2026-01-31T08:00:00.000Z"),
		);
		expect(validateCustomValue(datetime, "2026-01-31T10:00:00").ok).toBe(false);
	});

	test("url only accepts http and https", () => {
		const url = unitField("url");
		expect(validateCustomValue(url, "https://example.test/a")).toEqual(
			ok("https://example.test/a"),
		);
		expect(validateCustomValue(url, "javascript:alert(1)").ok).toBe(false);
		expect(
			validateCustomValue(url, `https://e.test/${"x".repeat(2000)}`).ok,
		).toBe(false);
	});

	test("labels reject spaces and keep at most 50", () => {
		const labels = unitField("labels");
		expect(validateCustomValue(labels, ["a", "b", "a"])).toEqual(
			ok(["a", "b"]),
		);
		expect(validateCustomValue(labels, ["a b"]).ok).toBe(false);
		expect(
			validateCustomValue(
				labels,
				Array.from({ length: 51 }, (_, index) => `l${index}`),
			).ok,
		).toBe(false);
		expect(validateCustomValue(labels, []).ok).toBe(true);
	});

	test("select options must exist, disabled ones only when already stored", () => {
		const select = unitField("select", [
			{ value: "A" },
			{ value: "B", disabled: true },
		]);
		expect(validateCustomValue(select, "A")).toEqual(
			ok({ value: "A", id: select.options[0].id }),
		);
		expect(validateCustomValue(select, { value: "A" })).toEqual(
			ok({ value: "A", id: select.options[0].id }),
		);
		expect(validateCustomValue(select, "C").ok).toBe(false);
		expect(validateCustomValue(select, { id: select.options[1].id }).ok).toBe(
			false,
		);
		expect(
			validateCustomValue(select, "B", {
				current: { value: "B", id: select.options[1].id },
			}),
		).toEqual(ok({ value: "B", id: select.options[1].id }));
		// an old stored shape without an id is tolerated
		expect(
			validateCustomValue(select, "B", { current: { value: "B" } }),
		).toEqual(ok({ value: "B", id: select.options[1].id }));
	});

	test("multiselect takes a list of options", () => {
		const multiselect = unitField("multiselect", [
			{ value: "A" },
			{ value: "B" },
		]);
		expect(validateCustomValue(multiselect, ["A", "B"])).toEqual(
			ok([
				{ value: "A", id: multiselect.options[0].id },
				{ value: "B", id: multiselect.options[1].id },
			]),
		);
		expect(validateCustomValue(multiselect, "A").ok).toBe(false);
		expect(validateCustomValue(multiselect, ["A", "Z"]).ok).toBe(false);
	});

	test("cascading needs a child of the chosen parent", () => {
		const cascading = unitField("cascading", [
			{ value: "Hardware" },
			{ value: "Software" },
			{ value: "Disc", parent: 0 },
			{ value: "Tape", parent: 0 },
		]);
		const parent = cascading.options[0];
		const child = cascading.options[2];
		expect(validateCustomValue(cascading, "Hardware").ok).toBe(false);
		expect(
			validateCustomValue(cascading, { value: "Hardware", child: "Disc" }),
		).toEqual(
			ok({
				value: "Hardware",
				id: parent.id,
				child: { value: "Disc", id: child.id },
			}),
		);
		expect(
			validateCustomValue(cascading, { value: "Hardware", child: "Tape" }).ok,
		).toBe(true);
		expect(
			validateCustomValue(cascading, { value: "Software", child: "Disc" }).ok,
		).toBe(false);
		expect(validateCustomValue(cascading, "Software")).toEqual(
			ok({ value: "Software", id: cascading.options[1].id }),
		);
	});

	test("users must be active and multiuser takes a list", () => {
		const users = [
			{
				id: randomUUID(),
				username: `t-${run}-active`,
				displayName: "Active User",
			},
		];
		const user = unitField("user");
		expect(validateCustomValue(user, users[0].id, { users })).toEqual(
			ok({
				id: users[0].id,
				name: users[0].username,
				displayName: users[0].displayName,
			}),
		);
		expect(validateCustomValue(user, users[0].username, { users })).toEqual(
			ok({
				id: users[0].id,
				name: users[0].username,
				displayName: users[0].displayName,
			}),
		);
		expect(validateCustomValue(user, randomUUID(), { users }).ok).toBe(false);
		expect(validateCustomValue(user, randomUUID(), { users: [] }).ok).toBe(
			false,
		);

		const multiuser = unitField("multiuser");
		expect(validateCustomValue(multiuser, [users[0].id], { users })).toEqual(
			ok([
				{
					id: users[0].id,
					name: users[0].username,
					displayName: users[0].displayName,
				},
			]),
		);
		expect(validateCustomValue(multiuser, [randomUUID()], { users }).ok).toBe(
			false,
		);
	});
});

describe("custom field administration", () => {
	test("creates a field, allocates a customfield id and lists it", async () => {
		const created = await createField({
			name: `${tag} Notes`,
			type: "text",
			description: "Free text",
		});
		expect(created).toMatchObject({
			name: `${tag} Notes`,
			description: "Free text",
			type: "text",
			configurable: true,
			required: false,
			optionCount: 0,
			issueCount: 0,
			contexts: [],
			options: [],
		});
		expect(created.sourceId).toMatch(/^customfield_\d+$/);
		expect(
			Number(created.sourceId.replace("customfield_", "")),
		).toBeGreaterThan(10_299);

		const list = await inject("GET", "/api/admin/custom-fields");
		expectStatus(list, 200);
		const found = list
			.json()
			.find((field: { id: string }) => field.id === created.id);
		expect(found).toMatchObject({
			type: "text",
			configurable: true,
			optionCount: 0,
			contexts: [],
		});

		const patched = await inject(
			"PATCH",
			`/api/admin/custom-fields/${created.id}`,
			{ name: `${tag} Notes renamed`, description: null, required: true },
		);
		expectStatus(patched, 200);
		expect(patched.json()).toMatchObject({
			name: `${tag} Notes renamed`,
			description: null,
			required: true,
		});
	});

	test("rejects a duplicate name case-insensitively and a duplicate option", async () => {
		const field = await createField({ name: `${tag} Unique`, type: "text" });
		const duplicate = await inject("POST", "/api/admin/custom-fields", {
			name: `${tag} unique`,
			type: "text",
		});
		expect(duplicate.statusCode).toBe(409);
		expect(duplicate.json().error).toContain("already exists");

		const select = await createField({
			name: `${tag} Pick`,
			type: "select",
		});
		await addOption(select.id, "Alpha");
		const again = await inject(
			"POST",
			`/api/admin/custom-fields/${select.id}/options`,
			{ value: "alpha" },
		);
		expect(again.statusCode).toBe(409);
		expect(field.id).toBeTruthy();
	});

	test("a system field is listed but cannot be changed", async () => {
		const [system] = await db
			.insert(fields)
			.values({
				sourceId: `${tag}:system-field`,
				name: `${tag} System field`,
				type: "sd-approvals",
				customKey: "com.atlassian.servicedesk.approvals-plugin:sd-approvals",
			})
			.returning();
		createdFieldIds.push(system.id);

		const list = await inject("GET", "/api/admin/custom-fields");
		const found = list
			.json()
			.find((field: { id: string }) => field.id === system.id);
		expect(found).toMatchObject({
			type: null,
			configurable: false,
			optionCount: 0,
		});

		const patch = await inject(
			"PATCH",
			`/api/admin/custom-fields/${system.id}`,
			{
				name: "Renamed",
			},
		);
		expect(patch.statusCode).toBe(409);
		const remove = await inject(
			"DELETE",
			`/api/admin/custom-fields/${system.id}`,
		);
		expect(remove.statusCode).toBe(409);
		expect(remove.json()).toMatchObject({ count: 0, canMigrate: false });
		const contexts = await inject(
			"PUT",
			`/api/admin/custom-fields/${system.id}/contexts`,
			{ contexts: [] },
		);
		expect(contexts.statusCode).toBe(409);
	});

	test("contexts decide where a field applies", async () => {
		const projectOnly = await createField({
			name: `${tag} Ctx project`,
			type: "text",
		});
		const bugOnly = await createField({
			name: `${tag} Ctx bug`,
			type: "text",
		});
		const both = await createField({ name: `${tag} Ctx both`, type: "text" });
		const nowhere = await createField({
			name: `${tag} Ctx nowhere`,
			type: "text",
		});
		const everywhere = await createField({
			name: `${tag} Ctx everywhere`,
			type: "text",
		});

		await setContexts(projectOnly.id, [{ projectId }]);
		await setContexts(bugOnly.id, [{ issueTypeId: bugTypeId }]);
		await setContexts(both.id, [{ projectId, issueTypeId: bugTypeId }]);
		await setContexts(everywhere.id, [
			{ projectId: null, issueTypeId: null },
			{ projectId: null, issueTypeId: null },
		]);

		const names = (body: { name: string }[]) =>
			body.map((field) => field.name).filter((name) => name.includes(tag));

		const all = await publicFields();
		expectStatus(all, 200);
		expect(names(all.json()).sort()).toEqual(
			[
				`${tag} Ctx project`,
				`${tag} Ctx bug`,
				`${tag} Ctx both`,
				`${tag} Ctx everywhere`,
			].sort(),
		);

		const task = await publicFields(taskTypeId);
		expect(names(task.json()).sort()).toEqual(
			[`${tag} Ctx project`, `${tag} Ctx everywhere`].sort(),
		);

		const bug = await publicFields(bugTypeId);
		expect(names(bug.json()).sort()).toEqual(
			[
				`${tag} Ctx project`,
				`${tag} Ctx bug`,
				`${tag} Ctx both`,
				`${tag} Ctx everywhere`,
			].sort(),
		);

		const missing = await injectAs(
			app,
			member.session,
			"GET",
			"/api/projects/NOPE999/custom-fields",
		);
		expect(missing.statusCode).toBe(404);

		const replaced = await setContexts(both.id, []);
		expect(replaced).toEqual([]);
		const after = await publicFields(bugTypeId);
		expect(names(after.json())).not.toContain(`${tag} Ctx both`);

		const unknown = await inject(
			"PUT",
			`/api/admin/custom-fields/${both.id}/contexts`,
			{ contexts: [{ projectId: randomUUID() }] },
		);
		expect(unknown.statusCode).toBe(400);
		expect(nowhere.id).toBeTruthy();
	});

	test("issue create validates required fields and stores values", async () => {
		const strictType = await newIssueType("Strict");
		const text = await createField({
			name: `${tag} Summary note`,
			type: "text",
		});
		const number = await createField({
			name: `${tag} Estimate`,
			type: "number",
		});
		const select = await createField({
			name: `${tag} Stage`,
			type: "select",
			required: true,
		});
		const person = await createField({ name: `${tag} Person`, type: "user" });
		const alpha = await addOption(select.id, "Alpha");
		await addOption(select.id, "Beta");
		for (const field of [text, number, person]) {
			await setContexts(field.id, [{ projectId }]);
		}
		await setContexts(select.id, [{ projectId, issueTypeId: strictType }]);

		const missing = await createIssue({
			type: strictType,
			customFields: { [text.id]: "hello" },
		});
		expect(missing.statusCode).toBe(400);
		expect(missing.json().error).toBe(`${tag} Stage: is required`);

		const invalid = await createIssue({
			type: strictType,
			customFields: { [select.id]: "Gamma" },
		});
		expect(invalid.statusCode).toBe(400);
		expect(invalid.json().error).toContain(`${tag} Stage:`);

		const unknown = await createIssue({
			type: strictType,
			customFields: { [randomUUID()]: "x", [select.id]: "Alpha" },
		});
		expect(unknown.statusCode).toBe(400);
		expect(unknown.json().error).toContain("unknown custom field");

		const inactive = await createIssue({
			type: strictType,
			customFields: { [select.id]: "Alpha", [person.id]: inactiveUser.id },
		});
		expect(inactive.statusCode).toBe(400);
		expect(inactive.json().error).toBe(`${tag} Person: must be an active user`);

		const created = await createIssue({
			type: strictType,
			customFields: {
				[text.id]: "  hello  ",
				[number.id]: 8,
				[select.id]: alpha.id,
				[person.id]: otherUser.id,
			},
		});
		expectStatus(created, 201);
		const issue = created.json();
		const editable = issue.editableCustomFields as {
			id: string;
			type: string;
			value: unknown;
		}[];
		const byId = new Map(editable.map((field) => [field.id, field]));
		expect(byId.get(text.id)?.value).toBe("hello");
		expect(byId.get(number.id)?.value).toBe(8);
		expect(byId.get(select.id)?.value).toEqual({
			value: "Alpha",
			id: alpha.id,
		});
		expect(byId.get(person.id)?.value).toEqual({
			id: otherUser.id,
			name: otherUser.username,
			displayName: `Test other ${run}`,
		});
		expect(
			issue.customFields.map((field: { id: string }) => field.id),
		).not.toContain(text.id);
	});

	test("a field outside the issue context is refused", async () => {
		const bugOnly = await createField({
			name: `${tag} Bug only`,
			type: "text",
		});
		await setContexts(bugOnly.id, [{ projectId, issueTypeId: bugTypeId }]);
		const refused = await createIssue({
			customFields: { [bugOnly.id]: "x" },
		});
		expect(refused.statusCode).toBe(400);
		expect(refused.json().error).toBe(
			`${tag} Bug only: does not apply to this project and issue type`,
		);

		const bug = await injectAs(app, member.session, "POST", "/api/issues", {
			project: projectKey,
			type: bugTypeId,
			summary: `Bug ${randomUUID().slice(0, 8)}`,
			customFields: { [bugOnly.id]: "x" },
		});
		expectStatus(bug, 201);
	});

	test("patch updates values, writes history and bumps updated", async () => {
		const text = await createField({ name: `${tag} Patch note`, type: "text" });
		const select = await createField({
			name: `${tag} Patch stage`,
			type: "select",
		});
		const alpha = await addOption(select.id, "Alpha");
		const beta = await addOption(select.id, "Beta");
		await setContexts(text.id, [{ projectId }]);
		await setContexts(select.id, [{ projectId }]);

		const created = await createIssue({
			customFields: { [text.id]: "first", [select.id]: "Alpha" },
		});
		expectStatus(created, 201);
		const issue = created.json();

		const patched = await injectAs(
			app,
			member.session,
			"PATCH",
			`/api/issues/${issue.key}`,
			{ customFields: { [text.id]: "second", [select.id]: beta.id } },
		);
		expectStatus(patched, 200);
		const body = patched.json();
		const values = new Map(
			(body.editableCustomFields as { id: string; value: unknown }[]).map(
				(field) => [field.id, field.value],
			),
		);
		expect(values.get(text.id)).toBe("second");
		expect(values.get(select.id)).toEqual({ value: "Beta", id: beta.id });
		expect(new Date(body.updated).getTime()).toBeGreaterThanOrEqual(
			new Date(issue.updated).getTime(),
		);

		const history = await injectAs(
			app,
			member.session,
			"GET",
			`/api/issues/${issue.key}/history`,
		);
		expectStatus(history, 200);
		const items = history
			.json()
			.flatMap((entry: { items: unknown[] }) => entry.items) as {
			field: string;
			fieldType: string;
			from: string | null;
			fromText: string | null;
			to: string | null;
			toText: string | null;
		}[];
		const textItem = items.find((item) => item.field === `${tag} Patch note`);
		expect(textItem).toMatchObject({
			fieldType: "custom",
			fromText: "first",
			toText: "second",
		});
		const selectItem = items.find(
			(item) => item.field === `${tag} Patch stage`,
		);
		expect(selectItem).toMatchObject({
			fieldType: "custom",
			fromText: "Alpha",
			toText: "Beta",
			from: alpha.id,
			to: beta.id,
		});
		expect(alpha.value).toBe("Alpha");
	});

	test("a required field cannot be cleared but an unrelated edit passes", async () => {
		const strictType = await newIssueType("Strict clear");
		const required = await createField({
			name: `${tag} Required`,
			type: "text",
			required: true,
		});
		const optional = await createField({
			name: `${tag} Optional`,
			type: "text",
		});
		await setContexts(required.id, [{ projectId, issueTypeId: strictType }]);
		await setContexts(optional.id, [{ projectId, issueTypeId: strictType }]);

		const created = await createIssue({
			type: strictType,
			customFields: { [required.id]: "value" },
		});
		expectStatus(created, 201);
		const issue = created.json();

		const cleared = await injectAs(
			app,
			member.session,
			"PATCH",
			`/api/issues/${issue.key}`,
			{ customFields: { [required.id]: null } },
		);
		expect(cleared.statusCode).toBe(400);
		expect(cleared.json().error).toBe(`${tag} Required: is required`);

		const unrelated = await injectAs(
			app,
			member.session,
			"PATCH",
			`/api/issues/${issue.key}`,
			{ customFields: { [optional.id]: "other" } },
		);
		expectStatus(unrelated, 200);
		const values = new Map(
			(
				unrelated.json().editableCustomFields as {
					id: string;
					value: unknown;
				}[]
			).map((field) => [field.id, field.value]),
		);
		expect(values.get(required.id)).toBe("value");
		expect(values.get(optional.id)).toBe("other");
	});

	test("renaming an option rewrites stored values", async () => {
		const select = await createField({
			name: `${tag} Rename`,
			type: "select",
		});
		const option = await addOption(select.id, "Old");
		await setContexts(select.id, [{ projectId }]);

		const created = await createIssue({
			customFields: { [select.id]: option.id },
		});
		expectStatus(created, 201);
		const issue = created.json();

		const renamed = await inject(
			"PATCH",
			`/api/admin/custom-fields/${select.id}/options/${option.id}`,
			{ value: "New" },
		);
		expectStatus(renamed, 200);
		expect(renamed.json()).toMatchObject({ value: "New", disabled: false });

		const after = await detail(issue.key);
		const field = (
			after.editableCustomFields as {
				id: string;
				value: unknown;
			}[]
		).find((item) => item.id === select.id);
		expect(field?.value).toEqual({ value: "New", id: option.id });

		const disabled = await inject(
			"PATCH",
			`/api/admin/custom-fields/${select.id}/options/${option.id}`,
			{ disabled: true },
		);
		expectStatus(disabled, 200);
		const list = await publicFields();
		const listed = list
			.json()
			.find((item: { id: string }) => item.id === select.id);
		expect(listed.options).toEqual([]);
		const withDisabled = await injectAs(
			app,
			member.session,
			"GET",
			`/api/projects/${projectKey}/custom-fields?includeDisabled=1`,
		);
		const all = withDisabled
			.json()
			.find((item: { id: string }) => item.id === select.id);
		expect(all.options[0]).toMatchObject({ value: "New", disabled: true });

		// a disabled option stays visible on an issue that already holds it
		const afterDisable = await detail(issue.key);
		const editable = (
			afterDisable.editableCustomFields as {
				id: string;
				options: { id: string; value: string; disabled: boolean }[];
			}[]
		).find((item) => item.id === select.id);
		expect(editable?.options).toEqual([
			{ id: option.id, value: "New", disabled: true, children: [] },
		]);
	});

	test("deleting an option is refused while used and can migrate", async () => {
		const select = await createField({
			name: `${tag} Option delete`,
			type: "select",
		});
		const one = await addOption(select.id, "One");
		const two = await addOption(select.id, "Two");
		const unused = await addOption(select.id, "Unused");
		await setContexts(select.id, [{ projectId }]);

		const created = await createIssue({
			customFields: { [select.id]: one.id },
		});
		expectStatus(created, 201);
		const issue = created.json();

		const refused = await inject(
			"DELETE",
			`/api/admin/custom-fields/${select.id}/options/${one.id}`,
		);
		expect(refused.statusCode).toBe(409);
		expect(refused.json()).toMatchObject({ count: 1, canMigrate: true });

		const migrated = await inject(
			"DELETE",
			`/api/admin/custom-fields/${select.id}/options/${one.id}?migrateTo=${two.id}`,
		);
		expectStatus(migrated, 204);

		const after = await detail(issue.key);
		const field = (
			after.editableCustomFields as {
				id: string;
				value: unknown;
			}[]
		).find((item) => item.id === select.id);
		expect(field?.value).toEqual({ value: "Two", id: two.id });

		const removed = await inject(
			"DELETE",
			`/api/admin/custom-fields/${select.id}/options/${unused.id}`,
		);
		expectStatus(removed, 204);
	});

	test("deleting a cascading parent counts its children", async () => {
		const cascading = await createField({
			name: `${tag} Cascade`,
			type: "cascading",
		});
		const hardware = await addOption(cascading.id, "Hardware");
		const disc = await addOption(cascading.id, "Disc", hardware.id);
		await setContexts(cascading.id, [{ projectId }]);

		const created = await createIssue({
			customFields: { [cascading.id]: { value: "Hardware", child: "Disc" } },
		});
		expectStatus(created, 201);

		const refused = await inject(
			"DELETE",
			`/api/admin/custom-fields/${cascading.id}/options/${hardware.id}`,
		);
		expect(refused.statusCode).toBe(409);
		expect(refused.json()).toMatchObject({ count: 1 });

		const childRefused = await inject(
			"DELETE",
			`/api/admin/custom-fields/${cascading.id}/options/${disc.id}`,
		);
		expect(childRefused.statusCode).toBe(409);
		expect(childRefused.json()).toMatchObject({ count: 1 });
	});

	test("legacy string values are migrated with the option", async () => {
		const select = await createField({
			name: `${tag} Legacy select`,
			type: "select",
		});
		const high = await addOption(select.id, "High");
		const low = await addOption(select.id, "Low");
		await setContexts(select.id, [{ projectId }]);
		const selectIssue = (await createIssue()).json();
		await db
			.update(issues)
			.set({ custom: { [select.sourceId]: "High" } })
			.where(eq(issues.id, selectIssue.id));
		expectStatus(
			await inject(
				"DELETE",
				`/api/admin/custom-fields/${select.id}/options/${high.id}?migrateTo=${low.id}`,
			),
			204,
		);
		const [selectRow] = await db
			.select({ custom: issues.custom })
			.from(issues)
			.where(eq(issues.id, selectIssue.id));
		const selectCustom = selectRow?.custom as
			| Record<string, unknown>
			| undefined;
		expect(selectCustom?.[select.sourceId]).toEqual({
			value: "Low",
			id: low.id,
		});

		const multi = await createField({
			name: `${tag} Legacy multi`,
			type: "multiselect",
		});
		const highMulti = await addOption(multi.id, "High");
		await addOption(multi.id, "Low");
		const mediumMulti = await addOption(multi.id, "Medium");
		await setContexts(multi.id, [{ projectId }]);
		const multiIssue = (await createIssue()).json();
		await db
			.update(issues)
			.set({ custom: { [multi.sourceId]: ["High", "Low"] } })
			.where(eq(issues.id, multiIssue.id));
		expectStatus(
			await inject(
				"DELETE",
				`/api/admin/custom-fields/${multi.id}/options/${highMulti.id}?migrateTo=${mediumMulti.id}`,
			),
			204,
		);
		const [multiRow] = await db
			.select({ custom: issues.custom })
			.from(issues)
			.where(eq(issues.id, multiIssue.id));
		const multiCustom = multiRow?.custom as Record<string, unknown> | undefined;
		expect(multiCustom?.[multi.sourceId]).toEqual([
			{ value: "Medium", id: mediumMulti.id },
			"Low",
		]);

		const cascade = await createField({
			name: `${tag} Legacy cascade`,
			type: "cascading",
		});
		const hardware = await addOption(cascade.id, "Hardware");
		await addOption(cascade.id, "Disc", hardware.id);
		const replacement = await addOption(cascade.id, "Replacement");
		const replacementDisc = await addOption(cascade.id, "Disc", replacement.id);
		await setContexts(cascade.id, [{ projectId }]);
		const cascadeIssue = (await createIssue()).json();
		await db
			.update(issues)
			.set({
				custom: {
					[cascade.sourceId]: {
						value: "Hardware",
						id: hardware.id,
						child: "Disc",
					},
				},
			})
			.where(eq(issues.id, cascadeIssue.id));
		expectStatus(
			await inject(
				"DELETE",
				`/api/admin/custom-fields/${cascade.id}/options/${hardware.id}?migrateTo=${replacement.id}`,
			),
			204,
		);
		const [cascadeRow] = await db
			.select({ custom: issues.custom })
			.from(issues)
			.where(eq(issues.id, cascadeIssue.id));
		const cascadeCustom = cascadeRow?.custom as
			| Record<string, unknown>
			| undefined;
		expect(cascadeCustom?.[cascade.sourceId]).toEqual({
			value: "Replacement",
			id: replacement.id,
			child: { value: "Disc", id: replacementDisc.id },
		});
	});

	test("option order is rewritten for one sibling set only", async () => {
		const select = await createField({
			name: `${tag} Order`,
			type: "select",
		});
		const first = await addOption(select.id, "First");
		const second = await addOption(select.id, "Second");
		const third = await addOption(select.id, "Third");

		const reordered = await inject(
			"PUT",
			`/api/admin/custom-fields/${select.id}/options/order`,
			{ ids: [third.id, first.id, second.id] },
		);
		expectStatus(reordered, 200);
		expect(
			(reordered.json() as { value: string }[]).map((item) => item.value),
		).toEqual(["Third", "First", "Second"]);

		const wrong = await inject(
			"PUT",
			`/api/admin/custom-fields/${select.id}/options/order`,
			{ ids: [first.id] },
		);
		expect(wrong.statusCode).toBe(400);

		const unknownParent = await inject(
			"PUT",
			`/api/admin/custom-fields/${select.id}/options/order`,
			{ parentOptionId: randomUUID(), ids: [first.id, second.id, third.id] },
		);
		expect(unknownParent.statusCode).toBe(400);
	});

	test("deleting a field needs a migration once it holds values", async () => {
		const source = await createField({ name: `${tag} Source`, type: "text" });
		const target = await createField({ name: `${tag} Target`, type: "text" });
		const other = await createField({
			name: `${tag} Other type`,
			type: "number",
		});
		await setContexts(source.id, [{ projectId }]);
		await setContexts(target.id, [{ projectId }]);

		const created = await createIssue({
			customFields: { [source.id]: "carried over" },
		});
		expectStatus(created, 201);
		const issue = created.json();

		const refused = await inject(
			"DELETE",
			`/api/admin/custom-fields/${source.id}`,
		);
		expect(refused.statusCode).toBe(409);
		expect(refused.json()).toMatchObject({ count: 1, canMigrate: true });

		const unsupported = await inject(
			"DELETE",
			`/api/admin/custom-fields/${source.id}?deleteValues=1`,
		);
		expect(unsupported.statusCode).toBe(409);

		const wrongType = await inject(
			"DELETE",
			`/api/admin/custom-fields/${source.id}?migrateTo=${other.id}`,
		);
		expect(wrongType.statusCode).toBe(400);

		const migrated = await inject(
			"DELETE",
			`/api/admin/custom-fields/${source.id}?migrateTo=${target.id}`,
		);
		expectStatus(migrated, 204);

		const after = await detail(issue.key);
		const values = new Map(
			(after.editableCustomFields as { id: string; value: unknown }[]).map(
				(field) => [field.id, field.value],
			),
		);
		expect(values.has(source.id)).toBe(false);
		expect(values.get(target.id)).toBe("carried over");

		const empty = await inject(
			"DELETE",
			`/api/admin/custom-fields/${target.id}`,
		);
		expect(empty.statusCode).toBe(409);
	});

	test("a field migration refuses to overwrite an existing target value", async () => {
		const source = await createField({
			name: `${tag} Conflict source`,
			type: "text",
		});
		const target = await createField({
			name: `${tag} Conflict target`,
			type: "text",
		});
		await setContexts(source.id, [{ projectId }]);
		await setContexts(target.id, [{ projectId }]);

		const created = await createIssue({
			customFields: {
				[source.id]: "source value",
				[target.id]: "target value",
			},
		});
		expectStatus(created, 201);
		const issue = created.json();

		const refused = await inject(
			"DELETE",
			`/api/admin/custom-fields/${source.id}?migrateTo=${target.id}`,
		);
		expect(refused.statusCode).toBe(409);
		expect(refused.json().error).toContain("target field");

		const after = await detail(issue.key);
		const values = new Map(
			(after.editableCustomFields as { id: string; value: unknown }[]).map(
				(field) => [field.id, field.value],
			),
		);
		expect(values.get(source.id)).toBe("source value");
		expect(values.get(target.id)).toBe("target value");
	});

	test("a select field can migrate to another select by option value", async () => {
		const source = await createField({
			name: `${tag} Migrate from`,
			type: "select",
		});
		const target = await createField({
			name: `${tag} Migrate to`,
			type: "select",
		});
		await addOption(source.id, "Shared");
		await addOption(target.id, "Shared");
		await setContexts(source.id, [{ projectId }]);
		await setContexts(target.id, [{ projectId }]);

		const created = await createIssue({
			customFields: { [source.id]: "Shared" },
		});
		expectStatus(created, 201);
		const issue = created.json();

		const missingTarget = await createField({
			name: `${tag} Migrate empty`,
			type: "select",
		});
		await addOption(missingTarget.id, "Different");
		const refused = await inject(
			"DELETE",
			`/api/admin/custom-fields/${source.id}?migrateTo=${missingTarget.id}`,
		);
		expect(refused.statusCode).toBe(400);
		expect(refused.json().error).toContain('"Shared"');

		const migrated = await inject(
			"DELETE",
			`/api/admin/custom-fields/${source.id}?migrateTo=${target.id}`,
		);
		expectStatus(migrated, 204);
		const after = await detail(issue.key);
		const values = new Map(
			(after.editableCustomFields as { id: string; value: unknown }[]).map(
				(field) => [field.id, field.value],
			),
		);
		expect(values.has(source.id)).toBe(false);
		expect(values.get(target.id)).toEqual({
			value: "Shared",
			id: expect.any(String),
		});
	});

	test("the admin guard answers 400 or 404, never 500", async () => {
		const urls = [
			["POST", "/api/admin/custom-fields"],
			["GET", `/api/admin/custom-fields/${randomUUID()}`],
			["PATCH", `/api/admin/custom-fields/${randomUUID()}`],
			["DELETE", `/api/admin/custom-fields/${randomUUID()}`],
			["POST", `/api/admin/custom-fields/${randomUUID()}/options`],
			[
				"PATCH",
				`/api/admin/custom-fields/${randomUUID()}/options/${randomUUID()}`,
			],
			[
				"DELETE",
				`/api/admin/custom-fields/${randomUUID()}/options/${randomUUID()}`,
			],
			["PUT", `/api/admin/custom-fields/${randomUUID()}/options/order`],
			["PUT", `/api/admin/custom-fields/${randomUUID()}/contexts`],
		] as const;
		for (const [method, url] of urls) {
			const response = await inject(method, url, {});
			expect(
				[400, 404],
				`${method} ${url} -> ${response.statusCode} ${response.body}`,
			).toContain(response.statusCode);
		}
	});

	test("JQL reaches the new fields where the compiler supports the type", async () => {
		const select = await createField({
			name: `${tag} Jql select`,
			type: "select",
		});
		const alpha = await addOption(select.id, "Alpha");
		await addOption(select.id, "Beta");
		const text = await createField({ name: `${tag} Jql text`, type: "text" });
		const number = await createField({
			name: `${tag} Jql number`,
			type: "number",
		});
		const multiselect = await createField({
			name: `${tag} Jql multiselect`,
			type: "multiselect",
		});
		const labels = await createField({
			name: `${tag} Jql labels`,
			type: "labels",
		});
		const user = await createField({ name: `${tag} Jql user`, type: "user" });
		const multiuser = await createField({
			name: `${tag} Jql multiuser`,
			type: "multiuser",
		});
		const date = await createField({ name: `${tag} Jql date`, type: "date" });
		const cascading = await createField({
			name: `${tag} Jql cascade`,
			type: "cascading",
		});
		const hardware = await addOption(cascading.id, "Hardware");
		await addOption(cascading.id, "Disc", hardware.id);
		const multiuserOption = await addOption(multiselect.id, "Gamma");
		for (const field of [
			select,
			text,
			number,
			date,
			cascading,
			multiselect,
			labels,
			user,
			multiuser,
		]) {
			await setContexts(field.id, [{ projectId }]);
		}

		const created = await createIssue({
			customFields: {
				[select.id]: alpha.id,
				[text.id]: "searchable needle",
				[number.id]: 42,
				[date.id]: "2026-01-31",
				[cascading.id]: { value: "Hardware", child: "Disc" },
				[multiselect.id]: [multiuserOption.id],
				[labels.id]: ["needle-label"],
				[user.id]: otherUser.id,
				[multiuser.id]: [otherUser.id],
			},
		});
		expectStatus(created, 201);
		const issue = created.json();
		const cf = (field: { sourceId: string }) =>
			`cf[${field.sourceId.replace("customfield_", "")}]`;

		const search = (jql: string) =>
			injectAs(
				app,
				member.session,
				"GET",
				`/api/search?jql=${encodeURIComponent(jql)}`,
			);

		const byId = await search(`${cf(select)} = "Alpha"`);
		expectStatus(byId, 200);
		expect(
			byId.json().issues.map((item: { key: string }) => item.key),
		).toContain(issue.key);

		const byName = await search(`"${tag} Jql select" = "Alpha"`);
		expectStatus(byName, 200);
		expect(
			byName.json().issues.map((item: { key: string }) => item.key),
		).toContain(issue.key);

		const byText = await search(`${cf(text)} ~ "needle"`);
		expectStatus(byText, 200);
		expect(
			byText.json().issues.map((item: { key: string }) => item.key),
		).toContain(issue.key);

		const byNumber = await search(`${cf(number)} = 42`);
		expectStatus(byNumber, 200);
		expect(
			byNumber.json().issues.map((item: { key: string }) => item.key),
		).toContain(issue.key);

		const byDate = await search(`${cf(date)} = "2026-01-31"`);
		expectStatus(byDate, 200);
		expect(
			byDate.json().issues.map((item: { key: string }) => item.key),
		).toContain(issue.key);

		const byCascade = await search(`${cf(cascading)} = "Disc"`);
		expectStatus(byCascade, 200);
		expect(
			byCascade.json().issues.map((item: { key: string }) => item.key),
		).toContain(issue.key);

		const byUser = await search(`${cf(multiuser)} = "${otherUser.username}"`);
		expectStatus(byUser, 200);
		expect(
			byUser.json().issues.map((item: { key: string }) => item.key),
		).toContain(issue.key);

		for (const field of [multiselect, labels, user]) {
			const refused = await search(`${cf(field)} = "Gamma"`);
			expect(
				refused.statusCode,
				`${field.type} should not be searchable: ${refused.body}`,
			).toBe(400);
		}
	});

	test("every mutating admin route wrote an audit row", async () => {
		const rows = await db
			.select({ action: auditLog.action })
			.from(auditLog)
			.where(inArray(auditLog.entityId, createdFieldIds));
		const actions = new Set(rows.map((row) => row.action));
		expect([...actions].sort()).toEqual(
			[
				"field.contexts.update",
				"field.create",
				"field.delete",
				"field.migrate",
				"field.option.create",
				"field.option.delete",
				"field.option.reorder",
				"field.option.update",
				"field.update",
			].sort(),
		);
	});

	test("every admin type can be created and read back", async () => {
		for (const type of adminFieldTypes) {
			const field = await createField({
				name: `${tag} Type ${type}`,
				type,
			});
			const fetched = await inject(
				"GET",
				`/api/admin/custom-fields/${field.id}`,
			);
			expectStatus(fetched, 200);
			expect(fetched.json()).toMatchObject({
				id: field.id,
				type,
				configurable: true,
			});
		}
	});
});
