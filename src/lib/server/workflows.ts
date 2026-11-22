import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import { db } from "./db.ts";
import {
	issueHistory,
	issueHistoryItems,
	issues,
	projectWorkflows,
	resolutions,
	statuses,
	workflowStatuses,
	workflows,
	workflowTransitions,
} from "./schema.ts";

export type StatusRef = {
	id: string;
	name: string;
	category: "new" | "indeterminate" | "done";
};

export type WorkflowRef = {
	id: string;
	name: string;
};

export async function workflowForIssueType(
	projectId: string,
	issueTypeId: string,
): Promise<WorkflowRef | null> {
	const rows = await db
		.select({
			id: workflows.id,
			name: workflows.name,
			issueTypeId: projectWorkflows.issueTypeId,
		})
		.from(projectWorkflows)
		.innerJoin(workflows, eq(workflows.id, projectWorkflows.workflowId))
		.where(eq(projectWorkflows.projectId, projectId));

	return (
		rows.find((row) => row.issueTypeId === issueTypeId) ??
		rows.find((row) => row.issueTypeId === null) ??
		null
	);
}

export async function statusesForWorkflow(
	workflowId: string,
	executor: Pick<typeof db, "select"> = db,
): Promise<StatusRef[]> {
	return executor
		.select({
			id: statuses.id,
			name: statuses.name,
			category: statuses.category,
		})
		.from(workflowStatuses)
		.innerJoin(statuses, eq(statuses.id, workflowStatuses.statusId))
		.where(eq(workflowStatuses.workflowId, workflowId))
		.orderBy(statuses.name);
}

const initialStatusNames = [
	"To Do",
	"Open",
	"Backlog",
	"Selected for Development",
	"Peer review / change manager approval",
	"Planning",
	"Pending",
];

function chooseInitial(list: StatusRef[]): StatusRef | null {
	for (const name of initialStatusNames) {
		const match = list.find((status) => status.name === name);
		if (match) return match;
	}
	return list.find((status) => status.category === "new") ?? list[0] ?? null;
}

export async function initialStatusFor(
	workflowId: string,
	executor: Pick<typeof db, "select"> = db,
): Promise<StatusRef | null> {
	const list = await statusesForWorkflow(workflowId, executor);
	const [workflow] = await executor
		.select({ initialStatusId: workflows.initialStatusId })
		.from(workflows)
		.where(eq(workflows.id, workflowId))
		.limit(1);
	const configured = list.find(
		(status) => status.id === workflow?.initialStatusId,
	);
	if (configured) return configured;

	const transitions = await executor
		.select({
			fromStatusId: workflowTransitions.fromStatusId,
			toStatusId: workflowTransitions.toStatusId,
		})
		.from(workflowTransitions)
		.where(eq(workflowTransitions.workflowId, workflowId));

	const targets = new Set(
		transitions
			.filter((transition) => transition.fromStatusId !== null)
			.map((transition) => transition.toStatusId),
	);
	const entry = list.filter((status) => !targets.has(status.id));
	return chooseInitial(entry.length > 0 ? entry : list);
}

export async function transitionsFrom(
	workflowId: string,
	statusId: string,
): Promise<
	{ id: string; name: string; asksResolution: boolean; to: StatusRef }[]
> {
	const rows = await db
		.select({
			id: workflowTransitions.id,
			name: workflowTransitions.name,
			asksResolution: workflowTransitions.asksResolution,
			toId: statuses.id,
			toName: statuses.name,
			toCategory: statuses.category,
		})
		.from(workflowTransitions)
		.innerJoin(statuses, eq(statuses.id, workflowTransitions.toStatusId))
		.where(
			and(
				eq(workflowTransitions.workflowId, workflowId),
				or(
					eq(workflowTransitions.fromStatusId, statusId),
					isNull(workflowTransitions.fromStatusId),
				),
			),
		)
		.orderBy(workflowTransitions.sequence, workflowTransitions.name);

	return rows
		.filter((row) => row.toId !== statusId)
		.map((row) => ({
			id: row.id,
			name: row.name,
			asksResolution: row.asksResolution,
			to: { id: row.toId, name: row.toName, category: row.toCategory },
		}));
}

/** SQL condition: the workflow that governs the issue (per issue type, else the project default) is `workflowId`. */
export function governedBy(workflowId: string): SQL {
	return sql`coalesce(
		(select pw.workflow_id from project_workflows pw where pw.project_id = ${issues.projectId} and pw.issue_type_id = ${issues.typeId}),
		(select pw.workflow_id from project_workflows pw where pw.project_id = ${issues.projectId} and pw.issue_type_id is null)
	) = ${workflowId}`;
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Moves issues to another status the way a manual status change does: one history entry per issue,
 * `updated` bumped, and the resolution cleared when an issue leaves a done status.
 */
export async function moveIssues(
	tx: Transaction,
	authorId: string,
	condition: SQL | undefined,
	to: StatusRef,
): Promise<number> {
	if (!condition) {
		throw new Error("moveIssues needs a condition");
	}
	const rows = await tx
		.select({
			id: issues.id,
			statusId: issues.statusId,
			statusName: statuses.name,
			statusCategory: statuses.category,
			resolutionId: issues.resolutionId,
			resolutionName: resolutions.name,
			resolved: issues.resolved,
		})
		.from(issues)
		.innerJoin(statuses, eq(statuses.id, issues.statusId))
		.leftJoin(resolutions, eq(resolutions.id, issues.resolutionId))
		.where(condition);

	const now = new Date();
	const pending = rows.filter((row) => row.statusId !== to.id);
	if (pending.length === 0) return 0;

	type Group = {
		statusId: string;
		resolutionId: string | null;
		resolved: Date | null;
		ids: string[];
	};
	const groups = new Map<string, Group>();
	for (const row of pending) {
		const leavesDone = row.statusCategory === "done" && to.category !== "done";
		const entersDone = row.statusCategory !== "done" && to.category === "done";
		const resolutionId = leavesDone ? null : row.resolutionId;
		const resolved = leavesDone
			? null
			: entersDone
				? (row.resolved ?? now)
				: row.resolved;
		const key = `${row.statusId}|${resolutionId ?? ""}|${resolved?.getTime() ?? ""}`;
		const group = groups.get(key) ?? {
			statusId: row.statusId,
			resolutionId,
			resolved,
			ids: [],
		};
		group.ids.push(row.id);
		groups.set(key, group);
	}

	const rowsById = new Map(rows.map((row) => [row.id, row]));
	const historyItems = new Map<
		string,
		{
			field: string;
			fromValue: string | null;
			fromText: string | null;
			toValue: string | null;
			toText: string | null;
		}[]
	>();
	let moved = 0;
	for (const group of groups.values()) {
		const updated = await tx
			.update(issues)
			.set({
				statusId: to.id,
				updated: now,
				resolutionId: group.resolutionId,
				resolved: group.resolved,
			})
			.where(
				and(inArray(issues.id, group.ids), eq(issues.statusId, group.statusId)),
			)
			.returning({ id: issues.id });
		for (const { id } of updated) {
			const row = rowsById.get(id);
			if (!row) continue;
			moved += 1;
			const leavesDone =
				row.statusCategory === "done" && to.category !== "done";
			const items = [
				{
					field: "status",
					fromValue: row.statusId,
					fromText: row.statusName,
					toValue: to.id,
					toText: to.name,
				},
				...(leavesDone && row.resolutionId
					? [
							{
								field: "resolution",
								fromValue: row.resolutionId,
								fromText: row.resolutionName,
								toValue: null,
								toText: null,
							},
						]
					: []),
			];
			historyItems.set(id, items);
		}
	}

	if (historyItems.size > 0) {
		const entries = await tx
			.insert(issueHistory)
			.values(
				[...historyItems.keys()].map((issueId) => ({
					sourceId: `local:${randomUUID()}`,
					issueId,
					authorId,
					created: now,
				})),
			)
			.returning({ id: issueHistory.id, issueId: issueHistory.issueId });
		const items = entries.flatMap((entry) =>
			(historyItems.get(entry.issueId) ?? []).map((item, sequence) => ({
				sourceId: null,
				historyId: entry.id,
				fieldType: "jira",
				sequence,
				...item,
			})),
		);
		if (items.length > 0) {
			await tx.insert(issueHistoryItems).values(items);
		}
	}
	return moved;
}
