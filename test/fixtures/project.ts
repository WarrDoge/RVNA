import { randomUUID } from "node:crypto";
import type { Client } from "pg";

/**
 * Every test seeds the rows it needs: CI runs against an empty database with
 * only the migrations applied. Ids are prefixed with the run so cleanup can
 * delete exactly what the test created.
 */
export interface SeedIssue {
	summary: string;
	status?: "todo" | "inProgress" | "done";
	type?: "task" | "bug";
	priority?: "high" | "low" | null;
	labels?: string[];
	assigneeId?: string | null;
	reporterId?: string | null;
	description?: string;
	created?: string;
	updated?: string;
	storyPoints?: number | null;
	dueDate?: string | null;
}

export interface SeedOptions {
	run: string;
	key: string;
	name?: string;
	issues: SeedIssue[];
	leadId?: string | null;
	/** Usernames that get the project role "member", so they may work in the project. */
	members?: string[];
	/** Usernames that get the project role "admin": all permissions, including SERVICEDESK_AGENT. */
	admins?: string[];
}

export interface SeedResult {
	projectId: string;
	projectKey: string;
	projectName: string;
	issueIds: string[];
	issueKeys: string[];
	statusIds: { todo: string; inProgress: string; done: string };
	typeIds: { task: string; bug: string };
	priorityIds: { high: string; low: string };
	resolutionId: string;
	workflowId: string;
}

async function one<T extends Record<string, unknown>>(
	client: Client,
	sql: string,
	values: unknown[],
): Promise<T> {
	const result = await client.query<T>(sql, values);
	const row = result.rows[0];
	if (!row) throw new Error(`Seed query returned no row: ${sql}`);
	return row;
}

export async function createProjectFixture(
	client: Client,
	options: SeedOptions,
): Promise<SeedResult> {
	const run = options.run;
	const projectKey = options.key.toUpperCase();
	const projectName = options.name ?? `Fixture ${projectKey}`;
	const prefix = `fixture:${run}`;

	const statuses: Record<"todo" | "inProgress" | "done", string> = {
		todo: "",
		inProgress: "",
		done: "",
	};
	const statusNames = {
		todo: "To Do",
		inProgress: "In Progress",
		done: "Done",
	} as const;
	const categories = {
		todo: "new",
		inProgress: "indeterminate",
		done: "done",
	} as const;
	for (const key of ["todo", "inProgress", "done"] as const) {
		const row = await one<{ id: string }>(
			client,
			`insert into statuses (source_id, name, category)
			 values ($1, $2, $3) returning id`,
			[`${prefix}:status:${key}`, statusNames[key], categories[key]],
		);
		statuses[key] = row.id;
	}

	const types: Record<"task" | "bug", string> = { task: "", bug: "" };
	for (const key of ["task", "bug"] as const) {
		const row = await one<{ id: string }>(
			client,
			`insert into issue_types (source_id, name, subtask)
			 values ($1, $2, false) returning id`,
			[`${prefix}:type:${key}`, key === "task" ? "Task" : "Bug"],
		);
		types[key] = row.id;
	}

	const priorities: Record<"high" | "low", string> = { high: "", low: "" };
	const priorityRows = [
		{ key: "high" as const, name: "High", sequence: 1 },
		{ key: "low" as const, name: "Low", sequence: 4 },
	];
	for (const priority of priorityRows) {
		const row = await one<{ id: string }>(
			client,
			`insert into priorities (source_id, name, sequence, icon_color)
			 values ($1, $2, $3, $4) returning id`,
			[
				`${prefix}:priority:${priority.key}`,
				priority.name,
				priority.sequence,
				"#ff5630",
			],
		);
		priorities[priority.key] = row.id;
	}

	const resolution = await one<{ id: string }>(
		client,
		`insert into resolutions (source_id, name) values ($1, $2) returning id`,
		[`${prefix}:resolution:done`, "Done"],
	);

	const workflow = await one<{ id: string }>(
		client,
		`insert into workflows (source_id, name) values ($1, $2) returning id`,
		[`${prefix}:workflow`, `Fixture workflow ${run}`],
	);
	for (const key of ["todo", "inProgress", "done"] as const) {
		await client.query(
			`insert into workflow_statuses (source_id, workflow_id, status_id)
			 values ($1, $2, $3)`,
			[`${prefix}:workflow-status:${key}`, workflow.id, statuses[key]],
		);
	}
	const transitions = [
		{
			id: "start",
			from: statuses.todo,
			to: statuses.inProgress,
			name: "Start",
		},
		{
			id: "finish",
			from: statuses.inProgress,
			to: statuses.done,
			name: "Done",
		},
		{ id: "close", from: statuses.todo, to: statuses.done, name: "Close" },
	];
	for (const transition of transitions) {
		await client.query(
			`insert into workflow_transitions (source_id, workflow_id, name, from_status_id, to_status_id, sequence)
			 values ($1, $2, $3, $4, $5, 0)`,
			[
				`${prefix}:transition:${transition.id}`,
				workflow.id,
				transition.name,
				transition.from,
				transition.to,
			],
		);
	}

	const project = await one<{ id: string }>(
		client,
		`insert into projects (source_id, key, name, project_type, lead_id, last_issue_number)
		 values ($1, $2, $3, 'software', $4, 0) returning id`,
		[`${prefix}:project`, projectKey, projectName, options.leadId ?? null],
	);
	for (const [role, usernames] of [
		["member", options.members ?? []],
		["admin", options.admins ?? []],
	] as const) {
		for (const username of usernames) {
			await client.query(
				`insert into project_role_actors
				 (source_id, project_id, role_id, role_name, actor_type, actor_parameter, actor_display_name, raw)
				 values ($1, $2, $3, $3, 'user', $4, $4, '{}'::jsonb)`,
				[`${prefix}:${role}:${username}`, project.id, role, username],
			);
		}
	}
	for (const key of ["task", "bug"] as const) {
		await client.query(
			`insert into project_issue_types (source_id, project_id, issue_type_id)
			 values ($1, $2, $3)`,
			[`${prefix}:project-type:${key}`, project.id, types[key]],
		);
	}
	await client.query(
		`insert into project_workflows (source_id, project_id, issue_type_id, workflow_id)
		 values ($1, $2, null, $3)`,
		[`${prefix}:project-workflow`, project.id, workflow.id],
	);

	const issueIds: string[] = [];
	const issueKeys: string[] = [];
	for (const [index, issue] of options.issues.entries()) {
		const number = index + 1;
		const key = `${projectKey}-${number}`;
		const row = await one<{ id: string }>(
			client,
			`insert into issues (
				source_id, project_id, number, key, type_id, status_id, priority_id,
				resolution_id, summary, description_source, reporter_id, assignee_id,
				creator_id, story_points, due_date, created, updated, resolved
			 ) values (
				$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $11, $13, $14, $15, $16, $17
			 ) returning id`,
			[
				`${prefix}:issue:${number}`,
				project.id,
				number,
				key,
				types[issue.type ?? "task"],
				statuses[issue.status ?? "todo"],
				issue.priority === null ? null : priorities[issue.priority ?? "high"],
				issue.status === "done" ? resolution.id : null,
				issue.summary,
				issue.description ?? null,
				issue.reporterId ?? null,
				issue.assigneeId ?? null,
				issue.storyPoints ?? null,
				issue.dueDate ?? null,
				issue.created ?? "2026-01-01T10:00:00Z",
				issue.updated ?? "2026-01-02T10:00:00Z",
				issue.status === "done" ? "2026-01-03T10:00:00Z" : null,
			],
		);
		issueIds.push(row.id);
		issueKeys.push(key);

		for (const label of issue.labels ?? []) {
			await client.query(
				`insert into issue_labels (source_id, issue_id, label) values ($1, $2, $3)`,
				[`${prefix}:label:${number}:${label}`, row.id, label],
			);
		}
	}

	await client.query(
		"update projects set last_issue_number = $1 where id = $2",
		[options.issues.length, project.id],
	);

	return {
		projectId: project.id,
		projectKey,
		projectName,
		issueIds,
		issueKeys,
		statusIds: statuses,
		typeIds: types,
		priorityIds: priorities,
		resolutionId: resolution.id,
		workflowId: workflow.id,
	};
}

export async function dropProjectFixture(client: Client, run: string) {
	const prefix = `fixture:${run}`;
	const project = await client.query<{ id: string }>(
		"select id from projects where source_id like $1",
		[`${prefix}:%project`],
	);
	for (const { id } of project.rows) {
		// Issues created through the UI carry no fixture source_id: delete by
		// project; comments, history, labels and the like cascade.
		await client.query("delete from issues where project_id = $1", [id]);
		await client.query("delete from projects where id = $1", [id]);
	}
	// A transition in another spec may have picked a fixture resolution or
	// priority by name; both references are nullable, so detach them.
	for (const [table, column] of [
		["resolutions", "resolution_id"],
		["priorities", "priority_id"],
	] as const) {
		await client.query(
			`update issues set ${column} = null
			 where ${column} in (select id from ${table} where source_id like $1)`,
			[`${prefix}:%`],
		);
	}
	await client.query(`delete from workflows where source_id = $1`, [
		`${prefix}:workflow`,
	]);
	// Another test may have reused one of these rows by name for its own
	// issues, so only the rows nothing points at are removed.
	const columns = {
		statuses: "status_id",
		issue_types: "type_id",
		priorities: "priority_id",
		resolutions: "resolution_id",
	} as const;
	for (const [table, column] of Object.entries(columns)) {
		await client.query(
			`delete from ${table} t where t.source_id like $1
			 and not exists (select 1 from issues i where i.${column} = t.id)`,
			[`${prefix}:%`],
		);
	}
}

export function fixtureRun() {
	return randomUUID().slice(0, 8);
}

export function fixtureKey(run: string) {
	return `FX${run.slice(0, 5).toUpperCase()}`;
}
