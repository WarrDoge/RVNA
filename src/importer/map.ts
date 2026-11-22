import type {
	comments,
	issueHistory,
	issueHistoryItems,
	issues,
	worklogs,
} from "../lib/server/schema.ts";
import {
	type CustomFieldRoles,
	customFieldId,
} from "../lib/shared/custom-field-roles.ts";
import { sanitizeJiraHtml } from "./html.ts";
import type {
	JiraComment,
	JiraHistory,
	JiraIssue,
	JiraIssueLink,
	JiraUser,
	JiraWorkflowLayout,
	JiraWorkflowLayoutStatus,
	JiraWorklog,
} from "./types.ts";

type IssueInsert = typeof issues.$inferInsert;
type CommentInsert = typeof comments.$inferInsert;
type WorklogInsert = typeof worklogs.$inferInsert;
type HistoryInsert = typeof issueHistory.$inferInsert;
type HistoryItemInsert = typeof issueHistoryItems.$inferInsert;

export interface IssueMapRefs {
	baseUrl: string;
	projectId: string;
	issueTypeId: string;
	statusId: string;
	priorityId: string | null;
	resolutionId: string | null;
	userIds: Map<string, string>;
	issueIds: Map<string, string>;
	requestTypeIds?: Map<string, string>;
	customerRequestTypeFieldId?: string | null;
	requestChannel?: "portal" | "email" | "agent" | "api" | "chat" | null;
	customFields?: CustomFieldRoles;
}

export interface IssueLinkMapping {
	sourceId: string;
	typeSourceId: string;
	sourceKey: string;
	targetKey: string;
}

export interface IssueMapping {
	row: Omit<IssueInsert, "parentId" | "epicId"> & {
		parentId: string | null;
		epicId: string | null;
	};
	parentKey: string | null;
	epicKey: string | null;
	labels: string[];
	componentSourceIds: string[];
	fixVersionSourceIds: string[];
	affectsVersionSourceIds: string[];
	links: IssueLinkMapping[];
}

function userKey(user: JiraUser) {
	return user.key ?? user.name;
}

export function userIdFor(
	refs: Pick<IssueMapRefs, "userIds">,
	user: JiraUser | null | undefined,
): string | null {
	if (!user) return null;
	return refs.userIds.get(userKey(user)) ?? refs.userIds.get(user.name) ?? null;
}

function numberOrNull(value: unknown): number | null {
	const number =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim() !== ""
				? Number(value)
				: null;
	return number !== null && Number.isFinite(number) ? number : null;
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

export function parseJiraDate(value: string | null | undefined): Date | null {
	if (!value) return null;
	const date = new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
	return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeCustomValue(value: unknown): unknown {
	if (typeof value === "string") {
		return value.includes("com.atlassian.")
			? value.replace(/@[0-9a-f]+(?=\[)/g, "@")
			: value;
	}
	if (Array.isArray(value)) return value.map(normalizeCustomValue);
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				normalizeCustomValue(item),
			]),
		);
	}
	return value;
}

function customValues(
	fields: JiraIssue["fields"],
	mappedSourceIds: Set<string>,
) {
	const custom: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(fields)) {
		if (!key.startsWith("customfield_") || mappedSourceIds.has(key)) {
			continue;
		}
		if (value !== null && value !== undefined) {
			custom[key] = normalizeCustomValue(value);
		}
	}
	return custom;
}

function customValue(fields: JiraIssue["fields"], sourceId: string | null) {
	return sourceId ? fields[sourceId as `customfield_${string}`] : undefined;
}

export function mapIssue(issue: JiraIssue, refs: IssueMapRefs): IssueMapping {
	const fields = issue.fields;
	const parentKey = fields.parent?.key ?? null;
	const epicLinkId = customFieldId(refs.customFields, "epicLink");
	const storyPointsId = customFieldId(refs.customFields, "storyPoints");
	const rankId = customFieldId(refs.customFields, "rank");
	const epicKey = stringOrNull(customValue(fields, epicLinkId));
	const mappedSourceIds = new Set(
		[epicLinkId, storyPointsId, rankId].filter(
			(id): id is string => id !== null,
		),
	);
	const number = Number(issue.key.slice(issue.key.lastIndexOf("-") + 1));
	const requestTypeSourceId = refs.customerRequestTypeFieldId
		? (
				fields[refs.customerRequestTypeFieldId as `customfield_${string}`] as
					| { requestType?: { id?: string } }
					| undefined
			)?.requestType?.id
		: undefined;
	const requestTypeId =
		requestTypeSourceId && refs.requestTypeIds
			? (refs.requestTypeIds.get(`${refs.projectId}:${requestTypeSourceId}`) ??
				null)
			: null;

	return {
		row: {
			sourceId: issue.id,
			projectId: refs.projectId,
			number,
			key: issue.key,
			typeId: refs.issueTypeId,
			statusId: refs.statusId,
			priorityId: refs.priorityId,
			resolutionId: refs.resolutionId,
			requestTypeId,
			requestChannel: refs.requestChannel ?? null,
			summary: fields.summary,
			...(issue.renderedFields?.description === undefined
				? {}
				: {
						descriptionHtml: sanitizeJiraHtml(
							issue.renderedFields.description,
							refs.baseUrl,
						),
					}),
			...(fields.description === undefined
				? {}
				: { descriptionSource: fields.description }),
			reporterId: userIdFor(refs, fields.reporter),
			assigneeId: userIdFor(refs, fields.assignee),
			creatorId: userIdFor(refs, fields.creator),
			parentId: parentKey ? (refs.issueIds.get(parentKey) ?? null) : null,
			epicId: epicKey ? (refs.issueIds.get(epicKey) ?? null) : null,
			storyPoints: numberOrNull(customValue(fields, storyPointsId)),
			originalEstimate: numberOrNull(fields.timeoriginalestimate),
			remainingEstimate: numberOrNull(fields.timeestimate),
			timeSpent: numberOrNull(fields.timespent),
			dueDate: fields.duedate ?? null,
			environment: fields.environment ?? null,
			created: parseJiraDate(fields.created),
			updated: parseJiraDate(fields.updated),
			resolved: parseJiraDate(fields.resolutiondate),
			rank: stringOrNull(customValue(fields, rankId)),
			custom: customValues(fields, mappedSourceIds),
		},
		parentKey,
		epicKey,
		labels: fields.labels ?? [],
		componentSourceIds:
			fields.components?.map((component) => component.id) ?? [],
		fixVersionSourceIds: fields.fixVersions?.map((version) => version.id) ?? [],
		affectsVersionSourceIds:
			fields.versions?.map((version) => version.id) ?? [],
		links: (fields.issuelinks ?? []).map((link) =>
			mapIssueLink(issue.key, link),
		),
	};
}

export function mapIssueLink(
	issueKey: string,
	link: JiraIssueLink,
): IssueLinkMapping {
	const outward = link.outwardIssue?.key;
	const inward = link.inwardIssue?.key;
	if (!outward && !inward) {
		throw new Error(`${issueKey}: issue link ${link.id} has no target`);
	}
	return {
		sourceId: link.id,
		typeSourceId: link.type.id,
		sourceKey: outward ? issueKey : (inward as string),
		targetKey: outward ?? issueKey,
	};
}

export function mapComment(
	comment: JiraComment,
	issueId: string,
	refs: Pick<IssueMapRefs, "baseUrl" | "userIds">,
): CommentInsert {
	const internal = comment.properties?.some(
		(property) =>
			property.key === "sd.public.comment" && property.value?.internal === true,
	);

	return {
		sourceId: comment.id,
		issueId,
		authorId: userIdFor(refs, comment.author),
		...(comment.renderedBody === undefined
			? {}
			: {
					bodyHtml: sanitizeJiraHtml(comment.renderedBody, refs.baseUrl),
				}),
		...(comment.body === undefined ? {} : { bodySource: comment.body }),
		created: parseJiraDate(comment.created),
		updated: parseJiraDate(comment.updated),
		internal: internal ?? false,
	};
}

export function mapWorklog(
	worklog: JiraWorklog,
	issueId: string,
	refs: Pick<IssueMapRefs, "userIds">,
): WorklogInsert {
	return {
		sourceId: worklog.id,
		issueId,
		authorId: userIdFor(refs, worklog.author),
		started: parseJiraDate(worklog.started),
		...(worklog.timeSpentSeconds == null
			? {}
			: { seconds: worklog.timeSpentSeconds }),
		comment: worklog.comment ?? null,
	};
}

function textValue(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === "string") return value;
	return JSON.stringify(value);
}

export function mapHistory(
	history: JiraHistory,
	issueId: string,
	refs: Pick<IssueMapRefs, "userIds">,
): { row: HistoryInsert; items: Omit<HistoryItemInsert, "historyId">[] } {
	return {
		row: {
			sourceId: history.id,
			issueId,
			authorId: userIdFor(refs, history.author),
			created: parseJiraDate(history.created),
		},
		items: (history.items ?? []).map((item, sequence) => ({
			sourceId: null,
			field: item.field ?? "",
			fieldType: item.fieldtype ?? null,
			fromValue: textValue(item.from),
			fromText: item.fromString ?? null,
			toValue: textValue(item.to),
			toText: item.toString ?? null,
			sequence,
		})),
	};
}

export interface MappedWorkflowStatus {
	sourceId: string;
	statusId: string;
	name: string;
	category: "new" | "indeterminate" | "done";
}

export interface MappedWorkflowTransition {
	sourceId: string;
	name: string;
	fromStatusId: string | null;
	toStatusId: string;
	asksResolution: boolean;
	sequence: number;
}

function categoryFor(status: JiraWorkflowLayoutStatus) {
	switch (status.statusCategory?.key) {
		case "done":
			return "done" as const;
		case "indeterminate":
			return "indeterminate" as const;
		case "new":
			return "new" as const;
	}
	switch (status.statusCategory?.colorName) {
		case "green":
		case "success":
			return "done" as const;
		case "yellow":
		case "inprogress":
			return "indeterminate" as const;
		default:
			return "new" as const;
	}
}

export function mapWorkflowLayout(layout: JiraWorkflowLayout["layout"]): {
	statuses: MappedWorkflowStatus[];
	transitions: MappedWorkflowTransition[];
} {
	const statusIdByLayoutId = new Map<string, string>();
	const statuses: MappedWorkflowStatus[] = [];

	for (const status of layout.statuses) {
		if (!status.statusId) continue;
		statusIdByLayoutId.set(status.id, status.statusId);
		statuses.push({
			sourceId: status.id,
			statusId: status.statusId,
			name: status.name,
			category: categoryFor(status),
		});
	}

	const transitions: MappedWorkflowTransition[] = [];
	layout.transitions.forEach((transition, sequence) => {
		if (transition.initial) return;
		const toStatusId = statusIdByLayoutId.get(transition.targetId);
		if (!toStatusId) return;
		const fromStatusId = transition.globalTransition
			? null
			: (statusIdByLayoutId.get(transition.sourceId) ?? null);
		if (!transition.globalTransition && !fromStatusId) return;

		transitions.push({
			sourceId: transition.id,
			name: transition.name,
			fromStatusId,
			toStatusId,
			asksResolution: transition.hasResolutionField === true,
			sequence,
		});
	});

	return { statuses, transitions };
}

export interface WorkflowCandidate {
	name: string;
	statusIds: Set<string>;
}

function sameStatuses(left: Set<string>, right: Set<string>) {
	if (left.size !== right.size) return false;
	for (const value of left) {
		if (!right.has(value)) return false;
	}
	return true;
}

export function matchWorkflow(
	projectKey: string,
	projectName: string,
	statusIds: string[],
	candidates: WorkflowCandidate[],
): { name: string; ambiguous: boolean } | null {
	const wanted = new Set(statusIds);
	const matches = candidates.filter((candidate) =>
		sameStatuses(candidate.statusIds, wanted),
	);
	if (matches.length === 0) return null;

	const keyPattern = new RegExp(
		`\\b${projectKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
		"i",
	);
	const name = projectName.trim().toLowerCase();
	const scored = matches
		.map((candidate) => {
			const workflow = candidate.name.toLowerCase();
			let score = 0;
			if (keyPattern.test(candidate.name)) score += 2;
			if (name !== "" && workflow.includes(name)) score += 1;
			if (workflow.startsWith("copy of ")) score -= 1;
			return { candidate, score };
		})
		.sort((left, right) => right.score - left.score);

	const [best, second] = scored;
	return {
		name: best.candidate.name,
		ambiguous: second !== undefined && second.score === best.score,
	};
}
