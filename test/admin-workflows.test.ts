import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
	type Definition,
	describeChanges,
	orderStatuses,
	reachableStatuses,
	shapeProblem,
	validateDefinition,
} from "../src/lib/server/admin/workflow-definition.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	issues,
	issueTypes,
	projectIssueTypes,
	projects,
	projectWorkflows,
	resolutions,
	statuses,
	workflowStatuses,
	workflows,
	workflowTransitions,
} from "../src/lib/server/schema.ts";
import { workflowDrafts } from "../src/lib/server/schema-admin.ts";
import {
	initialStatusFor,
	transitionsFrom,
} from "../src/lib/server/workflows.ts";
import { injectAs, makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import { buildServer, cleanupTestData, swapTransaction } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = newRun();
const tag = `t-${run}`;
const keyPrefix = `W${run.slice(0, 4).toUpperCase()}`;

let app: TestApp;
let admin: TestUser;
let member: TestUser;

type Category = "new" | "indeterminate" | "done";
const statusId: Record<string, string> = {};
const typeId: Record<string, string> = {};
const resolutionId: Record<string, string> = {};

const nameOf = (label: string) => `${tag} ${label}`;

async function fixtureStatus(label: string, category: Category) {
	const [row] = await db
		.insert(statuses)
		.values({
			sourceId: `${tag}:status:${label}`,
			name: nameOf(label),
			category,
		})
		.returning();
	statusId[label] = row.id;
}

type TransitionSpec = {
	name: string;
	from: string | null;
	to: string;
	asks?: boolean;
};

async function fixtureWorkflow(
	label: string,
	statusLabels: string[],
	transitions: TransitionSpec[],
	initial: string | null,
) {
	const [workflow] = await db
		.insert(workflows)
		.values({
			sourceId: null,
			name: nameOf(label),
			initialStatusId: initial ? statusId[initial] : null,
		})
		.returning();
	await db.insert(workflowStatuses).values(
		statusLabels.map((status) => ({
			sourceId: null,
			workflowId: workflow.id,
			statusId: statusId[status],
		})),
	);
	const rows = transitions.length
		? await db
				.insert(workflowTransitions)
				.values(
					transitions.map((transition, sequence) => ({
						sourceId: null,
						workflowId: workflow.id,
						name: transition.name,
						fromStatusId: transition.from ? statusId[transition.from] : null,
						toStatusId: statusId[transition.to],
						asksResolution: transition.asks ?? false,
						sequence,
					})),
				)
				.returning()
		: [];
	return {
		id: workflow.id,
		name: workflow.name,
		transitionIds: Object.fromEntries(rows.map((row) => [row.name, row.id])),
	};
}

async function fixtureProject(
	label: string,
	workflowId: string | null,
	types: string[] = ["task"],
) {
	const key = `${keyPrefix}${label}`;
	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `${tag}:project:${label}`,
			key,
			name: nameOf(`project ${label}`),
			projectType: "software",
		})
		.returning();
	await db.insert(projectIssueTypes).values(
		types.map((type) => ({
			sourceId: null,
			projectId: project.id,
			issueTypeId: typeId[type],
		})),
	);
	if (workflowId) {
		await db.insert(projectWorkflows).values({
			sourceId: null,
			projectId: project.id,
			issueTypeId: null,
			workflowId,
		});
	}
	return { id: project.id, key };
}

const adminCall = (
	method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
	url: string,
	payload?: unknown,
) => injectAs(app, admin.session, method, url, payload);

async function createIssue(projectKey: string, type = "task") {
	const response = await adminCall("POST", "/api/issues", {
		project: projectKey,
		type: typeId[type],
		summary: `${tag} issue ${randomUUID().slice(0, 6)}`,
	});
	expect(response.statusCode).toBe(201);
	return response.json() as {
		key: string;
		status: { id: string; name: string };
	};
}

async function runTransition(
	issueKey: string,
	name: string,
	body: Record<string, unknown> = {},
) {
	const detail = (await adminCall("GET", `/api/issues/${issueKey}`)).json() as {
		transitions: { id: string; name: string; asksResolution: boolean }[];
	};
	const transition = detail.transitions.find((item) => item.name === name);
	expect(transition, `transition ${name}`).toBeDefined();
	return adminCall("POST", `/api/issues/${issueKey}/transitions`, {
		transitionId: transition?.id,
		...body,
	});
}

async function statusOfIssue(issueKey: string) {
	const [row] = await db
		.select({ id: issues.statusId, updated: issues.updated, id2: issues.id })
		.from(issues)
		.where(eq(issues.key, issueKey));
	return row;
}

type Detail = {
	hasDraft: boolean;
	mode: "draft" | "live";
	initialStatusId: string | null;
	statuses: { id: string; name: string; issueCount: number }[];
	transitions: {
		id: string;
		name: string;
		fromStatusId: string | null;
		toStatusId: string;
		asksResolution: boolean;
	}[];
};

async function detailOf(workflowId: string, query = ""): Promise<Detail> {
	const response = await adminCall(
		"GET",
		`/api/admin/workflows/${workflowId}${query}`,
	);
	expect(response.statusCode).toBe(200);
	return response.json();
}

function definitionOf(
	initial: string | null,
	statusLabels: string[],
	transitions: (TransitionSpec & { id?: string })[],
): Definition {
	return {
		initialStatusId: initial ? statusId[initial] : null,
		statuses: statusLabels.map((label) => statusId[label]),
		transitions: transitions.map((transition) => ({
			id: transition.id ?? randomUUID(),
			name: transition.name,
			fromStatusId: transition.from ? statusId[transition.from] : null,
			toStatusId: statusId[transition.to],
			asksResolution: transition.asks ?? false,
		})),
	};
}

const putDraft = (workflowId: string, definition: Definition) =>
	adminCall("PUT", `/api/admin/workflows/${workflowId}/draft`, definition);

const baseTransitions: TransitionSpec[] = [
	{ name: "Start", from: "open", to: "work" },
	{ name: "Finish", from: "work", to: "done" },
	{ name: "Reopen", from: "done", to: "open" },
];

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	await app.ready();
	admin = await makeUser(run, "admin", { admin: true });
	member = await makeUser(run, "member");

	await fixtureStatus("open", "new");
	await fixtureStatus("work", "indeterminate");
	await fixtureStatus("done", "done");
	await fixtureStatus("review", "indeterminate");
	await fixtureStatus("spare", "new");

	for (const label of ["task", "bug"]) {
		const [row] = await db
			.insert(issueTypes)
			.values({
				sourceId: `${tag}:type:${label}`,
				name: nameOf(label),
				subtask: false,
			})
			.returning();
		typeId[label] = row.id;
	}
	for (const label of ["fixed", "wontfix"]) {
		const [row] = await db
			.insert(resolutions)
			.values({ sourceId: `${tag}:resolution:${label}`, name: nameOf(label) })
			.returning();
		resolutionId[label] = row.id;
	}
});

afterAll(async () => {
	await app.close();
	await pool.query("delete from audit_log where actor_name like $1", [
		`% ${run}`,
	]);
	await db.delete(projects).where(like(projects.key, `${keyPrefix}%`));
	await db.delete(workflows).where(like(workflows.name, `${tag} %`));
	await db.delete(statuses).where(like(statuses.name, `${tag} %`));
	await db.delete(issueTypes).where(like(issueTypes.name, `${tag} %`));
	await db.delete(resolutions).where(like(resolutions.name, `${tag} %`));
	await cleanupTestData(run);
});

describe("workflow definition rules", () => {
	const a = randomUUID();
	const b = randomUUID();
	const c = randomUUID();
	const names = new Map([
		[a, "A"],
		[b, "B"],
		[c, "C"],
	]);
	const transition = (
		from: string | null,
		to: string,
		name = "Go",
	): Definition["transitions"][number] => ({
		id: randomUUID(),
		name,
		fromStatusId: from,
		toStatusId: to,
		asksResolution: false,
	});
	const validate = (
		definition: Definition,
		extra: Partial<Parameters<typeof validateDefinition>[0]> = {},
	) =>
		validateDefinition({
			definition,
			names,
			liveStatusIds: new Set(definition.statuses),
			issueCounts: new Map(),
			...extra,
		});
	const codes = (problems: { code: string }[]) =>
		problems.map((problem) => problem.code);

	test("a complete definition has no problems", () => {
		expect(
			validate({
				initialStatusId: a,
				statuses: [a, b],
				transitions: [transition(a, b)],
			}),
		).toEqual([]);
	});

	test("an initial status is required and must be one of the statuses", () => {
		const base = { statuses: [a, b], transitions: [transition(a, b)] };
		expect(codes(validate({ ...base, initialStatusId: null }))).toEqual([
			"no_initial_status",
		]);
		expect(codes(validate({ ...base, initialStatusId: c }))).toEqual([
			"no_initial_status",
		]);
	});

	test("unreachable statuses are reported, an any-status transition makes them reachable", () => {
		const definition: Definition = {
			initialStatusId: a,
			statuses: [a, b, c],
			transitions: [transition(a, b)],
		};
		const problems = validate(definition);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatchObject({
			code: "unreachable_status",
			statusId: c,
			statusName: "C",
		});

		const withAny = {
			...definition,
			transitions: [...definition.transitions, transition(null, c)],
		};
		expect(validate(withAny)).toEqual([]);
		expect(reachableStatuses(withAny)).toEqual(new Set([a, b, c]));
	});

	test("the same transition twice is a duplicate, other names or targets are not", () => {
		const definition: Definition = {
			initialStatusId: a,
			statuses: [a, b, c],
			transitions: [
				transition(a, b, "Go"),
				transition(a, b, "go"),
				transition(a, b, "Other"),
				transition(a, c, "Go"),
			],
		};
		expect(codes(validate(definition))).toEqual(["duplicate_transition"]);
	});

	test("a removed status in use needs a mapping to a status that stays", () => {
		const definition: Definition = {
			initialStatusId: a,
			statuses: [a, b],
			transitions: [transition(a, b)],
		};
		const input = {
			liveStatusIds: new Set([a, b, c]),
			issueCounts: new Map([[c, 4]]),
		};
		expect(validate(definition, input)).toEqual([
			expect.objectContaining({
				code: "removed_status_in_use",
				statusId: c,
				issueCount: 4,
			}),
		]);
		expect(
			validate(definition, { ...input, statusMapping: { [c]: b } }),
		).toEqual([]);
		expect(
			codes(validate(definition, { ...input, statusMapping: { [c]: c } })),
		).toEqual(["invalid_mapping"]);
		expect(
			codes(
				validate(definition, {
					...input,
					statusMapping: { [c]: randomUUID() },
				}),
			),
		).toEqual(["invalid_mapping"]);
		expect(
			validate(definition, {
				liveStatusIds: new Set([a, b, c]),
				issueCounts: new Map(),
			}),
		).toEqual([]);
		expect(
			codes(
				validate(definition, {
					liveStatusIds: new Set([a, b, c]),
					issueCounts: new Map(),
					statusMapping: { [c]: randomUUID() },
				}),
			),
		).toEqual(["invalid_mapping"]);
	});

	test("shape checks reject transitions that leave the workflow's statuses", () => {
		const ok: Definition = {
			initialStatusId: null,
			statuses: [a, b],
			transitions: [transition(a, b)],
		};
		expect(shapeProblem(ok)).toBeNull();
		expect(
			shapeProblem({ ...ok, transitions: [transition(a, c)] }),
		).not.toBeNull();
		expect(shapeProblem({ ...ok, statuses: [a, a, b] })).not.toBeNull();
		expect(
			shapeProblem({ ...ok, transitions: [transition(a, a)] }),
		).not.toBeNull();
		const first = transition(a, b);
		expect(
			shapeProblem({ ...ok, transitions: [first, { ...first, name: "x" }] }),
		).not.toBeNull();
	});

	test("any-status transitions take part in the display order", () => {
		const definition: Definition = {
			initialStatusId: b,
			statuses: [a, b, c],
			transitions: [transition(b, c), transition(null, a)],
		};
		expect(orderStatuses(definition, names)).toEqual([b, a, c]);
	});

	test("statuses are ordered from the initial status and changes are described by name", () => {
		const definition: Definition = {
			initialStatusId: b,
			statuses: [a, b, c],
			transitions: [transition(b, c)],
		};
		expect(orderStatuses(definition, names)).toEqual([b, c, a]);

		const next: Definition = {
			...definition,
			statuses: [b, c],
			transitions: [],
			initialStatusId: c,
		};
		expect(describeChanges(definition, next, names)).toMatchObject({
			removedStatuses: ["A"],
			addedStatuses: [],
			removedTransitions: ["Go (B -> C)"],
			initialStatus: { from: "B", to: "C" },
		});
	});
});

describe("workflow administration API", () => {
	test("only administrators reach the routes", async () => {
		const response = await injectAs(
			app,
			member.session,
			"GET",
			"/api/admin/workflows",
		);
		expect(response.statusCode).toBe(403);
	});

	test("the list shows counts, drafts and the projects that use a workflow", async () => {
		const wf = await fixtureWorkflow(
			"list",
			["open", "work", "done"],
			baseTransitions,
			"open",
		);
		const project = await fixtureProject("L", wf.id);
		const second = await fixtureProject("M", null);
		await db.insert(projectWorkflows).values({
			sourceId: null,
			projectId: second.id,
			issueTypeId: typeId.task,
			workflowId: wf.id,
		});

		const list = (await adminCall("GET", "/api/admin/workflows")).json() as {
			id: string;
			name: string;
			statusCount: number;
			transitionCount: number;
			hasDraft: boolean;
			projects: { key: string; issueTypes: unknown }[];
		}[];
		const row = list.find((item) => item.id === wf.id);
		expect(row).toMatchObject({
			name: wf.name,
			statusCount: 3,
			transitionCount: 3,
			hasDraft: false,
		});
		expect(row?.projects).toEqual([
			expect.objectContaining({ key: project.key, issueTypes: "all" }),
			expect.objectContaining({
				key: second.key,
				issueTypes: [{ id: typeId.task, name: nameOf("task") }],
			}),
		]);
		const names = list.map((item) => item.name.toLowerCase());
		expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y)));
	});

	test("create, rename and delete; names are unique ignoring case", async () => {
		const created = await adminCall("POST", "/api/admin/workflows", {
			name: nameOf("created"),
			description: "Made by a test",
		});
		expect(created.statusCode).toBe(201);
		const summary = created.json();
		expect(summary).toMatchObject({
			name: nameOf("created"),
			statusCount: 0,
			transitionCount: 0,
			projects: [],
		});

		const same = await adminCall("POST", "/api/admin/workflows", {
			name: nameOf("created").toUpperCase(),
		});
		expect(same.statusCode).toBe(409);

		const other = await adminCall("POST", "/api/admin/workflows", {
			name: nameOf("other"),
		});
		expect(other.statusCode).toBe(201);
		const clash = await adminCall(
			"PATCH",
			`/api/admin/workflows/${summary.id}`,
			{
				name: nameOf("OTHER"),
			},
		);
		expect(clash.statusCode).toBe(409);

		const renamed = await adminCall(
			"PATCH",
			`/api/admin/workflows/${summary.id}`,
			{ name: nameOf("renamed"), description: "" },
		);
		expect(renamed.statusCode).toBe(200);
		expect(renamed.json()).toMatchObject({
			name: nameOf("renamed"),
			description: null,
		});

		expect(
			(await adminCall("PATCH", `/api/admin/workflows/${summary.id}`, {}))
				.statusCode,
		).toBe(400);
		expect(
			(await adminCall("DELETE", `/api/admin/workflows/${summary.id}`))
				.statusCode,
		).toBe(204);
		expect(
			(await adminCall("GET", `/api/admin/workflows/${summary.id}`)).statusCode,
		).toBe(404);
		expect(
			(await adminCall("DELETE", `/api/admin/workflows/${other.json().id}`))
				.statusCode,
		).toBe(204);
	});

	test("concurrent creates cannot take names that differ only by case", async () => {
		const suffix = randomUUID().slice(0, 6);
		const first = `${tag} Race ${suffix}`;
		const second = `${tag} race ${suffix}`;

		const original = db.transaction.bind(db);
		let entered = 0;
		let release = () => {};
		let bothEntered = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const both = new Promise<void>((resolve) => {
			bothEntered = resolve;
		});
		const restore = swapTransaction(async (callback) => {
			entered += 1;
			if (entered === 2) bothEntered();
			await gate;
			return original(callback);
		});
		try {
			const left = adminCall("POST", "/api/admin/workflows", { name: first });
			const right = adminCall("POST", "/api/admin/workflows", { name: second });
			await both;
			restore();
			release();
			const responses = await Promise.all([left, right]);
			expect(responses.map((response) => response.statusCode).sort()).toEqual([
				201, 409,
			]);
			const rows = await db
				.select({ id: workflows.id })
				.from(workflows)
				.where(like(workflows.name, `${tag} %${suffix}`));
			expect(rows).toHaveLength(1);
		} finally {
			restore();
		}
	});

	test("delete is refused with the project count while a project uses the workflow", async () => {
		const wf = await fixtureWorkflow(
			"used",
			["open", "done"],
			[{ name: "Done", from: "open", to: "done" }],
			"open",
		);
		const project = await fixtureProject("U", wf.id);

		const refused = await adminCall("DELETE", `/api/admin/workflows/${wf.id}`);
		expect(refused.statusCode).toBe(409);
		expect(refused.json()).toMatchObject({ count: 1, canMigrate: false });
		expect(refused.json().error).toContain(project.key);

		await db
			.delete(projectWorkflows)
			.where(eq(projectWorkflows.workflowId, wf.id));
		expect(
			(await adminCall("DELETE", `/api/admin/workflows/${wf.id}`)).statusCode,
		).toBe(204);
	});

	test("a copy gets its own statuses and transitions", async () => {
		const wf = await fixtureWorkflow(
			"copy-source",
			["open", "work", "done"],
			baseTransitions,
			"work",
		);
		const copy = await adminCall("POST", "/api/admin/workflows", {
			name: `Copy of ${wf.name}`,
			copyFromId: wf.id,
		});
		expect(copy.statusCode).toBe(201);
		expect(copy.json()).toMatchObject({ statusCount: 3, transitionCount: 3 });

		const copyDetail = await detailOf(copy.json().id);
		const sourceDetail = await detailOf(wf.id);
		expect(copyDetail.initialStatusId).toBe(statusId.work);
		expect(copyDetail.transitions.map((item) => item.id)).not.toContain(
			sourceDetail.transitions[0].id,
		);
		expect(copyDetail.transitions.map((item) => item.name).sort()).toEqual([
			"Finish",
			"Reopen",
			"Start",
		]);

		await adminCall("DELETE", `/api/admin/workflows/${copy.json().id}`);
		expect((await detailOf(wf.id)).transitions).toHaveLength(3);

		const missing = await adminCall("POST", "/api/admin/workflows", {
			name: nameOf("ghost"),
			copyFromId: randomUUID(),
		});
		expect(missing.statusCode).toBe(404);
	});

	test("status options list every status", async () => {
		const options = (
			await adminCall("GET", "/api/admin/workflows/status-options")
		).json() as { id: string }[];
		for (const label of ["open", "work", "done", "review", "spare"]) {
			expect(options.map((item) => item.id)).toContain(statusId[label]);
		}
	});

	test("drafts: save, load, live mode, shape errors and discard", async () => {
		const wf = await fixtureWorkflow(
			"draft",
			["open", "work", "done"],
			baseTransitions,
			"open",
		);
		const before = await detailOf(wf.id);
		expect(before).toMatchObject({
			hasDraft: false,
			mode: "live",
			initialStatusId: statusId.open,
		});
		expect(before.statuses.map((item) => item.name)[0]).toBe(nameOf("open"));

		const draft = definitionOf(
			"open",
			["open", "work", "done", "review"],
			[
				...baseTransitions.map((transition) => ({
					...transition,
					id: wf.transitionIds[transition.name],
				})),
				{ name: "Review", from: "work", to: "review", asks: true },
			],
		);
		const saved = await putDraft(wf.id, draft);
		expect(saved.statusCode).toBe(200);
		expect(saved.json()).toMatchObject({ hasDraft: true, mode: "draft" });
		expect(saved.json().statuses).toHaveLength(4);

		expect(await detailOf(wf.id)).toMatchObject({
			hasDraft: true,
			mode: "draft",
		});
		const live = await detailOf(wf.id, "?mode=live");
		expect(live).toMatchObject({ hasDraft: true, mode: "live" });
		expect(live.statuses).toHaveLength(3);
		expect(live.transitions).toHaveLength(3);

		const [{ count }] = (
			await pool.query(
				"select count(*)::int as count from workflow_statuses where workflow_id = $1",
				[wf.id],
			)
		).rows;
		expect(count).toBe(3);

		const outside = definitionOf("open", ["open"], []);
		outside.transitions.push({
			id: randomUUID(),
			name: "Nowhere",
			fromStatusId: statusId.open,
			toStatusId: statusId.done,
			asksResolution: false,
		});
		expect((await putDraft(wf.id, outside)).statusCode).toBe(400);
		const unknown = definitionOf("open", ["open"], []);
		unknown.statuses.push(randomUUID());
		expect((await putDraft(wf.id, unknown)).statusCode).toBe(400);
		const repeated = definitionOf(
			"open",
			["open", "work"],
			[{ name: "A", from: "open", to: "work" }],
		);
		repeated.transitions.push({ ...repeated.transitions[0] });
		expect((await putDraft(wf.id, repeated)).statusCode).toBe(400);
		const unnamed = definitionOf(
			"open",
			["open", "work"],
			[{ name: "  ", from: "open", to: "work" }],
		);
		expect((await putDraft(wf.id, unnamed)).statusCode).toBe(400);
		const foreign = await fixtureWorkflow(
			"foreign",
			["open", "work"],
			[{ name: "F", from: "open", to: "work" }],
			"open",
		);
		const stolen = definitionOf(
			"open",
			["open", "work"],
			[{ name: "F", from: "open", to: "work", id: foreign.transitionIds.F }],
		);
		expect((await putDraft(wf.id, stolen)).statusCode).toBe(400);
		expect(
			(await putDraft(randomUUID(), definitionOf(null, [], []))).statusCode,
		).toBe(404);

		expect(
			(await adminCall("DELETE", `/api/admin/workflows/${wf.id}/draft`))
				.statusCode,
		).toBe(204);
		expect(await detailOf(wf.id)).toMatchObject({
			hasDraft: false,
			mode: "live",
		});
		expect(
			(await adminCall("DELETE", `/api/admin/workflows/${wf.id}/draft`))
				.statusCode,
		).toBe(404);
	});

	test("an unreadable stored draft is logged instead of silently ignored", async () => {
		const wf = await fixtureWorkflow("bad-draft", ["open", "work"], [], "open");
		await db.insert(workflowDrafts).values({
			workflowId: wf.id,
			definition: { initialStatusId: null } as never,
			updatedBy: admin.id,
		});
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const detail = await detailOf(wf.id);
			expect(detail).toMatchObject({ hasDraft: false, mode: "live" });
			expect(spy).toHaveBeenCalledWith(
				expect.stringContaining(wf.id),
				expect.anything(),
			);
		} finally {
			spy.mockRestore();
			await db
				.delete(workflowDrafts)
				.where(eq(workflowDrafts.workflowId, wf.id));
		}
	});

	test("publish refuses incomplete drafts and a dry run changes nothing", async () => {
		const wf = await fixtureWorkflow(
			"validate",
			["open", "work", "done"],
			baseTransitions,
			"open",
		);
		const publish = (body: Record<string, unknown> = {}) =>
			adminCall("POST", `/api/admin/workflows/${wf.id}/publish`, body);
		const keep = baseTransitions.map((transition) => ({
			...transition,
			id: wf.transitionIds[transition.name],
		}));

		expect((await publish()).statusCode).toBe(400);

		await putDraft(wf.id, definitionOf(null, ["open", "work", "done"], keep));
		const noInitial = await publish();
		expect(noInitial.statusCode).toBe(400);
		expect(noInitial.json().problems).toEqual([
			expect.objectContaining({ code: "no_initial_status" }),
		]);

		await putDraft(
			wf.id,
			definitionOf("review", ["open", "work", "done"], keep),
		);
		expect((await publish({ dryRun: true })).json()).toMatchObject({
			ok: false,
			problems: [expect.objectContaining({ code: "no_initial_status" })],
		});

		await putDraft(
			wf.id,
			definitionOf("open", ["open", "work", "done", "spare"], keep),
		);
		const unreachable = await publish();
		expect(unreachable.statusCode).toBe(400);
		expect(unreachable.json().problems).toEqual([
			expect.objectContaining({
				code: "unreachable_status",
				statusId: statusId.spare,
				statusName: nameOf("spare"),
			}),
		]);

		await putDraft(
			wf.id,
			definitionOf(
				"open",
				["open", "work", "done", "spare"],
				[...keep, { name: "Park", from: null, to: "spare" }],
			),
		);
		expect((await publish({ dryRun: true })).json()).toEqual({
			ok: true,
			problems: [],
			movedIssues: 0,
		});

		await putDraft(
			wf.id,
			definitionOf(
				"open",
				["open", "work", "done"],
				[...keep, { name: "Start", from: "open", to: "work" }],
			),
		);
		const duplicate = await publish();
		expect(duplicate.statusCode).toBe(400);
		expect(duplicate.json().problems).toEqual([
			expect.objectContaining({ code: "duplicate_transition" }),
		]);

		await putDraft(
			wf.id,
			definitionOf(
				"open",
				["open", "work", "done", "spare"],
				[...keep, { name: "Park", from: null, to: "spare" }],
			),
		);
		await publish({ dryRun: true });
		expect(await detailOf(wf.id, "?mode=live")).toMatchObject({
			statuses: expect.arrayContaining([]),
		});
		expect((await detailOf(wf.id, "?mode=live")).statuses).toHaveLength(3);
		expect((await detailOf(wf.id)).hasDraft).toBe(true);
	});

	test("publish applies the draft, keeps unchanged transition ids and removes the draft", async () => {
		const wf = await fixtureWorkflow(
			"publish",
			["open", "work", "done"],
			baseTransitions,
			null,
		);
		const reopenId = wf.transitionIds.Reopen;
		const draft = definitionOf(
			"work",
			["open", "work", "done", "review"],
			[
				{ name: "Reopen", from: "done", to: "open", id: reopenId },
				{ name: "Start", from: "open", to: "work" },
				{ name: "Review", from: "work", to: "review", asks: true },
				{ name: "Approve", from: "review", to: "done" },
			],
		);
		await putDraft(wf.id, draft);

		const response = await adminCall(
			"POST",
			`/api/admin/workflows/${wf.id}/publish`,
			{},
		);
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ ok: true, problems: [], movedIssues: 0 });

		const live = await detailOf(wf.id);
		expect(live).toMatchObject({
			hasDraft: false,
			mode: "live",
			initialStatusId: statusId.work,
		});
		expect(live.statuses).toHaveLength(4);
		expect(live.transitions.map((item) => item.name).sort()).toEqual([
			"Approve",
			"Reopen",
			"Review",
			"Start",
		]);
		expect(live.transitions.find((item) => item.name === "Reopen")?.id).toBe(
			reopenId,
		);
		expect(
			live.transitions.find((item) => item.name === "Review"),
		).toMatchObject({
			id: draft.transitions[2].id,
			asksResolution: true,
		});
		expect(live.transitions.map((item) => item.id)).not.toContain(
			wf.transitionIds.Finish,
		);

		const [row] = await db
			.select({ initial: workflows.initialStatusId })
			.from(workflows)
			.where(eq(workflows.id, wf.id));
		expect(row.initial).toBe(statusId.work);
		const sequences = await db
			.select({
				name: workflowTransitions.name,
				sequence: workflowTransitions.sequence,
			})
			.from(workflowTransitions)
			.where(eq(workflowTransitions.workflowId, wf.id))
			.orderBy(workflowTransitions.sequence);
		expect(sequences.map((item) => item.name)).toEqual([
			"Reopen",
			"Start",
			"Review",
			"Approve",
		]);
	});

	test("publishing does not delete a draft saved while it runs", async () => {
		const wf = await fixtureWorkflow(
			"publish-race",
			["open", "work"],
			[{ name: "Go", from: "open", to: "work" }],
			"open",
		);
		const first = definitionOf(
			"open",
			["open", "work"],
			[{ name: "Go", from: "open", to: "work" }],
		);
		const second = definitionOf(
			"open",
			["open", "work"],
			[
				{ name: "Go", from: "open", to: "work" },
				{ name: "Back", from: "work", to: "open" },
			],
		);
		await putDraft(wf.id, first);

		const original = db.transaction.bind(db);
		let releaseDelete = () => {};
		let entered = () => {};
		const gate = new Promise<void>((resolve) => {
			releaseDelete = resolve;
		});
		const deleting = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const restore = swapTransaction(async (callback) => {
			return original(async (tx) => {
				const proxy = new Proxy(tx, {
					get(target, property, receiver) {
						if (property === "delete") {
							return (table: unknown) => {
								if (table === workflowDrafts) {
									entered();
									const query = target.delete(table as never) as {
										where: (...args: unknown[]) => unknown;
									};
									return {
										where: (...args: unknown[]) =>
											gate.then(() => query.where(...args)),
									};
								}
								return target.delete(table as never);
							};
						}
						const value = Reflect.get(target, property, receiver);
						return typeof value === "function" ? value.bind(target) : value;
					},
				});
				return callback(proxy as typeof tx);
			});
		});

		try {
			const publishing = adminCall(
				"POST",
				`/api/admin/workflows/${wf.id}/publish`,
				{},
			);
			await deleting;
			restore();
			const saving = putDraft(wf.id, second);
			await new Promise((resolve) => setTimeout(resolve, 200));
			releaseDelete();
			const [published, saved] = await Promise.all([publishing, saving]);
			expect(published.statusCode, published.body).toBe(200);
			expect(saved.statusCode, saved.body).toBe(200);
			const [draft] = await db
				.select({ definition: workflowDrafts.definition })
				.from(workflowDrafts)
				.where(eq(workflowDrafts.workflowId, wf.id));
			expect(draft?.definition).toMatchObject(second);
		} finally {
			restore();
			releaseDelete();
		}
	});

	test("a removed status holding issues needs a mapping; mapped issues are moved with history", async () => {
		const wf = await fixtureWorkflow(
			"remove",
			["open", "work", "done"],
			baseTransitions,
			"open",
		);
		const project = await fixtureProject("R", wf.id);
		const first = await createIssue(project.key);
		const second = await createIssue(project.key);
		const untouched = await createIssue(project.key);
		for (const issue of [first, second]) {
			expect((await runTransition(issue.key, "Start")).statusCode).toBe(200);
		}

		const counts = await detailOf(wf.id);
		expect(
			counts.statuses.find((item) => item.id === statusId.work),
		).toMatchObject({
			issueCount: 2,
		});
		expect(
			counts.statuses.find((item) => item.id === statusId.open),
		).toMatchObject({
			issueCount: 1,
		});

		const draft = definitionOf(
			"open",
			["open", "done"],
			[
				{ name: "Finish", from: "open", to: "done" },
				{
					name: "Reopen",
					from: "done",
					to: "open",
					id: wf.transitionIds.Reopen,
				},
			],
		);
		await putDraft(wf.id, draft);
		const publish = (body: Record<string, unknown>) =>
			adminCall("POST", `/api/admin/workflows/${wf.id}/publish`, body);

		const refused = await publish({});
		expect(refused.statusCode).toBe(400);
		expect(refused.json().problems).toEqual([
			expect.objectContaining({
				code: "removed_status_in_use",
				statusId: statusId.work,
				statusName: nameOf("work"),
				issueCount: 2,
			}),
		]);

		const toRemoved = await publish({
			statusMapping: { [statusId.work]: statusId.work },
		});
		expect(toRemoved.statusCode).toBe(400);
		expect(toRemoved.json().problems[0]).toMatchObject({
			code: "invalid_mapping",
		});
		const toUnknown = await publish({
			statusMapping: { [statusId.work]: statusId.spare },
		});
		expect(toUnknown.json().problems[0].code).toBe("invalid_mapping");

		const dry = await publish({
			dryRun: true,
			statusMapping: { [statusId.work]: statusId.done },
		});
		expect(dry.json()).toMatchObject({ ok: true, movedIssues: 0 });
		expect((await statusOfIssue(first.key)).id).toBe(statusId.work);

		const beforeUpdated = (await statusOfIssue(first.key)).updated;
		const done = await publish({
			statusMapping: { [statusId.work]: statusId.done },
		});
		expect(done.statusCode).toBe(200);
		expect(done.json()).toMatchObject({ ok: true, movedIssues: 2 });

		for (const issue of [first, second]) {
			const row = await statusOfIssue(issue.key);
			expect(row.id).toBe(statusId.done);
			expect(row.updated?.getTime() ?? 0).toBeGreaterThan(
				beforeUpdated?.getTime() ?? 0,
			);
			const history = await pool.query<{
				field: string;
				field_type: string;
				from_string: string;
				to_string: string;
				author_id: string;
			}>(
				`select i.field, i.field_type, i.from_string, i.to_string, h.author_id
				 from issue_history h join issue_history_items i on i.history_id = h.id
				 where h.issue_id = $1 and i.to_string = $2`,
				[row.id2, nameOf("done")],
			);
			expect(history.rows).toEqual([
				{
					field: "status",
					field_type: "jira",
					from_string: nameOf("work"),
					to_string: nameOf("done"),
					author_id: admin.id,
				},
			]);
		}
		expect((await statusOfIssue(untouched.key)).id).toBe(statusId.open);
		expect(await detailOf(wf.id)).toMatchObject({ hasDraft: false });
		expect((await detailOf(wf.id)).statuses).toHaveLength(2);
	});

	test("assignment: default and per type, the needed list, mapping and dry run", async () => {
		const main = await fixtureWorkflow(
			"assign-a",
			["open", "work", "done"],
			baseTransitions,
			"open",
		);
		const other = await fixtureWorkflow(
			"assign-b",
			["open", "review", "done"],
			[
				{ name: "Review", from: "open", to: "review" },
				{ name: "Close", from: "review", to: "done" },
			],
			"open",
		);
		const project = await fixtureProject("A", main.id, ["task", "bug"]);
		const url = `/api/admin/workflow-assignments/${project.key}`;

		const taskIssue = await createIssue(project.key, "task");
		await runTransition(taskIssue.key, "Start");
		const bugIssue = await createIssue(project.key, "bug");

		const current = (await adminCall("GET", url)).json();
		expect(current).toMatchObject({
			project: { id: project.id, key: project.key },
			defaultWorkflowId: main.id,
			perType: [],
		});
		expect(current.issueTypes.map((item: { id: string }) => item.id)).toEqual(
			expect.arrayContaining([typeId.task, typeId.bug]),
		);
		expect(current.workflows.map((item: { id: string }) => item.id)).toEqual(
			expect.arrayContaining([main.id, other.id]),
		);
		expect(
			(await adminCall("GET", "/api/admin/workflow-assignments/NOPE"))
				.statusCode,
		).toBe(404);

		const toOther = { defaultWorkflowId: other.id, perType: [] };
		const needed = await adminCall("PUT", url, toOther);
		expect(needed.statusCode).toBe(409);
		expect(needed.json().needed).toEqual([
			expect.objectContaining({
				issueTypeId: typeId.task,
				issueTypeName: nameOf("task"),
				statusId: statusId.work,
				statusName: nameOf("work"),
				issueCount: 1,
				candidates: expect.arrayContaining([
					expect.objectContaining({ id: statusId.review }),
				]),
			}),
		]);
		expect(
			needed
				.json()
				.needed[0].candidates.map((item: { id: string }) => item.id)
				.sort(),
		).toEqual([statusId.open, statusId.review, statusId.done].sort());

		const dry = await adminCall("PUT", url, { ...toOther, dryRun: true });
		expect(dry.statusCode).toBe(200);
		expect(dry.json().needed).toHaveLength(1);
		expect((await adminCall("GET", url)).json().defaultWorkflowId).toBe(
			main.id,
		);
		expect((await statusOfIssue(taskIssue.key)).id).toBe(statusId.work);

		const perType = await adminCall("PUT", url, {
			defaultWorkflowId: main.id,
			perType: [{ issueTypeId: typeId.bug, workflowId: other.id }],
		});
		expect(perType.statusCode).toBe(200);
		expect(perType.json()).toEqual({ ok: true, needed: [], moved: 0 });
		expect((await adminCall("GET", url)).json()).toMatchObject({
			defaultWorkflowId: main.id,
			perType: [{ issueTypeId: typeId.bug, workflowId: other.id }],
		});

		const badMapping = await adminCall("PUT", url, {
			...toOther,
			statusMapping: { [`${typeId.task}:${statusId.work}`]: statusId.spare },
		});
		expect(badMapping.statusCode).toBe(400);
		expect((await adminCall("GET", url)).json().defaultWorkflowId).toBe(
			main.id,
		);

		const mapped = await adminCall("PUT", url, {
			...toOther,
			statusMapping: { [`${typeId.task}:${statusId.work}`]: statusId.review },
		});
		expect(mapped.statusCode).toBe(200);
		expect(mapped.json()).toMatchObject({ ok: true, moved: 1 });
		expect((await adminCall("GET", url)).json()).toMatchObject({
			defaultWorkflowId: other.id,
			perType: [],
		});
		expect((await statusOfIssue(taskIssue.key)).id).toBe(statusId.review);
		expect((await statusOfIssue(bugIssue.key)).id).toBe(statusId.open);

		const none = await adminCall("PUT", url, {
			defaultWorkflowId: null,
			perType: [],
		});
		expect(none.statusCode).toBe(200);
		expect((await adminCall("GET", url)).json()).toMatchObject({
			defaultWorkflowId: null,
			perType: [],
		});

		expect(
			(
				await adminCall("PUT", url, {
					defaultWorkflowId: randomUUID(),
					perType: [],
				})
			).statusCode,
		).toBe(400);
		expect(
			(
				await adminCall("PUT", url, {
					defaultWorkflowId: null,
					perType: [
						{ issueTypeId: typeId.bug, workflowId: main.id },
						{ issueTypeId: typeId.bug, workflowId: other.id },
					],
				})
			).statusCode,
		).toBe(400);
	});

	test("assignment reads issues inside the transaction, so a concurrent create is moved too", async () => {
		const old = await fixtureWorkflow(
			"race-old",
			["open", "work", "done"],
			baseTransitions,
			"open",
		);
		const next = await fixtureWorkflow(
			"race-new",
			["open", "review", "spare"],
			[
				{ name: "Review", from: "open", to: "review" },
				{ name: "Spare", from: "review", to: "spare" },
			],
			"open",
		);
		const project = await fixtureProject("Q", old.id, ["task"]);
		await createIssue(project.key, "task");

		const original = db.transaction.bind(db);
		let racedId = "";
		const restore = swapTransaction(async (callback) => {
			if (!racedId) {
				const [raced] = await db
					.insert(issues)
					.values({
						sourceId: `local:${randomUUID()}`,
						projectId: project.id,
						number: 9999,
						key: `${project.key}-RACE`,
						typeId: typeId.task,
						statusId: statusId.done,
						summary: `${tag} raced issue`,
					})
					.returning({ id: issues.id });
				racedId = raced.id;
			}
			return original(callback);
		});
		try {
			const response = await adminCall(
				"PUT",
				`/api/admin/workflow-assignments/${project.key}`,
				{
					defaultWorkflowId: next.id,
					perType: [],
					statusMapping: {
						[`${typeId.task}:${statusId.done}`]: statusId.review,
					},
				},
			);
			expect(response.statusCode, response.body).toBe(200);
		} finally {
			restore();
		}

		const rows = await db
			.select({ id: issues.id, statusId: issues.statusId })
			.from(issues)
			.where(eq(issues.projectId, project.id));
		expect(rows).toHaveLength(2);
		expect(rows.every((row) => row.statusId !== statusId.done)).toBe(true);
		expect(rows.find((row) => row.id === racedId)?.statusId).toBe(
			statusId.review,
		);
	});

	test("an issue created after an assignment starts in the configured initial status", async () => {
		const configured = await fixtureWorkflow(
			"initial",
			["open", "review", "done"],
			[
				{ name: "Back", from: "review", to: "open" },
				{ name: "Finish", from: "review", to: "done" },
			],
			"review",
		);
		const heuristic = await fixtureWorkflow(
			"heuristic",
			["open", "review", "done"],
			[
				{ name: "Review", from: "open", to: "review" },
				{ name: "Finish", from: "review", to: "done" },
			],
			null,
		);
		expect((await initialStatusFor(configured.id))?.id).toBe(statusId.review);
		expect((await initialStatusFor(heuristic.id))?.id).not.toBe(
			statusId.review,
		);

		const project = await fixtureProject("I", null);
		const assign = await adminCall(
			"PUT",
			`/api/admin/workflow-assignments/${project.key}`,
			{ defaultWorkflowId: configured.id, perType: [] },
		);
		expect(assign.statusCode).toBe(200);

		const issue = await createIssue(project.key);
		expect(issue.status.id).toBe(statusId.review);
	});

	test("transitions that ask for a resolution require one, ordinary ones do not", async () => {
		const wf = await fixtureWorkflow(
			"resolution",
			["open", "work", "done"],
			[
				{ name: "Start", from: "open", to: "work" },
				{ name: "Resolve", from: "work", to: "done", asks: true },
				{ name: "Wontfix", from: "open", to: "work", asks: true },
			],
			"open",
		);
		const project = await fixtureProject("S", wf.id);

		const flags = await transitionsFrom(wf.id, statusId.open);
		expect(
			Object.fromEntries(flags.map((item) => [item.name, item.asksResolution])),
		).toEqual({ Start: false, Wontfix: true });

		const issue = await createIssue(project.key);
		const detail = (await adminCall("GET", `/api/issues/${issue.key}`)).json();
		expect(
			detail.transitions.map(
				(item: { name: string; asksResolution: boolean }) => [
					item.name,
					item.asksResolution,
				],
			),
		).toEqual(
			expect.arrayContaining([
				["Start", false],
				["Wontfix", true],
			]),
		);

		const ordinary = await runTransition(issue.key, "Start");
		expect(ordinary.statusCode).toBe(200);

		const missing = await runTransition(issue.key, "Resolve");
		expect(missing.statusCode).toBe(400);
		expect(missing.json()).toEqual({
			error: "A resolution is required for this transition",
		});
		expect((await statusOfIssue(issue.key)).id).toBe(statusId.work);

		const resolved = await runTransition(issue.key, "Resolve", {
			resolutionId: resolutionId.fixed,
		});
		expect(resolved.statusCode).toBe(200);
		expect(resolved.json().resolution).toMatchObject({
			id: resolutionId.fixed,
		});

		const second = await createIssue(project.key);
		const nonDone = await runTransition(second.key, "Wontfix", {
			resolutionId: resolutionId.wontfix,
		});
		expect(nonDone.statusCode).toBe(200);
		expect(nonDone.json().resolution).toMatchObject({
			id: resolutionId.wontfix,
		});

		const list = await injectAs(app, member.session, "GET", "/api/resolutions");
		expect(list.statusCode).toBe(200);
		expect(list.json().map((item: { id: string }) => item.id)).toEqual(
			expect.arrayContaining([resolutionId.fixed, resolutionId.wontfix]),
		);
	});

	test("every change is audited with the administrator as actor", async () => {
		const wf = await fixtureWorkflow(
			"audited",
			["open", "work", "done"],
			baseTransitions,
			"open",
		);
		const copy = await adminCall("POST", "/api/admin/workflows", {
			name: nameOf("audited copy"),
			copyFromId: wf.id,
		});
		const fresh = await adminCall("POST", "/api/admin/workflows", {
			name: nameOf("audited fresh"),
		});
		await adminCall("PATCH", `/api/admin/workflows/${fresh.json().id}`, {
			name: nameOf("audited renamed"),
		});
		await putDraft(
			wf.id,
			definitionOf(
				"open",
				["open", "work", "done", "review"],
				[
					...baseTransitions.map((transition) => ({
						...transition,
						id: wf.transitionIds[transition.name],
					})),
					{ name: "Review", from: "work", to: "review" },
					{ name: "Back", from: "review", to: "open" },
				],
			),
		);
		await adminCall("DELETE", `/api/admin/workflows/${wf.id}/draft`);
		await putDraft(
			wf.id,
			definitionOf(
				"open",
				["open", "work", "done", "review"],
				[
					...baseTransitions.map((transition) => ({
						...transition,
						id: wf.transitionIds[transition.name],
					})),
					{ name: "Review", from: "work", to: "review" },
					{ name: "Back", from: "review", to: "open" },
				],
			),
		);
		await adminCall("POST", `/api/admin/workflows/${wf.id}/publish`, {});
		const project = await fixtureProject("Z", null);
		await adminCall("PUT", `/api/admin/workflow-assignments/${project.key}`, {
			defaultWorkflowId: wf.id,
			perType: [],
		});
		await adminCall("DELETE", `/api/admin/workflows/${copy.json().id}`);

		const rows = await pool.query<{
			action: string;
			actor_id: string;
			entity_id: string;
			summary: string;
			changes: { from?: unknown; to?: Record<string, unknown> } | null;
		}>(
			"select action, actor_id, entity_id, summary, changes from audit_log where actor_id = $1 order by created_at",
			[admin.id],
		);
		const actions = rows.rows.map((row) => row.action);
		for (const expected of [
			"workflow.create",
			"workflow.copy",
			"workflow.update",
			"workflow.draft.discard",
			"workflow.publish",
			"workflow.assign",
			"workflow.delete",
		]) {
			expect(actions, expected).toContain(expected);
		}
		expect(actions).not.toContain("workflow.draft.save");

		const publish = rows.rows.find(
			(row) => row.action === "workflow.publish" && row.entity_id === wf.id,
		);
		expect(publish).toBeDefined();
		expect(publish?.changes?.to).toMatchObject({
			statuses: [nameOf("review")],
			transitions: [
				`Review (${nameOf("work")} -> ${nameOf("review")})`,
				`Back (${nameOf("review")} -> ${nameOf("open")})`,
			],
		});
		const assign = rows.rows.find(
			(row) => row.action === "workflow.assign" && row.entity_id === project.id,
		);
		expect(assign?.changes).toMatchObject({
			from: { default: null },
			to: { default: wf.name },
		});
		expect(
			await db
				.select({ id: workflows.id })
				.from(workflows)
				.where(and(eq(workflows.name, nameOf("audited copy")))),
		).toEqual([]);
	});
});
