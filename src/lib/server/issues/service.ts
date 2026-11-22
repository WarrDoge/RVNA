import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { and, asc, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";
import { audit } from "../admin/audit.ts";
import type {
	priorityRefSchema,
	statusRefSchema,
	userRefSchema,
} from "../api-schemas.ts";
import type { CurrentUser } from "../auth.ts";
import {
	issueTypeIconSql,
	priorityIconSql,
	projectAvatarSql,
	userAvatarSql,
	userAvatarUrl,
} from "../avatars.ts";
import {
	formatCustomValue,
	isVisibleCustomField,
	loadEditableCustomFields,
	prepareCustomFields,
} from "../custom-fields.ts";
import { db } from "../db.ts";
import { env } from "../env.ts";
import { type HistoryItem, writeHistory } from "../history.ts";
import { htmlToText, sanitizeBodyHtml } from "../html.ts";
import { HttpError } from "../http.ts";
import { recordIssueView } from "../navigator/service.ts";
import { truncate } from "../notification-text.ts";
import { newMentions, recordIssueEvent } from "../notifications.ts";
import {
	can,
	issuePermissionContext,
	issuePermissions,
	type PermissionUser,
	permissionDenied,
	permissionUserForId,
	requireBrowseIssue,
	requireIssuePermissionFor,
	requireProjectPermissionFor,
	visibleProjectIds,
} from "../permissions.ts";
import {
	attachments,
	comments,
	components,
	fields,
	issueAffectsVersions,
	issueComponents,
	issueFixVersions,
	issueHistory,
	issueHistoryItems,
	issueLabels,
	issueLinks,
	issues,
	issueTypes,
	linkTypes,
	priorities,
	projectIssueTypes,
	projects,
	resolutions,
	statuses,
	users,
	versions,
	watchers,
	worklogs,
} from "../schema.ts";
import { isAgentForProject } from "../servicedesk/access.ts";
import { applyCreateAutomation } from "../servicedesk/automation.ts";
import { recomputeIssueSla } from "../servicedesk/recompute.ts";
import { applyTransition } from "../transitions.ts";
import {
	initialStatusFor,
	transitionsFrom,
	workflowForIssueType,
} from "../workflows.ts";

type BrowseContext = Awaited<ReturnType<typeof requireBrowseIssue>>;

const iso = (value: Date | null) => value?.toISOString() ?? null;

function userRef(row: {
	id: string | null;
	username: string | null;
	displayName: string | null;
	avatarUrl: string | null;
}) {
	if (!row.id || !row.username || !row.displayName) return null;
	return {
		id: row.id,
		username: row.username,
		displayName: row.displayName,
		avatarUrl: row.avatarUrl,
	};
}

async function loadIssueRefs(condition: SQL): Promise<
	{
		id: string;
		key: string;
		summary: string;
		type: {
			id: string;
			name: string;
			subtask: boolean;
			iconUrl: string | null;
		};
		status: z.infer<typeof statusRefSchema>;
		priority: z.infer<typeof priorityRefSchema> | null;
		assignee: z.infer<typeof userRefSchema> | null;
	}[]
> {
	const assignee = alias(users, "ref_assignee");
	const rows = await db
		.select({
			id: issues.id,
			key: issues.key,
			summary: issues.summary,
			typeId: issueTypes.id,
			typeName: issueTypes.name,
			typeSubtask: issueTypes.subtask,
			typeIconUrl: issueTypeIconSql(
				issueTypes.id,
				issueTypes.iconFile,
				issueTypes.iconUrl,
			),
			statusId: statuses.id,
			statusName: statuses.name,
			statusCategory: statuses.category,
			priorityId: priorities.id,
			priorityName: priorities.name,
			priorityColor: priorities.iconColor,
			priorityIconUrl: priorityIconSql(priorities.id, priorities.iconFile),
			assigneeId: assignee.id,
			assigneeUsername: assignee.username,
			assigneeDisplayName: assignee.displayName,
			assigneeAvatarUrl: userAvatarSql(assignee.id),
		})
		.from(issues)
		.innerJoin(issueTypes, eq(issueTypes.id, issues.typeId))
		.innerJoin(statuses, eq(statuses.id, issues.statusId))
		.leftJoin(priorities, eq(priorities.id, issues.priorityId))
		.leftJoin(assignee, eq(assignee.id, issues.assigneeId))
		.where(condition)
		.orderBy(issues.key);

	return rows.map((row) => ({
		id: row.id,
		key: row.key,
		summary: row.summary,
		type: {
			id: row.typeId,
			name: row.typeName,
			subtask: row.typeSubtask,
			iconUrl: row.typeIconUrl,
		},
		status: {
			id: row.statusId,
			name: row.statusName,
			category: row.statusCategory,
		},
		priority: row.priorityId
			? {
					id: row.priorityId,
					name: row.priorityName as string,
					iconColor: row.priorityColor,
					iconUrl: row.priorityIconUrl,
				}
			: null,
		assignee: userRef({
			id: row.assigneeId,
			username: row.assigneeUsername,
			displayName: row.assigneeDisplayName,
			avatarUrl: row.assigneeAvatarUrl,
		}),
	}));
}

async function loadIssueRow(key: string) {
	const reporter = alias(users, "reporter_user");
	const assignee = alias(users, "assignee_user");
	const creator = alias(users, "creator_user");

	const [row] = await db
		.select({
			id: issues.id,
			key: issues.key,
			number: issues.number,
			summary: issues.summary,
			descriptionHtml: issues.descriptionHtml,
			storyPoints: issues.storyPoints,
			originalEstimate: issues.originalEstimate,
			remainingEstimate: issues.remainingEstimate,
			timeSpent: issues.timeSpent,
			dueDate: issues.dueDate,
			created: issues.created,
			updated: issues.updated,
			resolved: issues.resolved,
			parentId: issues.parentId,
			epicId: issues.epicId,
			custom: issues.custom,
			projectId: projects.id,
			projectKey: projects.key,
			projectLeadId: projects.leadId,
			projectName: projects.name,
			projectAvatarUrl: projectAvatarSql(projects.id),
			projectType: projects.projectType,
			projectArchived: projects.archived,
			typeId: issueTypes.id,
			typeName: issueTypes.name,
			typeSubtask: issueTypes.subtask,
			typeIconUrl: issueTypeIconSql(
				issueTypes.id,
				issueTypes.iconFile,
				issueTypes.iconUrl,
			),
			statusId: statuses.id,
			statusName: statuses.name,
			statusCategory: statuses.category,
			priorityId: priorities.id,
			priorityName: priorities.name,
			priorityColor: priorities.iconColor,
			priorityIconUrl: priorityIconSql(priorities.id, priorities.iconFile),
			resolutionId: resolutions.id,
			resolutionName: resolutions.name,
			reporterId: reporter.id,
			reporterUsername: reporter.username,
			reporterDisplayName: reporter.displayName,
			reporterAvatarUrl: userAvatarSql(reporter.id),
			assigneeId: assignee.id,
			assigneeUsername: assignee.username,
			assigneeDisplayName: assignee.displayName,
			assigneeAvatarUrl: userAvatarSql(assignee.id),
			creatorId: creator.id,
			creatorUsername: creator.username,
			creatorDisplayName: creator.displayName,
			creatorAvatarUrl: userAvatarSql(creator.id),
		})
		.from(issues)
		.innerJoin(projects, eq(projects.id, issues.projectId))
		.innerJoin(issueTypes, eq(issueTypes.id, issues.typeId))
		.innerJoin(statuses, eq(statuses.id, issues.statusId))
		.leftJoin(priorities, eq(priorities.id, issues.priorityId))
		.leftJoin(resolutions, eq(resolutions.id, issues.resolutionId))
		.leftJoin(reporter, eq(reporter.id, issues.reporterId))
		.leftJoin(assignee, eq(assignee.id, issues.assigneeId))
		.leftJoin(creator, eq(creator.id, issues.creatorId))
		.where(eq(issues.key, key.toUpperCase()))
		.limit(1);

	return row ?? null;
}

async function loadIssueDetail(key: string, viewer: PermissionUser) {
	const row = await loadIssueRow(key);
	if (!row) return null;
	const visibleProjects = await visibleProjectIds(viewer);

	const [
		labelRows,
		componentRows,
		fixRows,
		affectsRows,
		attachmentRows,
		watchRows,
		parentRefs,
		subtaskRefs,
		epicRefs,
		epicIssueRefs,
		linkRows,
		fieldRows,
		workflow,
	] = await Promise.all([
		db
			.select({ label: issueLabels.label })
			.from(issueLabels)
			.where(eq(issueLabels.issueId, row.id))
			.orderBy(issueLabels.label),
		db
			.select({ id: components.id, name: components.name })
			.from(issueComponents)
			.innerJoin(components, eq(components.id, issueComponents.componentId))
			.where(eq(issueComponents.issueId, row.id))
			.orderBy(components.name),
		db
			.select({ id: versions.id, name: versions.name })
			.from(issueFixVersions)
			.innerJoin(versions, eq(versions.id, issueFixVersions.versionId))
			.where(eq(issueFixVersions.issueId, row.id))
			.orderBy(versions.name),
		db
			.select({ id: versions.id, name: versions.name })
			.from(issueAffectsVersions)
			.innerJoin(versions, eq(versions.id, issueAffectsVersions.versionId))
			.where(eq(issueAffectsVersions.issueId, row.id))
			.orderBy(versions.name),
		(async () => {
			const author = alias(users, "attachment_author");
			return db
				.select({
					id: attachments.id,
					fileName: attachments.fileName,
					mimeType: attachments.mimeType,
					size: attachments.size,
					created: attachments.created,
					authorId: author.id,
					authorUsername: author.username,
					authorDisplayName: author.displayName,
					authorAvatarUrl: userAvatarSql(author.id),
				})
				.from(attachments)
				.leftJoin(author, eq(author.id, attachments.authorId))
				.where(eq(attachments.issueId, row.id))
				.orderBy(asc(attachments.created), asc(attachments.fileName));
		})(),
		db
			.select({
				count: sql<number>`count(*)::int`,
				watching: sql<boolean>`coalesce(bool_or(${watchers.userId} = ${viewer.id}), false)`,
			})
			.from(watchers)
			.where(eq(watchers.issueId, row.id)),
		row.parentId
			? loadIssueRefs(
					and(
						eq(issues.id, row.parentId),
						inArray(issues.projectId, visibleProjects),
					) ?? sql`false`,
				)
			: [],
		loadIssueRefs(
			and(
				eq(issues.parentId, row.id),
				inArray(issues.projectId, visibleProjects),
			) ?? sql`false`,
		),
		row.epicId
			? loadIssueRefs(
					and(
						eq(issues.id, row.epicId),
						inArray(issues.projectId, visibleProjects),
					) ?? sql`false`,
				)
			: [],
		loadIssueRefs(
			and(
				eq(issues.epicId, row.id),
				inArray(issues.projectId, visibleProjects),
			) ?? sql`false`,
		),
		(async () => {
			const other = alias(issues, "linked_issue");
			const otherType = alias(issueTypes, "linked_type");
			const otherStatus = alias(statuses, "linked_status");
			const otherPriority = alias(priorities, "linked_priority");
			const otherAssignee = alias(users, "linked_assignee");
			return db
				.select({
					id: issueLinks.id,
					sourceIssueId: issueLinks.sourceIssueId,
					typeId: linkTypes.id,
					typeName: linkTypes.name,
					typeInward: linkTypes.inward,
					typeOutward: linkTypes.outward,
					otherId: other.id,
					otherKey: other.key,
					otherSummary: other.summary,
					otherProjectId: other.projectId,
					otherTypeId: otherType.id,
					otherTypeName: otherType.name,
					otherTypeSubtask: otherType.subtask,
					otherTypeIconUrl: otherType.iconUrl,
					otherStatusId: otherStatus.id,
					otherStatusName: otherStatus.name,
					otherStatusCategory: otherStatus.category,
					otherPriorityId: otherPriority.id,
					otherPriorityName: otherPriority.name,
					otherPriorityColor: otherPriority.iconColor,
					otherAssigneeId: otherAssignee.id,
					otherAssigneeUsername: otherAssignee.username,
					otherAssigneeDisplayName: otherAssignee.displayName,
					otherAssigneeAvatarUrl: userAvatarSql(otherAssignee.id),
				})
				.from(issueLinks)
				.innerJoin(linkTypes, eq(linkTypes.id, issueLinks.typeId))
				.innerJoin(
					other,
					sql`${other.id} = case when ${issueLinks.sourceIssueId} = ${row.id} then ${issueLinks.targetIssueId} else ${issueLinks.sourceIssueId} end`,
				)
				.innerJoin(otherType, eq(otherType.id, other.typeId))
				.innerJoin(otherStatus, eq(otherStatus.id, other.statusId))
				.leftJoin(otherPriority, eq(otherPriority.id, other.priorityId))
				.leftJoin(otherAssignee, eq(otherAssignee.id, other.assigneeId))
				.where(
					or(
						eq(issueLinks.sourceIssueId, row.id),
						eq(issueLinks.targetIssueId, row.id),
					),
				)
				.orderBy(linkTypes.name, other.key);
		})(),
		db.select().from(fields),
		workflowForIssueType(row.projectId, row.typeId),
	]);

	const editableCustomFields = await loadEditableCustomFields(
		row.projectId,
		row.typeId,
		row.custom as Record<string, unknown>,
	);
	const editableFieldIds = new Set(
		editableCustomFields.map((field) => field.id),
	);

	const customFields = fieldRows
		.filter(isVisibleCustomField)
		.filter((field) => !editableFieldIds.has(field.id))
		.map((field) => ({
			id: field.id,
			name: field.name,
			value: formatCustomValue(
				(row.custom as Record<string, unknown>)[field.sourceId],
			),
		}))
		.filter((field) => field.value !== "");

	const linkGroups = new Map<
		string,
		{
			type: {
				id: string;
				name: string;
				inward: string;
				outward: string;
			};
			direction: "inward" | "outward";
			links: {
				id: string;
				issue: NonNullable<Awaited<ReturnType<typeof loadIssueRefs>>>[number];
			}[];
		}
	>();

	for (const link of linkRows) {
		if (!(await can(viewer, "BROWSE_PROJECTS", link.otherProjectId))) {
			continue;
		}
		const direction = link.sourceIssueId === row.id ? "outward" : "inward";
		const key = `${link.typeId}:${direction}`;
		const group = linkGroups.get(key) ?? {
			type: {
				id: link.typeId,
				name: link.typeName,
				inward: link.typeInward,
				outward: link.typeOutward,
			},
			direction,
			links: [],
		};
		group.links.push({
			id: link.id,
			issue: {
				id: link.otherId,
				key: link.otherKey,
				summary: link.otherSummary,
				type: {
					id: link.otherTypeId,
					name: link.otherTypeName,
					subtask: link.otherTypeSubtask,
					iconUrl: link.otherTypeIconUrl,
				},
				status: {
					id: link.otherStatusId,
					name: link.otherStatusName,
					category: link.otherStatusCategory,
				},
				priority: link.otherPriorityId
					? {
							id: link.otherPriorityId,
							name: link.otherPriorityName as string,
							iconColor: link.otherPriorityColor,
						}
					: null,
				assignee: userRef({
					id: link.otherAssigneeId,
					username: link.otherAssigneeUsername,
					displayName: link.otherAssigneeDisplayName,
					avatarUrl: link.otherAssigneeAvatarUrl,
				}),
			},
		});
		linkGroups.set(key, group);
	}

	const transitions = workflow
		? await transitionsFrom(workflow.id, row.statusId)
		: [];

	return {
		id: row.id,
		key: row.key,
		number: row.number,
		summary: row.summary,
		descriptionHtml: row.descriptionHtml,
		projectArchived: row.projectArchived,
		project: {
			id: row.projectId,
			key: row.projectKey,
			name: row.projectName,
			avatarUrl: row.projectAvatarUrl,
			type: row.projectType,
		},
		type: {
			id: row.typeId,
			name: row.typeName,
			subtask: row.typeSubtask,
			iconUrl: row.typeIconUrl,
		},
		status: {
			id: row.statusId,
			name: row.statusName,
			category: row.statusCategory,
		},
		priority: row.priorityId
			? {
					id: row.priorityId,
					name: row.priorityName as string,
					iconColor: row.priorityColor,
					iconUrl: row.priorityIconUrl,
				}
			: null,
		resolution: row.resolutionId
			? { id: row.resolutionId, name: row.resolutionName as string }
			: null,
		reporter: userRef({
			id: row.reporterId,
			username: row.reporterUsername,
			displayName: row.reporterDisplayName,
			avatarUrl: row.reporterAvatarUrl,
		}),
		assignee: userRef({
			id: row.assigneeId,
			username: row.assigneeUsername,
			displayName: row.assigneeDisplayName,
			avatarUrl: row.assigneeAvatarUrl,
		}),
		creator: userRef({
			id: row.creatorId,
			username: row.creatorUsername,
			displayName: row.creatorDisplayName,
			avatarUrl: row.creatorAvatarUrl,
		}),
		parent: parentRefs[0] ?? null,
		subtasks: subtaskRefs,
		epic: epicRefs[0] ?? null,
		epicIssues: epicIssueRefs,
		labels: labelRows.map((label) => label.label),
		components: componentRows,
		fixVersions: fixRows,
		affectsVersions: affectsRows,
		links: [...linkGroups.values()],
		attachments: attachmentRows.map((attachment) => ({
			id: attachment.id,
			fileName: attachment.fileName,
			mimeType: attachment.mimeType,
			size: attachment.size,
			created: iso(attachment.created),
			author: userRef({
				id: attachment.authorId,
				username: attachment.authorUsername,
				displayName: attachment.authorDisplayName,
				avatarUrl: attachment.authorAvatarUrl,
			}),
		})),
		watchers: {
			count: watchRows[0]?.count ?? 0,
			watching: watchRows[0]?.watching ?? false,
		},
		timeTracking: {
			originalEstimate: row.originalEstimate,
			remainingEstimate: row.remainingEstimate,
			timeSpent: row.timeSpent,
		},
		storyPoints: row.storyPoints,
		dueDate: row.dueDate,
		created: iso(row.created),
		updated: iso(row.updated),
		resolved: iso(row.resolved),
		customFields,
		editableCustomFields,
		transitions,
		permissions: await issuePermissions(
			viewer,
			{
				id: row.projectId,
				key: row.projectKey,
				leadId: row.projectLeadId,
			},
			{
				id: row.id,
				projectId: row.projectId,
				reporterId: row.reporterId,
				assigneeId: row.assigneeId,
			},
		),
	};
}

async function loadComment(actor: CurrentUser, key: string, id: string) {
	const author = alias(users, "comment_author");
	const [row] = await db
		.select({
			id: comments.id,
			authorId: author.id,
			authorUsername: author.username,
			authorDisplayName: author.displayName,
			authorAvatarUrl: userAvatarSql(author.id),
			bodyHtml: comments.bodyHtml,
			created: comments.created,
			updated: comments.updated,
			internal: comments.internal,
			issueId: issues.id,
			issueKey: issues.key,
			issueSummary: issues.summary,
			issueReporterId: issues.reporterId,
			issueAssigneeId: issues.assigneeId,
			issueProjectId: issues.projectId,
		})
		.from(comments)
		.innerJoin(issues, eq(issues.id, comments.issueId))
		.leftJoin(author, eq(author.id, comments.authorId))
		.where(and(eq(issues.key, key.toUpperCase()), eq(comments.id, id)))
		.limit(1);
	if (!row) return null;
	if (row.internal && !(await isAgentForProject(actor, row.issueProjectId))) {
		return null;
	}
	return row;
}

type CommentRow = {
	id: string;
	authorId: string | null;
	authorUsername: string | null;
	authorDisplayName: string | null;
	authorAvatarUrl: string | null;
	bodyHtml: string | null;
	created: Date | null;
	updated: Date | null;
	internal: boolean;
};

function toComment(row: CommentRow) {
	return {
		id: row.id,
		author: userRef({
			id: row.authorId,
			username: row.authorUsername,
			displayName: row.authorDisplayName,
			avatarUrl: row.authorAvatarUrl,
		}),
		bodyHtml: row.bodyHtml,
		created: iso(row.created),
		updated: iso(row.updated),
		internal: row.internal,
	};
}

async function loadWatchers(issueId: string) {
	return db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			avatarUrl: userAvatarSql(users.id),
		})
		.from(watchers)
		.innerJoin(users, eq(users.id, watchers.userId))
		.where(and(eq(watchers.issueId, issueId), eq(users.active, true)))
		.orderBy(users.displayName);
}

async function validUser(id: string) {
	const [row] = await db
		.select({ id: users.id })
		.from(users)
		.where(and(eq(users.id, id), eq(users.active, true)))
		.limit(1);
	return row !== undefined;
}

async function requireAssignableUser(
	project: { id: string; key: string; leadId: string | null },
	userId: string,
) {
	const target = await permissionUserForId(userId);
	if (!target || !(await can(target, "ASSIGNABLE_USER", project))) {
		throw new HttpError(403, permissionDenied("ASSIGNABLE_USER"));
	}
}

async function validPriority(id: string) {
	const [row] = await db
		.select({ id: priorities.id })
		.from(priorities)
		.where(eq(priorities.id, id))
		.limit(1);
	return row !== undefined;
}

async function validResolution(id: string) {
	const [row] = await db
		.select({ id: resolutions.id })
		.from(resolutions)
		.where(eq(resolutions.id, id))
		.limit(1);
	return row !== undefined;
}

async function projectScopedIds(
	table: typeof components | typeof versions,
	projectId: string,
	ids: string[],
) {
	if (ids.length === 0) return true;
	const rows = await db
		.select({ id: table.id })
		.from(table)
		.where(and(eq(table.projectId, projectId), inArray(table.id, ids)));
	return rows.length === new Set(ids).size;
}

// Applies the change the request asked for to the current rows, so a concurrent
// PATCH that touched a different value is not overwritten.
function childDiff(seen: string[], desired: string[], current: string[]) {
	const seenSet = new Set(seen);
	const desiredSet = new Set(desired);
	const added = desired.filter((id) => !seenSet.has(id));
	const removed = new Set(seen.filter((id) => !desiredSet.has(id)));
	const final = current.filter((id) => !removed.has(id));
	for (const id of added) {
		if (!final.includes(id)) final.push(id);
	}
	final.sort();
	return {
		added: final.filter((id) => !current.includes(id)),
		removed: current.filter((id) => !final.includes(id)),
		final,
	};
}

export type CreateIssueInput = {
	projectKey: string;
	typeId: string;
	summary: string;
	description?: string | null;
	priorityId?: string | null;
	assigneeId?: string | null;
	reporterId?: string | null;
	labels?: string[];
	componentIds?: string[];
	fixVersionIds?: string[];
	affectsVersionIds?: string[];
	parentKey?: string | null;
	epicKey?: string | null;
	storyPoints?: number | null;
	customFields?: Record<string, unknown>;
	customValues?: Record<string, unknown>;
};

export async function createIssueFromInput(
	actor: CurrentUser,
	input: CreateIssueInput,
) {
	const [project] = await db
		.select()
		.from(projects)
		.where(eq(projects.key, input.projectKey.toUpperCase()))
		.limit(1);
	if (!project) throw new HttpError(404, "Project not found");
	const permissionProject = await requireProjectPermissionFor(
		actor,
		project.id,
		"CREATE_ISSUES",
	);

	const [type] = await db
		.select({
			id: issueTypes.id,
			name: issueTypes.name,
			subtask: issueTypes.subtask,
		})
		.from(projectIssueTypes)
		.innerJoin(issueTypes, eq(issueTypes.id, projectIssueTypes.issueTypeId))
		.where(
			and(
				eq(projectIssueTypes.projectId, project.id),
				eq(issueTypes.id, input.typeId),
			),
		)
		.limit(1);
	if (!type) {
		throw new HttpError(400, "Issue type is not available in this project");
	}

	let parentId: string | null = null;
	if (type.subtask) {
		if (!input.parentKey) {
			throw new HttpError(400, "A sub-task needs a parent issue");
		}
		const [parent] = await db
			.select({
				id: issues.id,
				projectId: issues.projectId,
				subtask: issueTypes.subtask,
			})
			.from(issues)
			.innerJoin(issueTypes, eq(issueTypes.id, issues.typeId))
			.where(eq(issues.key, input.parentKey.toUpperCase()))
			.limit(1);
		if (!parent || parent.projectId !== project.id) {
			throw new HttpError(400, "Unknown parent issue");
		}
		if (parent.subtask) {
			throw new HttpError(400, "A sub-task cannot be a parent issue");
		}
		parentId = parent.id;
	} else if (input.parentKey) {
		throw new HttpError(400, "Only sub-tasks can have a parent");
	}

	let epicId: string | null = null;
	if (input.epicKey) {
		const [epic] = await db
			.select({ id: issues.id, typeName: issueTypes.name })
			.from(issues)
			.innerJoin(issueTypes, eq(issueTypes.id, issues.typeId))
			.where(eq(issues.key, input.epicKey.toUpperCase()))
			.limit(1);
		if (epic?.typeName !== "Epic") {
			throw new HttpError(400, "Unknown epic");
		}
		await requireBrowseIssue(actor, epic.id);
		epicId = epic.id;
	}

	if (input.priorityId && !(await validPriority(input.priorityId))) {
		throw new HttpError(400, "Unknown priority");
	}
	if (input.assigneeId) {
		if (!(await validUser(input.assigneeId))) {
			throw new HttpError(400, "Unknown assignee");
		}
		if (!(await can(actor, "ASSIGN_ISSUES", permissionProject))) {
			throw new HttpError(403, permissionDenied("ASSIGN_ISSUES"));
		}
		await requireAssignableUser(permissionProject, input.assigneeId);
	}
	if (input.reporterId) {
		if (!(await validUser(input.reporterId))) {
			throw new HttpError(400, "Unknown reporter");
		}
		if (
			input.reporterId !== actor.id &&
			!(await can(actor, "MODIFY_REPORTER", permissionProject))
		) {
			throw new HttpError(403, permissionDenied("MODIFY_REPORTER"));
		}
	}
	const reporterId = input.reporterId ?? actor.id;
	const labels = [...new Set(input.labels ?? [])];
	const componentIds = [...new Set(input.componentIds ?? [])];
	const fixVersionIds = [...new Set(input.fixVersionIds ?? [])];
	const affectsVersionIds = [...new Set(input.affectsVersionIds ?? [])];
	if (
		componentIds.length > 0 &&
		!(await projectScopedIds(components, project.id, componentIds))
	) {
		throw new HttpError(400, "Unknown component");
	}
	if (
		fixVersionIds.length > 0 &&
		!(await projectScopedIds(versions, project.id, fixVersionIds))
	) {
		throw new HttpError(400, "Unknown fix version");
	}

	const workflow = await workflowForIssueType(project.id, type.id);
	if (!workflow) {
		throw new HttpError(400, "This issue type has no workflow in the project");
	}
	const initialStatus = await initialStatusFor(workflow.id);
	if (!initialStatus) {
		throw new HttpError(400, "The workflow has no initial status");
	}

	const descriptionHtml = await sanitizeBodyHtml(input.description);

	let customValues: Record<string, unknown>;
	if (input.customValues !== undefined) {
		customValues = input.customValues;
	} else {
		const prepared = await prepareCustomFields({
			projectId: project.id,
			issueTypeId: type.id,
			mode: "create",
			changes: input.customFields ?? {},
		});
		if (!prepared.ok) {
			throw new HttpError(400, prepared.error);
		}
		customValues = prepared.values;
	}

	const created = await db.transaction(async (tx) => {
		const [locked] = await tx
			.select({ lastIssueNumber: projects.lastIssueNumber })
			.from(projects)
			.where(eq(projects.id, project.id))
			.for("update");
		if (!locked) return null;

		const number = locked.lastIssueNumber + 1;
		await tx
			.update(projects)
			.set({ lastIssueNumber: number, updatedAt: new Date() })
			.where(eq(projects.id, project.id));

		const now = new Date();
		const [issue] = await tx
			.insert(issues)
			.values({
				sourceId: `local:${randomUUID()}`,
				projectId: project.id,
				number,
				key: `${project.key}-${number}`,
				typeId: type.id,
				statusId: initialStatus.id,
				priorityId: input.priorityId ?? null,
				resolutionId: null,
				summary: input.summary,
				descriptionHtml,
				descriptionSource: htmlToText(descriptionHtml) || null,
				reporterId,
				assigneeId: input.assigneeId ?? null,
				creatorId: actor.id,
				parentId,
				epicId,
				storyPoints: input.storyPoints ?? null,
				originalEstimate: null,
				remainingEstimate: null,
				timeSpent: null,
				dueDate: null,
				created: now,
				updated: now,
				resolved: null,
				custom: customValues,
			})
			.returning({ id: issues.id, key: issues.key });

		if (labels.length > 0) {
			await tx.insert(issueLabels).values(
				labels.map((label) => ({
					sourceId: null,
					issueId: issue.id,
					label,
				})),
			);
		}
		if (componentIds.length > 0) {
			await tx.insert(issueComponents).values(
				componentIds.map((componentId) => ({
					sourceId: null,
					issueId: issue.id,
					componentId,
				})),
			);
		}
		if (fixVersionIds.length > 0) {
			await tx.insert(issueFixVersions).values(
				fixVersionIds.map((versionId) => ({
					sourceId: null,
					issueId: issue.id,
					versionId,
				})),
			);
		}
		if (affectsVersionIds.length > 0) {
			await tx.insert(issueAffectsVersions).values(
				affectsVersionIds.map((versionId) => ({
					sourceId: null,
					issueId: issue.id,
					versionId,
				})),
			);
		}

		return issue;
	});

	if (!created) throw new HttpError(404, "Project not found");

	await applyCreateAutomation(created.id);
	await recomputeIssueSla(created.id);
	await recordIssueEvent({
		issue: {
			id: created.id,
			key: created.key,
			summary: input.summary,
			reporterId,
			assigneeId: input.assigneeId ?? null,
		},
		actor,
		kind: "created",
		mentionedUserIds: newMentions(null, descriptionHtml),
	});

	const detail = await loadIssueDetail(created.key, actor);
	if (!detail) throw new HttpError(404, "Issue not found");
	return detail;
}

export async function createIssue(actor: CurrentUser, input: CreateIssueInput) {
	return createIssueFromInput(actor, input);
}

export type CloneIssueInput = { summary?: string } | null | undefined;

export async function listLinkTypes() {
	return db
		.select({
			id: linkTypes.id,
			name: linkTypes.name,
			inward: linkTypes.inward,
			outward: linkTypes.outward,
		})
		.from(linkTypes)
		.orderBy(linkTypes.name);
}

export async function listResolutions() {
	return db
		.select({ id: resolutions.id, name: resolutions.name })
		.from(resolutions)
		.orderBy(resolutions.sequence, resolutions.name);
}

export async function getIssue(
	actor: CurrentUser,
	key: string,
	context?: BrowseContext,
) {
	if (!context) await requireBrowseIssue(actor, key);
	const issue = await loadIssueDetail(key, actor);
	if (!issue) throw new HttpError(404, "Issue not found");
	return issue;
}

/** Record a view from an explicit user action, not from a preloaded read. */
export async function markIssueViewed(actor: CurrentUser, key: string) {
	const issue = await requireBrowseIssue(actor, key);
	await recordIssueView(actor, issue.id);
}

export async function cloneIssue(
	actor: CurrentUser,
	key: string,
	input: CloneIssueInput,
) {
	await requireBrowseIssue(actor, key);

	const source = await loadIssueRow(key);
	if (!source) throw new HttpError(404, "Issue not found");
	await requireProjectPermissionFor(actor, source.projectId, "CREATE_ISSUES");

	const [labelRows, componentRows, fixRows, affectsRows, parentRows, epicRows] =
		await Promise.all([
			db
				.select({ label: issueLabels.label })
				.from(issueLabels)
				.where(eq(issueLabels.issueId, source.id)),
			db
				.select({ id: issueComponents.componentId })
				.from(issueComponents)
				.where(eq(issueComponents.issueId, source.id)),
			db
				.select({ id: issueFixVersions.versionId })
				.from(issueFixVersions)
				.where(eq(issueFixVersions.issueId, source.id)),
			db
				.select({ id: issueAffectsVersions.versionId })
				.from(issueAffectsVersions)
				.where(eq(issueAffectsVersions.issueId, source.id)),
			source.parentId
				? db
						.select({ key: issues.key })
						.from(issues)
						.where(eq(issues.id, source.parentId))
						.limit(1)
				: [],
			source.epicId
				? db
						.select({ key: issues.key })
						.from(issues)
						.where(eq(issues.id, source.epicId))
						.limit(1)
				: [],
		]);

	const detail = await createIssueFromInput(actor, {
		projectKey: source.projectKey,
		typeId: source.typeId,
		summary: input?.summary ?? `CLONE - ${source.summary}`,
		description: source.descriptionHtml,
		priorityId: source.priorityId,
		assigneeId: source.assigneeId,
		labels: labelRows.map((row) => row.label),
		componentIds: componentRows.map((row) => row.id),
		fixVersionIds: fixRows.map((row) => row.id),
		affectsVersionIds: affectsRows.map((row) => row.id),
		parentKey: parentRows[0]?.key ?? null,
		epicKey: epicRows[0]?.key ?? null,
		storyPoints: source.storyPoints,
		customValues: source.custom as Record<string, unknown>,
	});

	const [cloners] = await db
		.select({ id: linkTypes.id })
		.from(linkTypes)
		.where(eq(linkTypes.name, "Cloners"))
		.limit(1);
	if (!cloners) return detail;

	await db.insert(issueLinks).values({
		sourceId: `local:${randomUUID()}`,
		typeId: cloners.id,
		sourceIssueId: detail.id,
		targetIssueId: source.id,
	});
	return (await loadIssueDetail(detail.key, actor)) ?? detail;
}

export type UpdateIssueInput = {
	summary?: string;
	description?: string | null;
	priority?: string | null;
	assignee?: string | null;
	reporter?: string | null;
	labels?: string[];
	components?: string[];
	fixVersions?: string[];
	dueDate?: string | null;
	storyPoints?: number | null;
	originalEstimate?: number | null;
	remainingEstimate?: number | null;
	epic?: string | null;
	customFields?: Record<string, unknown>;
};

export async function updateIssue(
	actor: CurrentUser,
	key: string,
	body: UpdateIssueInput,
) {
	const context = await requireIssuePermissionFor(actor, key, "EDIT_ISSUES");

	const row = await loadIssueRow(key);
	if (!row) throw new HttpError(404, "Issue not found");

	if (body.priority && !(await validPriority(body.priority))) {
		throw new HttpError(400, "Unknown priority");
	}
	if (body.assignee && !(await validUser(body.assignee))) {
		throw new HttpError(400, "Unknown assignee");
	}
	if (body.assignee !== undefined && body.assignee !== row.assigneeId) {
		if (!(await can(actor, "ASSIGN_ISSUES", context.project, context))) {
			throw new HttpError(403, permissionDenied("ASSIGN_ISSUES"));
		}
		if (body.assignee) {
			await requireAssignableUser(context.project, body.assignee);
		}
	}
	if (body.reporter && !(await validUser(body.reporter))) {
		throw new HttpError(400, "Unknown reporter");
	}
	if (
		body.reporter !== undefined &&
		body.reporter !== row.reporterId &&
		!(await can(actor, "MODIFY_REPORTER", context.project, context))
	) {
		throw new HttpError(403, permissionDenied("MODIFY_REPORTER"));
	}
	if (
		body.components &&
		!(await projectScopedIds(components, row.projectId, body.components))
	) {
		throw new HttpError(400, "Unknown component");
	}
	if (
		body.fixVersions &&
		!(await projectScopedIds(versions, row.projectId, body.fixVersions))
	) {
		throw new HttpError(400, "Unknown fix version");
	}

	let epicId: string | null | undefined;
	if (body.epic !== undefined) {
		if (body.epic === null) {
			epicId = null;
		} else {
			const [epic] = await db
				.select({ id: issues.id, typeName: issueTypes.name })
				.from(issues)
				.innerJoin(issueTypes, eq(issueTypes.id, issues.typeId))
				.where(eq(issues.key, body.epic.toUpperCase()))
				.limit(1);
			if (epic?.typeName !== "Epic") {
				throw new HttpError(400, "Unknown epic");
			}
			await requireBrowseIssue(actor, epic.id);
			epicId = epic.id;
		}
	}

	const [currentLabelRows, currentComponentRows, currentFixRows, currentEpic] =
		await Promise.all([
			db
				.select({ label: issueLabels.label })
				.from(issueLabels)
				.where(eq(issueLabels.issueId, row.id)),
			db
				.select({ id: components.id, name: components.name })
				.from(issueComponents)
				.innerJoin(components, eq(components.id, issueComponents.componentId))
				.where(eq(issueComponents.issueId, row.id)),
			db
				.select({ id: versions.id, name: versions.name })
				.from(issueFixVersions)
				.innerJoin(versions, eq(versions.id, issueFixVersions.versionId))
				.where(eq(issueFixVersions.issueId, row.id)),
			row.epicId
				? db
						.select({ id: issues.id, key: issues.key })
						.from(issues)
						.where(eq(issues.id, row.epicId))
						.limit(1)
				: [],
		]);

	const seenLabels = currentLabelRows.map((label) => label.label).sort();
	const nextLabels =
		body.labels === undefined ? seenLabels : [...new Set(body.labels)].sort();
	const seenComponents = currentComponentRows
		.map((component) => component.id)
		.sort();
	const nextComponents =
		body.components === undefined
			? seenComponents
			: [...new Set(body.components)].sort();
	const seenFixVersions = currentFixRows.map((version) => version.id).sort();
	const nextFixVersions =
		body.fixVersions === undefined
			? seenFixVersions
			: [...new Set(body.fixVersions)].sort();

	const descriptionHtml =
		body.description === undefined
			? row.descriptionHtml
			: await sanitizeBodyHtml(body.description);

	const updates: Partial<typeof issues.$inferInsert> = {
		updated: new Date(),
	};
	const items: HistoryItem[] = [];

	if (body.customFields !== undefined) {
		const prepared = await prepareCustomFields({
			projectId: row.projectId,
			issueTypeId: row.typeId,
			mode: "update",
			current: row.custom as Record<string, unknown>,
			changes: body.customFields,
		});
		if (!prepared.ok) {
			throw new HttpError(400, prepared.error);
		}
		updates.custom = prepared.values;
		items.push(...prepared.history);
	}

	if (body.summary !== undefined && body.summary !== row.summary) {
		updates.summary = body.summary;
		items.push({
			field: "summary",
			fieldType: "jira",
			fromValue: null,
			fromText: row.summary,
			toValue: null,
			toText: body.summary,
		});
	}
	if (
		body.description !== undefined &&
		descriptionHtml !== row.descriptionHtml
	) {
		updates.descriptionHtml = descriptionHtml;
		updates.descriptionSource = htmlToText(descriptionHtml) || null;
		items.push({
			field: "description",
			fieldType: "jira",
			fromValue: null,
			fromText: null,
			toValue: null,
			toText: null,
		});
	}
	if (body.priority !== undefined && body.priority !== row.priorityId) {
		const priority = body.priority
			? (
					await db
						.select({ id: priorities.id, name: priorities.name })
						.from(priorities)
						.where(eq(priorities.id, body.priority))
						.limit(1)
				)[0]
			: null;
		updates.priorityId = body.priority;
		items.push({
			field: "priority",
			fieldType: "jira",
			fromValue: row.priorityId,
			fromText: row.priorityName,
			toValue: body.priority,
			toText: priority?.name ?? null,
		});
	}
	if (body.assignee !== undefined && body.assignee !== row.assigneeId) {
		const assignee = body.assignee
			? (
					await db
						.select({ id: users.id, displayName: users.displayName })
						.from(users)
						.where(eq(users.id, body.assignee))
						.limit(1)
				)[0]
			: null;
		updates.assigneeId = body.assignee;
		items.push({
			field: "assignee",
			fieldType: "jira",
			fromValue: row.assigneeId,
			fromText: row.assigneeDisplayName,
			toValue: body.assignee,
			toText: assignee?.displayName ?? null,
		});
	}
	if (body.reporter !== undefined && body.reporter !== row.reporterId) {
		const reporter = body.reporter
			? (
					await db
						.select({ id: users.id, displayName: users.displayName })
						.from(users)
						.where(eq(users.id, body.reporter))
						.limit(1)
				)[0]
			: null;
		updates.reporterId = body.reporter;
		items.push({
			field: "reporter",
			fieldType: "jira",
			fromValue: row.reporterId,
			fromText: row.reporterDisplayName,
			toValue: body.reporter,
			toText: reporter?.displayName ?? null,
		});
	}
	if (body.dueDate !== undefined && body.dueDate !== row.dueDate) {
		if (!(await can(actor, "SCHEDULE_ISSUES", context.project, context))) {
			throw new HttpError(403, permissionDenied("SCHEDULE_ISSUES"));
		}
		updates.dueDate = body.dueDate;
		items.push({
			field: "duedate",
			fieldType: "jira",
			fromValue: row.dueDate,
			fromText: row.dueDate,
			toValue: body.dueDate,
			toText: body.dueDate,
		});
	}
	if (body.storyPoints !== undefined && body.storyPoints !== row.storyPoints) {
		updates.storyPoints = body.storyPoints;
		items.push({
			field: "Story Points",
			fieldType: "custom",
			fromValue: row.storyPoints === null ? null : String(row.storyPoints),
			fromText: row.storyPoints === null ? null : String(row.storyPoints),
			toValue: body.storyPoints === null ? null : String(body.storyPoints),
			toText: body.storyPoints === null ? null : String(body.storyPoints),
		});
	}
	if (
		body.originalEstimate !== undefined &&
		body.originalEstimate !== row.originalEstimate
	) {
		updates.originalEstimate = body.originalEstimate;
		items.push({
			field: "timeoriginalestimate",
			fieldType: "jira",
			fromValue:
				row.originalEstimate === null ? null : String(row.originalEstimate),
			fromText:
				row.originalEstimate === null ? null : String(row.originalEstimate),
			toValue:
				body.originalEstimate === null ? null : String(body.originalEstimate),
			toText:
				body.originalEstimate === null ? null : String(body.originalEstimate),
		});
	}
	if (
		body.remainingEstimate !== undefined &&
		body.remainingEstimate !== row.remainingEstimate
	) {
		updates.remainingEstimate = body.remainingEstimate;
		items.push({
			field: "timeestimate",
			fieldType: "jira",
			fromValue:
				row.remainingEstimate === null ? null : String(row.remainingEstimate),
			fromText:
				row.remainingEstimate === null ? null : String(row.remainingEstimate),
			toValue:
				body.remainingEstimate === null ? null : String(body.remainingEstimate),
			toText:
				body.remainingEstimate === null ? null : String(body.remainingEstimate),
		});
	}
	if (epicId !== undefined && epicId !== row.epicId) {
		const epic = epicId
			? (
					await db
						.select({ id: issues.id, key: issues.key })
						.from(issues)
						.where(eq(issues.id, epicId))
						.limit(1)
				)[0]
			: null;
		updates.epicId = epicId;
		items.push({
			field: "Epic Link",
			fieldType: "custom",
			fromValue: currentEpic[0]?.id ?? null,
			fromText: currentEpic[0]?.key ?? null,
			toValue: epic?.id ?? null,
			toText: epic?.key ?? null,
		});
	}

	const changedItems = await db.transaction(async (tx) => {
		const [locked] = await tx
			.select({ id: issues.id })
			.from(issues)
			.where(eq(issues.id, row.id))
			.for("update");
		if (!locked) return null;

		const actualItems = [...items];
		if (body.labels !== undefined) {
			const rows = await tx
				.select({ label: issueLabels.label })
				.from(issueLabels)
				.where(eq(issueLabels.issueId, row.id));
			const current = rows.map((label) => label.label).sort();
			const diff = childDiff(seenLabels, nextLabels, current);
			if (diff.final.join("\u0000") !== current.join("\u0000")) {
				actualItems.push({
					field: "labels",
					fieldType: "jira",
					fromValue: null,
					fromText: current.join(" "),
					toValue: null,
					toText: diff.final.join(" "),
				});
				if (diff.removed.length > 0) {
					await tx
						.delete(issueLabels)
						.where(
							and(
								eq(issueLabels.issueId, row.id),
								inArray(issueLabels.label, diff.removed),
							),
						);
				}
				if (diff.added.length > 0) {
					await tx
						.insert(issueLabels)
						.values(
							diff.added.map((label) => ({
								sourceId: null,
								issueId: row.id,
								label,
							})),
						)
						.onConflictDoNothing();
				}
			}
		}
		if (body.components !== undefined) {
			const rows = await tx
				.select({ id: issueComponents.componentId })
				.from(issueComponents)
				.where(eq(issueComponents.issueId, row.id));
			const current = rows.map((row) => row.id).sort();
			const diff = childDiff(seenComponents, nextComponents, current);
			if (diff.final.join(",") !== current.join(",")) {
				const all = await tx
					.select({ id: components.id, name: components.name })
					.from(components)
					.where(
						inArray(components.id, [...new Set([...current, ...diff.final])]),
					);
				const nameOf = (id: string) =>
					all.find((component) => component.id === id)?.name ?? id;
				actualItems.push({
					field: "Component",
					fieldType: "jira",
					fromValue: null,
					fromText: current.map(nameOf).join(", "),
					toValue: null,
					toText: diff.final.map(nameOf).join(", "),
				});
				if (diff.removed.length > 0) {
					await tx
						.delete(issueComponents)
						.where(
							and(
								eq(issueComponents.issueId, row.id),
								inArray(issueComponents.componentId, diff.removed),
							),
						);
				}
				if (diff.added.length > 0) {
					await tx
						.insert(issueComponents)
						.values(
							diff.added.map((componentId) => ({
								sourceId: null,
								issueId: row.id,
								componentId,
							})),
						)
						.onConflictDoNothing();
				}
			}
		}
		if (body.fixVersions !== undefined) {
			const rows = await tx
				.select({ id: issueFixVersions.versionId })
				.from(issueFixVersions)
				.where(eq(issueFixVersions.issueId, row.id));
			const current = rows.map((row) => row.id).sort();
			const diff = childDiff(seenFixVersions, nextFixVersions, current);
			if (diff.final.join(",") !== current.join(",")) {
				const all = await tx
					.select({ id: versions.id, name: versions.name })
					.from(versions)
					.where(
						inArray(versions.id, [...new Set([...current, ...diff.final])]),
					);
				const nameOf = (id: string) =>
					all.find((version) => version.id === id)?.name ?? id;
				actualItems.push({
					field: "Fix Version",
					fieldType: "jira",
					fromValue: null,
					fromText: current.map(nameOf).join(", "),
					toValue: null,
					toText: diff.final.map(nameOf).join(", "),
				});
				if (diff.removed.length > 0) {
					await tx
						.delete(issueFixVersions)
						.where(
							and(
								eq(issueFixVersions.issueId, row.id),
								inArray(issueFixVersions.versionId, diff.removed),
							),
						);
				}
				if (diff.added.length > 0) {
					await tx
						.insert(issueFixVersions)
						.values(
							diff.added.map((versionId) => ({
								sourceId: null,
								issueId: row.id,
								versionId,
							})),
						)
						.onConflictDoNothing();
				}
			}
		}

		await tx.update(issues).set(updates).where(eq(issues.id, row.id));
		await writeHistory(tx, row.id, actor.id, actualItems);
		return actualItems;
	});
	if (!changedItems) throw new HttpError(404, "Issue not found");

	const nextIssue = {
		id: row.id,
		key: row.key,
		summary: updates.summary ?? row.summary,
		reporterId:
			updates.reporterId !== undefined ? updates.reporterId : row.reporterId,
		assigneeId:
			updates.assigneeId !== undefined ? updates.assigneeId : row.assigneeId,
	};

	if (changedItems.length > 0) {
		await recordIssueEvent({
			issue: nextIssue,
			actor,
			kind: "updated",
			changes: changedItems.map((item) =>
				item.field === "description"
					? {
							field: "Description",
							from: truncate(htmlToText(row.descriptionHtml)),
							to: truncate(htmlToText(descriptionHtml)),
						}
					: { field: item.field, from: item.fromText, to: item.toText },
			),
			mentionedUserIds:
				body.description === undefined
					? []
					: newMentions(row.descriptionHtml, descriptionHtml),
		});
	}

	if (body.assignee !== undefined && body.assignee !== row.assigneeId) {
		await recordIssueEvent({
			issue: nextIssue,
			actor,
			kind: "assigned",
		});
	}

	await recomputeIssueSla(row.id);

	const detail = await loadIssueDetail(row.key, actor);
	if (!detail) throw new HttpError(404, "Issue not found");
	return detail;
}

export async function deleteIssue(actor: CurrentUser, key: string) {
	await requireIssuePermissionFor(actor, key, "DELETE_ISSUES");

	const row = await loadIssueRow(key);
	if (!row) throw new HttpError(404, "Issue not found");

	const files = await db
		.select({ storagePath: attachments.storagePath })
		.from(attachments)
		.where(eq(attachments.issueId, row.id));

	await recordIssueEvent({
		issue: {
			id: row.id,
			key: row.key,
			summary: row.summary,
			reporterId: row.reporterId,
			assigneeId: row.assigneeId,
		},
		actor,
		kind: "deleted",
	});

	await db.transaction(async (tx) => {
		await audit(tx, actor, {
			action: "issue.delete",
			entityType: "issue",
			entityId: row.id,
			summary: `Deleted issue ${row.key} with ${files.length} attachments`,
		});
		await tx.delete(issues).where(eq(issues.id, row.id));
	});

	const root = resolve(env.ATTACHMENTS_DIR);
	for (const file of files) {
		const path = resolve(join(root, file.storagePath));
		if (path.startsWith(root + sep)) {
			await unlink(path).catch(() => undefined);
		}
	}
}

export type TransitionInput = {
	transitionId: string;
	resolutionId?: string;
};

export async function transitionIssue(
	actor: CurrentUser,
	key: string,
	body: TransitionInput,
) {
	await requireIssuePermissionFor(actor, key, "TRANSITION_ISSUES");

	const row = await loadIssueRow(key);
	if (!row) throw new HttpError(404, "Issue not found");

	const workflow = await workflowForIssueType(row.projectId, row.typeId);
	if (!workflow) {
		throw new HttpError(400, "This issue type has no workflow in the project");
	}

	const transitions = await transitionsFrom(workflow.id, row.statusId);
	const transition = transitions.find((item) => item.id === body.transitionId);
	if (!transition) {
		throw new HttpError(
			400,
			"Transition is not available from the current status",
		);
	}

	if (transition.asksResolution && !body.resolutionId) {
		throw new HttpError(400, "A resolution is required for this transition");
	}

	if (body.resolutionId && !(await validResolution(body.resolutionId))) {
		throw new HttpError(400, "Unknown resolution");
	}

	const fromDone = row.statusCategory === "done";
	const toDone = transition.to.category === "done";
	if (toDone && !fromDone) {
		await requireIssuePermissionFor(actor, key, "RESOLVE_ISSUES");
	} else if (!toDone && fromDone) {
		await requireIssuePermissionFor(actor, key, "CLOSE_ISSUES");
	}

	const items = await db.transaction(async (tx) => {
		return applyTransition(
			tx,
			{
				id: row.id,
				statusId: row.statusId,
				statusName: row.statusName,
				statusCategory: row.statusCategory,
				resolutionId: row.resolutionId,
				resolutionName: row.resolutionName,
				resolved: row.resolved,
			},
			transition,
			actor.id,
			body.resolutionId,
		);
	});
	if (!items) {
		throw new HttpError(
			409,
			"Transition is not available from the current status",
		);
	}

	await recordIssueEvent({
		issue: {
			id: row.id,
			key: row.key,
			summary: row.summary,
			reporterId: row.reporterId,
			assigneeId: row.assigneeId,
		},
		actor,
		kind: "transitioned",
		changes: items.map((item) => ({
			field: item.field === "status" ? "Status" : "Resolution",
			from: item.fromText,
			to: item.toText,
		})),
	});

	await recomputeIssueSla(row.id);

	const detail = await loadIssueDetail(row.key, actor);
	if (!detail) throw new HttpError(404, "Issue not found");
	return detail;
}

export async function listComments(
	actor: CurrentUser,
	key: string,
	context?: BrowseContext,
) {
	const issue = context ?? (await requireBrowseIssue(actor, key));

	// Internal notes belong to the desk; a customer never sees them.
	const agent = await isAgentForProject(actor, issue.project.id);
	const author = alias(users, "comment_author");
	const rows = await db
		.select({
			id: comments.id,
			authorId: author.id,
			authorUsername: author.username,
			authorDisplayName: author.displayName,
			authorAvatarUrl: userAvatarSql(author.id),
			bodyHtml: comments.bodyHtml,
			created: comments.created,
			updated: comments.updated,
			internal: comments.internal,
		})
		.from(comments)
		.leftJoin(author, eq(author.id, comments.authorId))
		.where(
			agent
				? eq(comments.issueId, issue.id)
				: and(eq(comments.issueId, issue.id), eq(comments.internal, false)),
		)
		.orderBy(asc(comments.created), asc(comments.id));

	return rows.map(toComment);
}

export type AddCommentInput = { body: string; internal?: boolean };

export async function addComment(
	actor: CurrentUser,
	key: string,
	body: AddCommentInput,
) {
	await requireIssuePermissionFor(actor, key, "ADD_COMMENTS");

	const [issue] = await db
		.select({
			id: issues.id,
			key: issues.key,
			summary: issues.summary,
			reporterId: issues.reporterId,
			assigneeId: issues.assigneeId,
			projectId: issues.projectId,
		})
		.from(issues)
		.where(eq(issues.key, key.toUpperCase()))
		.limit(1);
	if (!issue) throw new HttpError(404, "Issue not found");

	const internal = body.internal === true;
	if (internal && !(await isAgentForProject(actor, issue.projectId))) {
		throw new HttpError(403, "Only agents can write internal comments");
	}

	const bodyHtml = await sanitizeBodyHtml(body.body);
	if (!bodyHtml) throw new HttpError(400, "Comment body is empty");

	const now = new Date();
	const created = await db.transaction(async (tx) => {
		const [comment] = await tx
			.insert(comments)
			.values({
				sourceId: `local:${randomUUID()}`,
				issueId: issue.id,
				authorId: actor.id,
				bodyHtml,
				bodySource: htmlToText(bodyHtml) || null,
				created: now,
				updated: now,
				internal,
			})
			.returning();
		await tx
			.update(issues)
			.set({ updated: now })
			.where(eq(issues.id, issue.id));
		return comment;
	});

	await recordIssueEvent({
		issue,
		actor,
		kind: "commented",
		commentHtml: bodyHtml,
		mentionedUserIds: newMentions(null, bodyHtml),
		internal,
	});
	await recomputeIssueSla(issue.id);

	return {
		id: created.id,
		author: {
			id: actor.id,
			username: actor.username,
			displayName: actor.displayName,
			avatarUrl: userAvatarUrl(actor.id),
		},
		bodyHtml: created.bodyHtml,
		created: iso(created.created),
		updated: iso(created.updated),
		internal: created.internal,
	};
}

export async function updateComment(
	actor: CurrentUser,
	key: string,
	id: string,
	body: { body: string },
) {
	await requireBrowseIssue(actor, key);

	const row = await loadComment(actor, key, id);
	if (!row) throw new HttpError(404, "Comment not found");
	const commentPermission =
		row.authorId === actor.id ? "EDIT_OWN_COMMENTS" : "EDIT_ALL_COMMENTS";
	await requireIssuePermissionFor(actor, key, commentPermission);

	const bodyHtml = await sanitizeBodyHtml(body.body);
	if (!bodyHtml) throw new HttpError(400, "Comment body is empty");

	const now = new Date();
	const updated = await db.transaction(async (tx) => {
		const [comment] = await tx
			.update(comments)
			.set({
				bodyHtml,
				bodySource: htmlToText(bodyHtml) || null,
				updated: now,
			})
			.where(eq(comments.id, row.id))
			.returning();
		if (!comment) return null;
		await tx
			.update(issues)
			.set({ updated: now })
			.where(eq(issues.id, row.issueId));
		return comment;
	});
	if (!updated) throw new HttpError(404, "Comment not found");

	await recordIssueEvent({
		issue: {
			id: row.issueId,
			key: row.issueKey,
			summary: row.issueSummary,
			reporterId: row.issueReporterId,
			assigneeId: row.issueAssigneeId,
		},
		actor,
		kind: "comment_edited",
		commentHtml: bodyHtml,
		mentionedUserIds: newMentions(row.bodyHtml, bodyHtml),
		internal: row.internal,
	});

	return toComment({
		...row,
		bodyHtml: updated.bodyHtml,
		updated: updated.updated,
	});
}

export async function deleteComment(
	actor: CurrentUser,
	key: string,
	id: string,
) {
	await requireBrowseIssue(actor, key);

	const row = await loadComment(actor, key, id);
	if (!row) throw new HttpError(404, "Comment not found");
	const commentPermission =
		row.authorId === actor.id ? "DELETE_OWN_COMMENTS" : "DELETE_ALL_COMMENTS";
	await requireIssuePermissionFor(actor, key, commentPermission);

	const now = new Date();
	await db.transaction(async (tx) => {
		await tx.delete(comments).where(eq(comments.id, row.id));
		await tx
			.update(issues)
			.set({ updated: now })
			.where(eq(issues.id, row.issueId));
	});
	await recomputeIssueSla(row.issueId);
}

export async function listHistory(
	actor: CurrentUser,
	key: string,
	context?: BrowseContext,
) {
	const issue = context ?? (await requireBrowseIssue(actor, key));

	const author = alias(users, "history_author");
	const entries = await db
		.select({
			id: issueHistory.id,
			created: issueHistory.created,
			via: issueHistory.via,
			authorId: author.id,
			authorUsername: author.username,
			authorDisplayName: author.displayName,
			authorAvatarUrl: userAvatarSql(author.id),
		})
		.from(issueHistory)
		.leftJoin(author, eq(author.id, issueHistory.authorId))
		.where(eq(issueHistory.issueId, issue.id))
		.orderBy(asc(issueHistory.created), asc(issueHistory.id));

	if (entries.length === 0) return [];

	const items = await db
		.select()
		.from(issueHistoryItems)
		.where(
			inArray(
				issueHistoryItems.historyId,
				entries.map((entry) => entry.id),
			),
		)
		.orderBy(issueHistoryItems.sequence);

	return entries.map((entry) => ({
		id: entry.id,
		author: userRef({
			id: entry.authorId,
			username: entry.authorUsername,
			displayName: entry.authorDisplayName,
			avatarUrl: entry.authorAvatarUrl,
		}),
		created: iso(entry.created),
		via: entry.via,
		items: items
			.filter((item) => item.historyId === entry.id)
			.map((item) => ({
				field: item.field,
				fieldType: item.fieldType,
				from: item.fromValue,
				fromText: item.fromText,
				to: item.toValue,
				toText: item.toText,
			})),
	}));
}

export async function listWorklogs(
	actor: CurrentUser,
	key: string,
	context?: BrowseContext,
) {
	const issue = context ?? (await requireBrowseIssue(actor, key));

	const author = alias(users, "worklog_author");
	const rows = await db
		.select({
			id: worklogs.id,
			started: worklogs.started,
			seconds: worklogs.seconds,
			comment: worklogs.comment,
			authorId: author.id,
			authorUsername: author.username,
			authorDisplayName: author.displayName,
			authorAvatarUrl: userAvatarSql(author.id),
		})
		.from(worklogs)
		.leftJoin(author, eq(author.id, worklogs.authorId))
		.where(eq(worklogs.issueId, issue.id))
		.orderBy(asc(worklogs.started), asc(worklogs.id));

	return rows.map((row) => ({
		id: row.id,
		author: userRef({
			id: row.authorId,
			username: row.authorUsername,
			displayName: row.authorDisplayName,
			avatarUrl: row.authorAvatarUrl,
		}),
		started: iso(row.started),
		seconds: row.seconds,
		comment: row.comment,
	}));
}

export type AddWorklogInput = {
	seconds: number;
	started?: string;
	comment?: string;
	remainingEstimate?: number | null;
};

export async function addWorklog(
	actor: CurrentUser,
	key: string,
	body: AddWorklogInput,
) {
	await requireIssuePermissionFor(actor, key, "WORK_ON_ISSUES");

	const row = await loadIssueRow(key);
	if (!row) throw new HttpError(404, "Issue not found");

	const seconds = body.seconds;
	const created = await db.transaction(async (tx) => {
		const [locked] = await tx
			.select({
				timeSpent: issues.timeSpent,
				remainingEstimate: issues.remainingEstimate,
			})
			.from(issues)
			.where(eq(issues.id, row.id))
			.for("update");
		if (!locked) return null;

		const timeSpent = (locked.timeSpent ?? 0) + seconds;
		const remainingEstimate =
			body.remainingEstimate !== undefined
				? body.remainingEstimate
				: locked.remainingEstimate === null
					? null
					: Math.max(0, locked.remainingEstimate - seconds);

		const items: HistoryItem[] = [];
		if (timeSpent !== (locked.timeSpent ?? 0)) {
			items.push({
				field: "timespent",
				fieldType: "jira",
				fromValue: locked.timeSpent === null ? null : String(locked.timeSpent),
				fromText: locked.timeSpent === null ? null : String(locked.timeSpent),
				toValue: String(timeSpent),
				toText: String(timeSpent),
			});
		}
		if (remainingEstimate !== locked.remainingEstimate) {
			items.push({
				field: "timeestimate",
				fieldType: "jira",
				fromValue:
					locked.remainingEstimate === null
						? null
						: String(locked.remainingEstimate),
				fromText:
					locked.remainingEstimate === null
						? null
						: String(locked.remainingEstimate),
				toValue: remainingEstimate === null ? null : String(remainingEstimate),
				toText: remainingEstimate === null ? null : String(remainingEstimate),
			});
		}

		const [worklog] = await tx
			.insert(worklogs)
			.values({
				sourceId: `local:${randomUUID()}`,
				issueId: row.id,
				authorId: actor.id,
				started: body.started ? new Date(body.started) : new Date(),
				seconds,
				comment: body.comment ?? null,
			})
			.returning();

		await tx
			.update(issues)
			.set({ timeSpent, remainingEstimate, updated: new Date() })
			.where(eq(issues.id, row.id));
		await writeHistory(tx, row.id, actor.id, items);
		return worklog;
	});
	if (!created) throw new HttpError(404, "Issue not found");

	await recordIssueEvent({
		issue: {
			id: row.id,
			key: row.key,
			summary: row.summary,
			reporterId: row.reporterId,
			assigneeId: row.assigneeId,
		},
		actor,
		kind: "worklog_added",
		worklogSeconds: seconds,
		worklogComment: body.comment ?? null,
	});

	return {
		id: created.id,
		author: {
			id: actor.id,
			username: actor.username,
			displayName: actor.displayName,
			avatarUrl: userAvatarUrl(actor.id),
		},
		started: iso(created.started),
		seconds: created.seconds,
		comment: created.comment,
	};
}

export async function deleteWorklog(
	actor: CurrentUser,
	key: string,
	id: string,
) {
	await requireBrowseIssue(actor, key);

	const row = await loadIssueRow(key);
	if (!row) throw new HttpError(404, "Issue not found");

	const [worklog] = await db
		.select()
		.from(worklogs)
		.where(and(eq(worklogs.id, id), eq(worklogs.issueId, row.id)))
		.limit(1);
	if (!worklog) throw new HttpError(404, "Worklog not found");
	const worklogPermission =
		worklog.authorId === actor.id ? "WORKLOG_DELETE_OWN" : "WORKLOG_DELETE_ALL";
	await requireIssuePermissionFor(actor, key, worklogPermission);

	const result = await db.transaction(async (tx) => {
		const [locked] = await tx
			.select({
				timeSpent: issues.timeSpent,
				remainingEstimate: issues.remainingEstimate,
			})
			.from(issues)
			.where(eq(issues.id, row.id))
			.for("update");
		if (!locked) return "missing-issue" as const;

		const [deleted] = await tx
			.delete(worklogs)
			.where(and(eq(worklogs.id, worklog.id), eq(worklogs.issueId, row.id)))
			.returning();
		if (!deleted) return "missing-worklog" as const;

		const timeSpent = Math.max(0, (locked.timeSpent ?? 0) - deleted.seconds);
		const remainingEstimate =
			locked.remainingEstimate === null
				? null
				: locked.remainingEstimate + deleted.seconds;

		const items: HistoryItem[] = [
			{
				field: "timespent",
				fieldType: "jira",
				fromValue: locked.timeSpent === null ? null : String(locked.timeSpent),
				fromText: locked.timeSpent === null ? null : String(locked.timeSpent),
				toValue: String(timeSpent),
				toText: String(timeSpent),
			},
		];
		if (remainingEstimate !== locked.remainingEstimate) {
			items.push({
				field: "timeestimate",
				fieldType: "jira",
				fromValue:
					locked.remainingEstimate === null
						? null
						: String(locked.remainingEstimate),
				fromText:
					locked.remainingEstimate === null
						? null
						: String(locked.remainingEstimate),
				toValue: remainingEstimate === null ? null : String(remainingEstimate),
				toText: remainingEstimate === null ? null : String(remainingEstimate),
			});
		}

		await tx
			.update(issues)
			.set({ timeSpent, remainingEstimate, updated: new Date() })
			.where(eq(issues.id, row.id));
		await writeHistory(tx, row.id, actor.id, items);
		return "deleted" as const;
	});
	if (result === "missing-issue") {
		throw new HttpError(404, "Issue not found");
	}
	if (result === "missing-worklog") {
		throw new HttpError(404, "Worklog not found");
	}
}

export async function watchIssue(actor: CurrentUser, key: string) {
	await requireIssuePermissionFor(actor, key, "MANAGE_WATCHERS");

	const [issue] = await db
		.select({ id: issues.id })
		.from(issues)
		.where(eq(issues.key, key.toUpperCase()))
		.limit(1);
	if (!issue) throw new HttpError(404, "Issue not found");

	await db
		.insert(watchers)
		.values({ sourceId: null, issueId: issue.id, userId: actor.id })
		.onConflictDoNothing();

	const [count] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(watchers)
		.where(eq(watchers.issueId, issue.id));

	return { count: count?.count ?? 0, watching: true };
}

export async function unwatchIssue(actor: CurrentUser, key: string) {
	await requireIssuePermissionFor(actor, key, "MANAGE_WATCHERS");

	const [issue] = await db
		.select({ id: issues.id })
		.from(issues)
		.where(eq(issues.key, key.toUpperCase()))
		.limit(1);
	if (!issue) throw new HttpError(404, "Issue not found");

	await db
		.delete(watchers)
		.where(and(eq(watchers.issueId, issue.id), eq(watchers.userId, actor.id)));

	const [count] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(watchers)
		.where(eq(watchers.issueId, issue.id));

	return { count: count?.count ?? 0, watching: false };
}

export async function listWatchers(actor: CurrentUser, key: string) {
	await requireIssuePermissionFor(actor, key, "VIEW_VOTERS_AND_WATCHERS");

	const [issue] = await db
		.select({ id: issues.id })
		.from(issues)
		.where(eq(issues.key, key.toUpperCase()))
		.limit(1);
	if (!issue) throw new HttpError(404, "Issue not found");

	return { watchers: await loadWatchers(issue.id) };
}

export async function addWatcher(
	actor: CurrentUser,
	key: string,
	userId: string,
) {
	await requireIssuePermissionFor(actor, key, "MANAGE_WATCHERS");

	const [issue] = await db
		.select({ id: issues.id })
		.from(issues)
		.where(eq(issues.key, key.toUpperCase()))
		.limit(1);
	if (!issue) throw new HttpError(404, "Issue not found");
	if (!(await validUser(userId))) {
		throw new HttpError(400, "Unknown user");
	}

	await db
		.insert(watchers)
		.values({ sourceId: null, issueId: issue.id, userId })
		.onConflictDoNothing();

	return { watchers: await loadWatchers(issue.id) };
}

export async function removeWatcher(
	actor: CurrentUser,
	key: string,
	userId: string,
) {
	await requireIssuePermissionFor(
		actor,
		key,
		userId === actor.id ? "BROWSE_PROJECTS" : "MANAGE_WATCHERS",
	);

	const [issue] = await db
		.select({ id: issues.id })
		.from(issues)
		.where(eq(issues.key, key.toUpperCase()))
		.limit(1);
	if (!issue) throw new HttpError(404, "Issue not found");

	await db
		.delete(watchers)
		.where(and(eq(watchers.issueId, issue.id), eq(watchers.userId, userId)));

	return { watchers: await loadWatchers(issue.id) };
}

export type LinkIssueInput = {
	typeId: string;
	targetKey: string;
	direction: "outward" | "inward";
};

export async function linkIssue(
	actor: CurrentUser,
	key: string,
	body: LinkIssueInput,
) {
	if (body.direction === "outward") {
		await requireIssuePermissionFor(actor, key, "LINK_ISSUES");
	} else {
		await requireIssuePermissionFor(actor, key, "BROWSE_PROJECTS");
	}

	const row = await loadIssueRow(key);
	if (!row) throw new HttpError(404, "Issue not found");

	const [type] = await db
		.select()
		.from(linkTypes)
		.where(eq(linkTypes.id, body.typeId))
		.limit(1);
	if (!type) throw new HttpError(400, "Unknown link type");

	const [target] = await db
		.select({ id: issues.id, key: issues.key })
		.from(issues)
		.where(eq(issues.key, body.targetKey.toUpperCase()))
		.limit(1);
	if (!target) throw new HttpError(400, "Unknown target issue");
	const targetContext = await issuePermissionContext(target.key);
	if (
		!targetContext ||
		!(await can(actor, "BROWSE_PROJECTS", targetContext.project, targetContext))
	) {
		throw new HttpError(400, "Unknown target issue");
	}
	if (target.id === row.id) {
		throw new HttpError(400, "An issue cannot link to itself");
	}
	if (body.direction === "inward") {
		await requireIssuePermissionFor(actor, target.key, "LINK_ISSUES");
	}

	const outward = body.direction === "outward";
	const [created] = await db
		.insert(issueLinks)
		.values({
			sourceId: `local:${randomUUID()}`,
			typeId: type.id,
			sourceIssueId: outward ? row.id : target.id,
			targetIssueId: outward ? target.id : row.id,
		})
		.returning();

	const refs = await loadIssueRefs(eq(issues.id, target.id));
	if (!refs[0]) throw new HttpError(400, "Unknown target issue");

	return {
		id: created.id,
		type: {
			id: type.id,
			name: type.name,
			inward: type.inward,
			outward: type.outward,
		},
		direction: body.direction,
		issue: refs[0],
	};
}

export async function deleteIssueLink(actor: CurrentUser, id: string) {
	const [link] = await db
		.select({
			id: issueLinks.id,
			sourceIssueId: issueLinks.sourceIssueId,
			targetIssueId: issueLinks.targetIssueId,
		})
		.from(issueLinks)
		.where(eq(issueLinks.id, id))
		.limit(1);
	if (!link) throw new HttpError(404, "Link not found");
	const sourceContext = await issuePermissionContext(link.sourceIssueId);
	const targetContext = await issuePermissionContext(link.targetIssueId);
	if (
		!sourceContext ||
		!targetContext ||
		!(await can(
			actor,
			"BROWSE_PROJECTS",
			sourceContext.project,
			sourceContext,
		)) ||
		!(await can(actor, "BROWSE_PROJECTS", targetContext.project, targetContext))
	) {
		throw new HttpError(404, "Link not found");
	}
	const canLinkEither =
		(await can(actor, "LINK_ISSUES", sourceContext.project, sourceContext)) ||
		(await can(actor, "LINK_ISSUES", targetContext.project, targetContext));
	if (!canLinkEither) {
		throw new HttpError(403, "You cannot edit either issue");
	}

	const [deleted] = await db
		.delete(issueLinks)
		.where(eq(issueLinks.id, id))
		.returning({ id: issueLinks.id });
	if (!deleted) throw new HttpError(404, "Link not found");
}
