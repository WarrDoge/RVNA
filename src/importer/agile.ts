import { sql } from "drizzle-orm";
import type { db } from "../lib/server/db.ts";
import {
	boardColumnStatuses,
	boardColumns,
	boardQuickFilters,
	boards,
	fields,
	issueSprints,
	sprints,
} from "../lib/server/schema.ts";
import {
	customFieldId,
	resolveCustomFieldRoles,
} from "../lib/shared/custom-field-roles.ts";

type Database = typeof db;

export type SprintState = "future" | "active" | "closed";

export type ParsedSprint = {
	sourceId: string;
	rapidViewId: number;
	name: string;
	goal: string | null;
	state: SprintState;
	startDate: Date | null;
	endDate: Date | null;
	completeDate: Date | null;
	sequence: number;
};

export type AgileImportCounts = {
	boards: number;
	sprints: Record<SprintState, number>;
	issueSprints: number;
	issues: number;
};

const STATE_BY_JIRA: Record<string, SprintState> = {
	FUTURE: "future",
	ACTIVE: "active",
	CLOSED: "closed",
};

function fieldValue(descriptor: string, name: string): string | null {
	const pattern = new RegExp(
		`(?:^|[\\[,])${name}=(.*?)(?=,[A-Za-z][A-Za-z0-9]*=|\\]$)`,
	);
	const value = pattern.exec(descriptor)?.[1];
	if (value === undefined || value === "<null>" || value === "") return null;
	return value;
}

function parseDate(value: string | null): Date | null {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

/** Parses the Java toString of a GreenHopper sprint kept in the Sprint field. */
export function parseSprintDescriptor(descriptor: string): ParsedSprint | null {
	const id = fieldValue(descriptor, "id");
	const rapidViewId = fieldValue(descriptor, "rapidViewId");
	const name = fieldValue(descriptor, "name");
	const jiraState = fieldValue(descriptor, "state");
	if (!id || !rapidViewId || !name || !jiraState) return null;

	const state = STATE_BY_JIRA[jiraState.toUpperCase()];
	if (!state) return null;
	const boardId = Number(rapidViewId);
	if (!Number.isFinite(boardId)) return null;

	const sequence = Number(fieldValue(descriptor, "sequence") ?? 0);
	return {
		sourceId: id,
		rapidViewId: boardId,
		name,
		goal: fieldValue(descriptor, "goal"),
		state,
		startDate: parseDate(fieldValue(descriptor, "startDate")),
		endDate: parseDate(fieldValue(descriptor, "endDate")),
		completeDate: parseDate(fieldValue(descriptor, "completeDate")),
		sequence: Number.isFinite(sequence) ? sequence : 0,
	};
}

async function sprintFieldSourceId(database: Database): Promise<string | null> {
	const rows = await database
		.select({
			sourceId: fields.sourceId,
			name: fields.name,
			type: fields.type,
			customKey: fields.customKey,
		})
		.from(fields);
	return customFieldId(resolveCustomFieldRoles(rows), "sprint");
}

const CATEGORY_COLUMNS = [
	{ category: "new", name: "To Do" },
	{ category: "indeterminate", name: "In Progress" },
	{ category: "done", name: "Done" },
] as const;

const DEFAULT_QUICK_FILTERS = [
	{ name: "Only My Issues", jql: "assignee = currentUser()" },
	{ name: "Recently Updated", jql: "updated >= -1d" },
];

type StatusRow = { id: string; name: string; category: string };

async function projectStatuses(
	database: Database,
	projectIds: string[],
): Promise<StatusRow[]> {
	if (projectIds.length === 0) return [];
	const workflowStatuses = await database.execute(sql`
		select distinct s.id, s.name, s.category
		from project_workflows pw
		join workflow_statuses ws on ws.workflow_id = pw.workflow_id
		join statuses s on s.id = ws.status_id
		where pw.project_id in (${sql.join(
			projectIds.map((id) => sql`${id}`),
			sql`, `,
		)})
		order by s.name
	`);
	const rows = workflowStatuses.rows as StatusRow[];
	if (rows.length > 0) return rows;

	const usedStatuses = await database.execute(sql`
		select distinct s.id, s.name, s.category
		from issues i
		join statuses s on s.id = i.status_id
		where i.project_id in (${sql.join(
			projectIds.map((id) => sql`${id}`),
			sql`, `,
		)})
		order by s.name
	`);
	return usedStatuses.rows as StatusRow[];
}

type BoardPlan = {
	rapidViewId: number;
	name: string;
	projectId: string | null;
	projectKeys: string[];
	filterJql: string;
	statuses: StatusRow[];
	sprints: ParsedSprint[];
	issueIds: Set<string>;
};

async function planBoards(
	database: Database,
	descriptors: Map<string, ParsedSprint>,
	sprintSourceId: string,
): Promise<Map<string, BoardPlan>> {
	const result = await database.execute(sql`
		select i.id as issue_id, i.project_id, p.key as project_key, p.name as project_name
		from issues i
		join projects p on p.id = i.project_id
		where i.custom ? ${sprintSourceId}
	`);
	const issueRows = result.rows as {
		issue_id: string;
		project_id: string;
		project_key: string;
		project_name: string;
	}[];
	const issueProjects = new Map(
		issueRows.map((row) => [
			row.issue_id,
			{
				id: row.project_id,
				key: row.project_key,
				name: row.project_name,
			},
		]),
	);

	const sprintIssues = await database.execute(sql`
		select i.id as issue_id, value as descriptor
		from issues i
		cross join lateral jsonb_array_elements_text(
			coalesce(i.custom->${sprintSourceId}, '[]'::jsonb)
		) value
	`);

	const plans = new Map<string, BoardPlan>();
	for (const row of sprintIssues.rows as {
		issue_id: string;
		descriptor: string;
	}[]) {
		const sprint = parseSprintDescriptor(row.descriptor);
		if (!sprint) continue;
		descriptors.set(sprint.sourceId, sprint);
		const project = issueProjects.get(row.issue_id);
		if (!project) continue;

		const key = String(sprint.rapidViewId);
		let plan = plans.get(key);
		if (!plan) {
			plan = {
				rapidViewId: sprint.rapidViewId,
				name: "",
				projectId: project.id,
				projectKeys: [],
				filterJql: "",
				statuses: [],
				sprints: [],
				issueIds: new Set(),
			};
			plans.set(key, plan);
		}
		if (!plan.sprints.some((item) => item.sourceId === sprint.sourceId)) {
			plan.sprints.push(sprint);
		}
		if (!plan.projectKeys.includes(project.key)) {
			plan.projectKeys.push(project.key);
		}
		plan.issueIds.add(row.issue_id);
	}

	for (const plan of plans.values()) {
		const projectCounts = new Map<
			string,
			{ id: string; name: string; count: number }
		>();
		for (const issueId of plan.issueIds) {
			const project = issueProjects.get(issueId);
			if (!project) continue;
			const entry = projectCounts.get(project.id) ?? {
				id: project.id,
				name: project.name,
				count: 0,
			};
			entry.count += 1;
			projectCounts.set(project.id, entry);
		}
		const dominant = [...projectCounts.values()].sort(
			(left, right) => right.count - left.count,
		)[0];
		plan.projectId = dominant?.id ?? null;
		plan.name = `${dominant?.name ?? "Board"} sprint board`;
		plan.projectKeys.sort();
		const quotedKeys = plan.projectKeys.map((key) => `"${key}"`);
		plan.filterJql =
			quotedKeys.length === 1
				? `project = ${quotedKeys[0]}`
				: `project in (${quotedKeys.join(", ")})`;
		plan.sprints.sort(
			(left, right) =>
				left.sequence - right.sequence || left.name.localeCompare(right.name),
		);

		const projectIds = [...projectCounts.keys()];
		plan.statuses = await projectStatuses(database, projectIds);
	}

	return plans;
}

export async function importAgileLocal(
	database: Database,
): Promise<AgileImportCounts> {
	const descriptors = new Map<string, ParsedSprint>();
	const sprintSourceId = await sprintFieldSourceId(database);
	const plans = sprintSourceId
		? await planBoards(database, descriptors, sprintSourceId)
		: new Map<string, BoardPlan>();
	const counts: AgileImportCounts = {
		boards: plans.size,
		sprints: { future: 0, active: 0, closed: 0 },
		issueSprints: 0,
		issues: 0,
	};

	const sprintIds = new Map<string, string>();
	const issueMemberships: {
		issueId: string;
		sprintId: string;
		isOpen: boolean;
	}[] = [];
	const importedIssueIds = new Set<string>();

	for (const plan of plans.values()) {
		const [existing] = await database
			.select()
			.from(boards)
			.where(eqSource(plan.rapidViewId))
			.limit(1);

		let boardId: string;
		let ownsConfig = true;
		if (existing) {
			boardId = existing.id;
			ownsConfig = !existing.configImported;
			if (ownsConfig) {
				await database
					.update(boards)
					.set({
						sourceId: String(plan.rapidViewId),
						name: plan.name,
						type: "scrum",
						filterJql: plan.filterJql,
						projectId: plan.projectId,
						configImported: false,
						updatedAt: new Date(),
					})
					.where(sql`${boards.id} = ${existing.id}`);
			}
		} else {
			const [created] = await database
				.insert(boards)
				.values({
					rapidViewId: plan.rapidViewId,
					sourceId: String(plan.rapidViewId),
					name: plan.name,
					type: "scrum",
					filterJql: plan.filterJql,
					projectId: plan.projectId,
					configImported: false,
				})
				.returning({ id: boards.id });
			boardId = created.id;
		}

		if (ownsConfig) {
			await database
				.delete(boardColumns)
				.where(sql`${boardColumns.boardId} = ${boardId}`);
			let sequence = 0;
			for (const column of CATEGORY_COLUMNS) {
				const [createdColumn] = await database
					.insert(boardColumns)
					.values({
						boardId,
						name: column.name,
						sequence,
					})
					.returning({ id: boardColumns.id });
				sequence += 1;
				const statuses = plan.statuses.filter(
					(status) => status.category === column.category,
				);
				if (statuses.length > 0) {
					await database.insert(boardColumnStatuses).values(
						statuses.map((status, index) => ({
							columnId: createdColumn.id,
							statusId: status.id,
							sequence: index,
						})),
					);
				}
			}

			const existingFilters = await database
				.select({ id: boardQuickFilters.id })
				.from(boardQuickFilters)
				.where(sql`${boardQuickFilters.boardId} = ${boardId}`)
				.limit(1);
			if (existingFilters.length === 0) {
				await database.insert(boardQuickFilters).values(
					DEFAULT_QUICK_FILTERS.map((filter, sequence) => ({
						boardId,
						name: filter.name,
						jql: filter.jql,
						sequence,
					})),
				);
			}
		}

		for (const sprint of plan.sprints) {
			const [existingSprint] = await database
				.select({ id: sprints.id })
				.from(sprints)
				.where(sql`${sprints.sourceId} = ${sprint.sourceId}`)
				.limit(1);
			if (existingSprint) {
				await database
					.update(sprints)
					.set({
						boardId,
						name: sprint.name,
						goal: sprint.goal,
						state: sprint.state,
						startDate: sprint.startDate,
						endDate: sprint.endDate,
						completeDate: sprint.completeDate,
						sequence: sprint.sequence,
						updatedAt: new Date(),
					})
					.where(sql`${sprints.id} = ${existingSprint.id}`);
				sprintIds.set(sprint.sourceId, existingSprint.id);
			} else {
				const [created] = await database
					.insert(sprints)
					.values({
						sourceId: sprint.sourceId,
						boardId,
						name: sprint.name,
						goal: sprint.goal,
						state: sprint.state,
						startDate: sprint.startDate,
						endDate: sprint.endDate,
						completeDate: sprint.completeDate,
						sequence: sprint.sequence,
					})
					.returning({ id: sprints.id });
				sprintIds.set(sprint.sourceId, created.id);
			}
			counts.sprints[sprint.state] += 1;
		}

		for (const issueId of plan.issueIds) importedIssueIds.add(issueId);
	}

	const memberships = sprintSourceId
		? await database.execute(sql`
				select i.id as issue_id, value as descriptor
				from issues i
				cross join lateral jsonb_array_elements_text(
					coalesce(i.custom->${sprintSourceId}, '[]'::jsonb)
				) value
			`)
		: { rows: [] };
	for (const row of memberships.rows as {
		issue_id: string;
		descriptor: string;
	}[]) {
		const sprint = parseSprintDescriptor(row.descriptor);
		const sprintId = sprint ? sprintIds.get(sprint.sourceId) : undefined;
		if (!sprint || !sprintId) continue;
		issueMemberships.push({
			issueId: row.issue_id,
			sprintId,
			isOpen: sprint.state !== "closed",
		});
	}

	const issueIds = [...importedIssueIds];
	if (issueIds.length > 0) {
		await database.execute(sql`
			delete from issue_sprints
			where issue_id in (${sql.join(
				issueIds.map((id) => sql`${id}`),
				sql`, `,
			)})
			and sprint_id in (select id from sprints where source_id is not null)
		`);
	}

	const uniqueMemberships = new Map(
		issueMemberships.map((membership) => [
			`${membership.issueId}:${membership.sprintId}`,
			membership,
		]),
	);
	if (uniqueMemberships.size > 0) {
		await database
			.insert(issueSprints)
			.values([...uniqueMemberships.values()])
			.onConflictDoNothing();
	}

	counts.issueSprints = uniqueMemberships.size;
	counts.issues = importedIssueIds.size;
	return counts;
}

function eqSource(rapidViewId: number) {
	return sql`${boards.rapidViewId} = ${rapidViewId}`;
}
