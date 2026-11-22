import {
	type AnyColumn,
	and,
	eq,
	inArray,
	isNotNull,
	isNull,
	like,
	notInArray,
	notLike,
	or,
	sql,
} from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import {
	attachments,
	comments,
	components,
	fieldOptions,
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
	projectWorkflows,
	resolutions,
	slaImportedCycles,
	statuses,
	users,
	versions,
	watchers,
	workflowStatuses,
	workflows,
	workflowTransitions,
	worklogs,
} from "../lib/server/schema.ts";
import {
	type CustomFieldRoles,
	customFieldId,
	resolveCustomFieldRoles,
} from "../lib/shared/custom-field-roles.ts";
import { db } from "./db.ts";
import {
	type IssueMapping,
	mapComment,
	mapHistory,
	mapIssue,
	mapIssueLink,
	mapWorkflowLayout,
	mapWorklog,
	matchWorkflow,
	parseJiraDate,
	type WorkflowCandidate,
} from "./map.ts";
import {
	emptyServiceDeskMaps,
	importAutomationRules,
	importIssueSla,
	importServiceDesk,
	importSlaCalendars,
	mapRequestChannel,
	type ServiceDeskMaps,
} from "./servicedesk-import.ts";
import type {
	JiraDataset,
	JiraFieldOption,
	JiraIssueData,
	JiraProjectData,
	JiraStatus,
	JiraUser,
	JiraWorkflowData,
} from "./types.ts";
import {
	type Executor,
	emptyCounts,
	type ImportCounts,
	mergeCounts,
	upsertRows,
} from "./upsert.ts";

export interface WorkflowMatchStats {
	matched: number;
	ambiguous: number;
	unmatched: number;
}

export interface ImportResult {
	counts: ImportCounts;
	workflowMatches: WorkflowMatchStats;
	linksSkipped: number;
	/** Rows kept because they were changed locally, by table. */
	localChanges: Record<string, string[]>;
}

export interface ImportOptions {
	baseUrl: string;
	fullImport: boolean;
	skipAttachments?: boolean;
	/** Non-public Atlassian APIs are only read when this is on. */
	privateApis?: boolean;
	/** Deliberate reset: overwrite rows changed locally and clear their marker. */
	overwriteLocal?: boolean;
}

interface MetadataMaps {
	userIds: Map<string, string>;
	issueTypeIds: Map<string, string>;
	priorityIds: Map<string, string>;
	resolutionIds: Map<string, string>;
	statusIds: Map<string, string>;
	linkTypeIds: Map<string, string>;
	workflowIds: Map<string, string>;
	componentIds: Map<string, string>;
	versionIds: Map<string, string>;
	issueIdsByKey: Map<string, string>;
	serviceDesk: ServiceDeskMaps;
	customFields: CustomFieldRoles;
}

function userKey(user: JiraUser) {
	return user.key ?? user.name;
}

function statusCategory(status: JiraStatus) {
	switch (status.statusCategory?.key) {
		case "done":
			return "done" as const;
		case "indeterminate":
			return "indeterminate" as const;
		default:
			return "new" as const;
	}
}

function dedupe<T>(values: T[], key: (value: T) => string) {
	const map = new Map<string, T>();
	for (const value of values) map.set(key(value), value);
	return [...map.values()];
}

export function collectUsers(dataset: JiraDataset): JiraUser[] {
	const collected = new Map<string, JiraUser>();
	const add = (user: JiraUser | null | undefined) => {
		if (!user?.name) return;
		const existing = collected.get(user.name);
		if (!existing) {
			collected.set(user.name, user);
		} else if (!existing.key && user.key) {
			collected.set(user.name, { ...existing, key: user.key });
		}
	};

	for (const user of dataset.users) add(user);
	for (const project of dataset.projects) {
		add(project.project.lead);
		for (const component of project.components) add(component.lead);
	}
	for (const data of dataset.issues) {
		add(data.issue.fields.reporter);
		add(data.issue.fields.assignee);
		add(data.issue.fields.creator);
		for (const comment of data.comments) {
			add(comment.author);
			add(comment.updateAuthor);
		}
		for (const worklog of data.worklogs) add(worklog.author);
		for (const watcher of data.watchers) add(watcher);
		for (const history of data.histories) add(history.author);
		for (const attachment of data.attachments) add(attachment.author);
	}
	return [...collected.values()];
}

async function importUsers(tx: Executor, input: JiraUser[]) {
	const counts = emptyCounts();
	const ids = new Map<string, string>();
	const usersToImport = dedupe(input, (user) => user.name);
	const existing = await tx.select().from(users);
	const bySourceKey = new Map<string, (typeof existing)[number]>();
	const byUsername = new Map<string, (typeof existing)[number]>();
	for (const row of existing) {
		if (row.sourceKey) bySourceKey.set(row.sourceKey, row);
		byUsername.set(row.username, row);
	}

	const inserts: (typeof users.$inferInsert)[] = [];
	for (const user of usersToImport) {
		const sourceKey = user.key ?? null;
		const current =
			(sourceKey ? bySourceKey.get(sourceKey) : undefined) ??
			byUsername.get(user.name);

		const values = {
			sourceKey: sourceKey ?? current?.sourceKey ?? null,
			username: user.name,
			email: user.emailAddress ?? current?.email ?? null,
			displayName: user.displayName || user.name,
			avatarUrl: user.avatarUrls?.["48x48"] ?? current?.avatarUrl ?? null,
			active: user.active !== false && user.deleted !== true,
		};

		if (!current) {
			inserts.push(values);
			continue;
		}

		if (current.sourceKey && sourceKey && current.sourceKey !== sourceKey) {
			throw new Error(
				`User ${user.name} already has source key ${current.sourceKey}, cannot link ${sourceKey}`,
			);
		}

		ids.set(user.name, current.id);
		if (sourceKey) ids.set(sourceKey, current.id);
		const changed = (
			[
				"sourceKey",
				"username",
				"email",
				"displayName",
				"avatarUrl",
				"active",
			] as const
		).some((key) => current[key] !== values[key]);
		if (!changed) {
			counts.unchanged++;
			continue;
		}

		await tx
			.update(users)
			.set({ ...values, updatedAt: new Date() })
			.where(eq(users.id, current.id));
		counts.updated++;
	}

	if (inserts.length > 0) {
		for (let index = 0; index < inserts.length; index += 100) {
			const chunk = inserts.slice(index, index + 100);
			const returned = await tx
				.insert(users)
				.values(chunk)
				.returning({ id: users.id, username: users.username });
			for (const row of returned) {
				ids.set(row.username, row.id);
				const sourceKey = chunk.find(
					(value) => value.username === row.username,
				)?.sourceKey;
				if (sourceKey) ids.set(sourceKey, row.id);
			}
			counts.inserted += chunk.length;
		}
	}

	return { counts, ids };
}

function workflowStatusSets(workflowsData: JiraWorkflowData[]) {
	return workflowsData.map((workflow) => ({
		name: workflow.name,
		statusIds: new Set(
			mapWorkflowLayout(workflow.layout).statuses.map(
				(status) => status.statusId,
			),
		),
	}));
}

interface IssueReconcile {
	issueId: string;
	labels: string[];
	components: string[];
	fixVersions: string[];
	affectsVersions: string[];
	comments: string[];
	worklogs: string[];
	watchers: string[];
	attachments: string[];
	reconcileAttachments: boolean;
	overwriteLocal: boolean;
	history: string[];
	historyItems: string[];
	slaCycles: string[];
}

function emptyIssueReconcile(issueId: string): IssueReconcile {
	return {
		issueId,
		labels: [],
		components: [],
		fixVersions: [],
		affectsVersions: [],
		comments: [],
		worklogs: [],
		watchers: [],
		attachments: [],
		reconcileAttachments: true,
		overwriteLocal: false,
		history: [],
		historyItems: [],
		slaCycles: [],
	};
}

export async function deleteMissingRows(
	tx: Executor,
	table: PgTable,
	idColumn: AnyColumn,
	parentColumn: AnyColumn,
	parentId: string,
	incomingIds: string[],
	options: {
		importedOnly?: boolean;
		sourceIdColumn?: AnyColumn;
		/** Only rows whose source id starts with this prefix are considered imported. */
		sourceIdPrefix?: string;
		/** A row changed locally is never deleted. */
		localChangeColumn?: AnyColumn;
		overwriteLocal?: boolean;
	} = {},
) {
	const conditions = [eq(parentColumn, parentId)];
	if (options.importedOnly && options.sourceIdColumn) {
		conditions.push(
			isNotNull(options.sourceIdColumn),
			notLike(options.sourceIdColumn, "local:%"),
		);
	}
	if (options.sourceIdPrefix && options.sourceIdColumn) {
		conditions.push(like(options.sourceIdColumn, `${options.sourceIdPrefix}%`));
	}
	if (options.localChangeColumn && !options.overwriteLocal) {
		conditions.push(isNull(options.localChangeColumn));
	}
	if (incomingIds.length > 0) {
		conditions.push(notInArray(idColumn, incomingIds));
	}
	await tx.delete(table).where(and(...conditions));
}

async function reconcileIssueChildren(
	tx: Executor,
	ids: IssueReconcile,
	privateApis = false,
) {
	await deleteMissingRows(
		tx,
		issueLabels,
		issueLabels.id,
		issueLabels.issueId,
		ids.issueId,
		ids.labels,
		{ importedOnly: true, sourceIdColumn: issueLabels.sourceId },
	);
	await deleteMissingRows(
		tx,
		issueComponents,
		issueComponents.id,
		issueComponents.issueId,
		ids.issueId,
		ids.components,
		{ importedOnly: true, sourceIdColumn: issueComponents.sourceId },
	);
	await deleteMissingRows(
		tx,
		issueFixVersions,
		issueFixVersions.id,
		issueFixVersions.issueId,
		ids.issueId,
		ids.fixVersions,
		{ importedOnly: true, sourceIdColumn: issueFixVersions.sourceId },
	);
	await deleteMissingRows(
		tx,
		issueAffectsVersions,
		issueAffectsVersions.id,
		issueAffectsVersions.issueId,
		ids.issueId,
		ids.affectsVersions,
		{ importedOnly: true, sourceIdColumn: issueAffectsVersions.sourceId },
	);
	await deleteMissingRows(
		tx,
		comments,
		comments.id,
		comments.issueId,
		ids.issueId,
		ids.comments,
		{
			importedOnly: true,
			sourceIdColumn: comments.sourceId,
			localChangeColumn: comments.locallyChangedAt,
			overwriteLocal: ids.overwriteLocal,
		},
	);
	await deleteMissingRows(
		tx,
		worklogs,
		worklogs.id,
		worklogs.issueId,
		ids.issueId,
		ids.worklogs,
		{
			importedOnly: true,
			sourceIdColumn: worklogs.sourceId,
			localChangeColumn: worklogs.locallyChangedAt,
			overwriteLocal: ids.overwriteLocal,
		},
	);
	await deleteMissingRows(
		tx,
		watchers,
		watchers.id,
		watchers.issueId,
		ids.issueId,
		ids.watchers,
		{ importedOnly: true, sourceIdColumn: watchers.sourceId },
	);
	if (ids.reconcileAttachments) {
		await deleteMissingRows(
			tx,
			attachments,
			attachments.id,
			attachments.issueId,
			ids.issueId,
			ids.attachments,
			{ importedOnly: true, sourceIdColumn: attachments.sourceId },
		);
	}
	await deleteMissingRows(
		tx,
		issueHistory,
		issueHistory.id,
		issueHistory.issueId,
		ids.issueId,
		ids.history,
		{ importedOnly: true, sourceIdColumn: issueHistory.sourceId },
	);
	if (ids.history.length > 0) {
		const conditions = [inArray(issueHistoryItems.historyId, ids.history)];
		if (ids.historyItems.length > 0) {
			conditions.push(notInArray(issueHistoryItems.id, ids.historyItems));
		}
		await tx.delete(issueHistoryItems).where(and(...conditions));
	}
	if (privateApis) {
		await deleteMissingRows(
			tx,
			slaImportedCycles,
			slaImportedCycles.id,
			slaImportedCycles.issueId,
			ids.issueId,
			ids.slaCycles,
		);
	}
}

async function importGlobal(
	tx: Executor,
	dataset: JiraDataset,
	counts: ImportCounts,
): Promise<MetadataMaps> {
	const userResult = await importUsers(tx, collectUsers(dataset));
	mergeCounts(counts, "users", userResult.counts);

	const issueTypeResult = await upsertRows(
		tx,
		issueTypes,
		dedupe(dataset.issueTypes, (item) => item.id).map((item) => ({
			sourceId: item.id,
			name: item.name,
			description: item.description ?? null,
			subtask: item.subtask ?? false,
			iconUrl: item.iconUrl ?? null,
		})),
		(row) => String(row.sourceId),
	);
	mergeCounts(counts, "issue_types", issueTypeResult.counts);

	const priorityResult = await upsertRows(
		tx,
		priorities,
		dataset.priorities.map((item, sequence) => ({
			sourceId: item.id,
			name: item.name,
			sequence,
			iconColor: item.statusColor ?? null,
		})),
		(row) => String(row.sourceId),
	);
	mergeCounts(counts, "priorities", priorityResult.counts);

	const resolutionResult = await upsertRows(
		tx,
		resolutions,
		dataset.resolutions.map((item) => ({
			sourceId: item.id,
			name: item.name,
			description: item.description ?? null,
		})),
		(row) => String(row.sourceId),
	);
	mergeCounts(counts, "resolutions", resolutionResult.counts);

	const statusRows = new Map<
		string,
		{ sourceId: string; name: string; category: string }
	>();
	for (const status of dataset.statuses) {
		statusRows.set(status.id, {
			sourceId: status.id,
			name: status.name,
			category: statusCategory(status),
		});
	}
	for (const workflow of dataset.workflows) {
		for (const status of mapWorkflowLayout(workflow.layout).statuses) {
			if (!statusRows.has(status.statusId)) {
				statusRows.set(status.statusId, {
					sourceId: status.statusId,
					name: status.name,
					category: status.category,
				});
			}
		}
	}
	const statusResult = await upsertRows(
		tx,
		statuses,
		[...statusRows.values()],
		(row) => String(row.sourceId),
	);
	mergeCounts(counts, "statuses", statusResult.counts);

	const linkTypeResult = await upsertRows(
		tx,
		linkTypes,
		dataset.linkTypes.map((item) => ({
			sourceId: item.id,
			name: item.name,
			inward: item.inward,
			outward: item.outward,
		})),
		(row) => String(row.sourceId),
	);
	mergeCounts(counts, "link_types", linkTypeResult.counts);

	const customFieldRows = dataset.fields.filter(
		(field) => field.custom === true || field.id.startsWith("customfield_"),
	);
	const fieldResult = await upsertRows(
		tx,
		fields,
		customFieldRows.map((field) => ({
			sourceId: field.id,
			name: field.name,
			type: field.schema?.type ?? null,
			customKey: field.schema?.custom ?? null,
		})),
		(row) => String(row.sourceId),
	);
	mergeCounts(counts, "fields", fieldResult.counts);
	const customFields = resolveCustomFieldRoles(
		dataset.fields.map((field) => ({
			sourceId: field.id,
			name: field.name,
			type: field.schema?.type ?? null,
			customKey: field.schema?.custom ?? null,
		})),
	);

	const workflowResult = await upsertRows(
		tx,
		workflows,
		dataset.workflows.map((workflow) => ({
			sourceId: null,
			name: workflow.name,
			description: workflow.description ?? null,
		})),
		(row) => String(row.name),
	);
	mergeCounts(counts, "workflows", workflowResult.counts);

	const workflowStatusRows = new Map<
		string,
		{ sourceId: string; workflowId: string; statusId: string }
	>();
	const transitionRows = new Map<
		string,
		{
			sourceId: string;
			workflowId: string;
			name: string;
			fromStatusId: string | null;
			toStatusId: string;
			asksResolution: boolean;
			sequence: number;
		}
	>();
	for (const workflow of dataset.workflows) {
		const workflowId = workflowResult.ids.get(workflow.name);
		if (!workflowId)
			throw new Error(`Workflow ${workflow.name} was not imported`);
		const mapped = mapWorkflowLayout(workflow.layout);
		for (const status of mapped.statuses) {
			const statusId = statusResult.ids.get(status.statusId);
			if (!statusId) {
				throw new Error(
					`Status ${status.statusId} from workflow ${workflow.name} was not imported`,
				);
			}
			workflowStatusRows.set(`${workflowId}:${statusId}`, {
				sourceId: `jira:${workflowId}:status:${status.statusId}`,
				workflowId,
				statusId,
			});
		}
		for (const transition of mapped.transitions) {
			const fromStatusId = transition.fromStatusId
				? (statusResult.ids.get(transition.fromStatusId) ?? null)
				: null;
			const toStatusId = statusResult.ids.get(transition.toStatusId);
			if (!toStatusId) {
				throw new Error(
					`Transition ${transition.sourceId} targets unknown status ${transition.toStatusId}`,
				);
			}
			transitionRows.set(`${workflowId}:${transition.sourceId}`, {
				sourceId: transition.sourceId,
				workflowId,
				name: transition.name,
				fromStatusId,
				toStatusId,
				asksResolution: transition.asksResolution,
				sequence: transition.sequence,
			});
		}
	}

	const workflowStatusResult = await upsertRows(
		tx,
		workflowStatuses,
		[...workflowStatusRows.values()],
		(row) => `${row.workflowId}:${row.statusId}`,
	);
	mergeCounts(counts, "workflow_statuses", workflowStatusResult.counts);

	const transitionResult = await upsertRows(
		tx,
		workflowTransitions,
		[...transitionRows.values()],
		(row) => `${row.workflowId}:${row.sourceId}`,
	);
	mergeCounts(counts, "workflow_transitions", transitionResult.counts);

	for (const workflow of dataset.workflows) {
		const workflowId = workflowResult.ids.get(workflow.name);
		if (!workflowId) continue;
		const prefix = `${workflowId}:`;
		const statusIds = [...workflowStatusResult.ids.entries()]
			.filter(([key]) => key.startsWith(prefix))
			.map(([, id]) => id);
		await deleteMissingRows(
			tx,
			workflowStatuses,
			workflowStatuses.id,
			workflowStatuses.workflowId,
			workflowId,
			statusIds,
			{ importedOnly: true, sourceIdColumn: workflowStatuses.sourceId },
		);
		const transitionIds = [...transitionResult.ids.entries()]
			.filter(([key]) => key.startsWith(prefix))
			.map(([, id]) => id);
		await deleteMissingRows(
			tx,
			workflowTransitions,
			workflowTransitions.id,
			workflowTransitions.workflowId,
			workflowId,
			transitionIds,
			{ importedOnly: true, sourceIdColumn: workflowTransitions.sourceId },
		);
	}

	await importFieldOptions(tx, dataset.fieldOptions, fieldResult.ids, counts);

	const serviceDesk = emptyServiceDeskMaps();
	serviceDesk.customerRequestTypeFieldId =
		dataset.fields.find((field) => field.name === "Customer Request Type")
			?.id ?? null;
	serviceDesk.calendarIds = await importSlaCalendars(
		tx,
		dataset.slaCalendars ?? [],
		counts,
	);

	return {
		userIds: userResult.ids,
		issueTypeIds: issueTypeResult.ids,
		priorityIds: priorityResult.ids,
		resolutionIds: resolutionResult.ids,
		statusIds: statusResult.ids,
		linkTypeIds: linkTypeResult.ids,
		workflowIds: workflowResult.ids,
		componentIds: new Map(),
		versionIds: new Map(),
		issueIdsByKey: new Map(),
		serviceDesk,
		customFields,
	};
}

async function importFieldOptionLevel(
	tx: Executor,
	fieldId: string,
	options: JiraFieldOption[],
	parentOptionId: string | null,
	counts: ImportCounts,
): Promise<void> {
	const rows = options.map((option, sequence) => ({
		sourceId: option.id,
		fieldId,
		value: option.value,
		parentOptionId,
		sequence,
		disabled: option.disabled ?? false,
	}));
	const result = await upsertRows(
		tx,
		fieldOptions,
		rows,
		(row) => `${row.fieldId}:${row.sourceId}`,
	);
	mergeCounts(counts, "field_options", result.counts);

	for (const option of options) {
		if (!option.children || option.children.length === 0) continue;
		const optionId = result.ids.get(`${fieldId}:${option.id}`);
		if (!optionId) {
			throw new Error(`Field option ${option.id} was not imported`);
		}
		await importFieldOptionLevel(
			tx,
			fieldId,
			option.children,
			optionId,
			counts,
		);
	}
}

async function importFieldOptions(
	tx: Executor,
	groups: JiraDataset["fieldOptions"],
	fieldIds: Map<string, string>,
	counts: ImportCounts,
) {
	for (const group of groups) {
		const fieldId = fieldIds.get(group.fieldId);
		if (!fieldId) continue;
		await importFieldOptionLevel(tx, fieldId, group.options, null, counts);
	}
}

function maxIssueNumber(data: JiraIssueData[]) {
	let max = 0;
	for (const item of data) {
		const number = Number(
			item.issue.key.slice(item.issue.key.lastIndexOf("-") + 1),
		);
		if (Number.isFinite(number) && number > max) max = number;
	}
	return max;
}

async function importProject(
	tx: Executor,
	projectData: JiraProjectData,
	projectIssues: JiraIssueData[],
	dataset: JiraDataset,
	maps: MetadataMaps,
	counts: ImportCounts,
	workflowMatches: WorkflowMatchStats,
	baseUrl: string,
	skipAttachments: boolean,
	options: ImportOptions,
	localChanges: Record<string, string[]>,
) {
	const missingTypes = projectData.issueTypes.filter(
		(issueType) => !maps.issueTypeIds.has(issueType.id),
	);
	if (missingTypes.length > 0) {
		const result = await upsertRows(
			tx,
			issueTypes,
			missingTypes.map((issueType) => ({
				sourceId: issueType.id,
				name: issueType.name,
				description: issueType.description ?? null,
				subtask: issueType.subtask ?? false,
				iconUrl: issueType.iconUrl ?? null,
			})),
			(row) => String(row.sourceId),
		);
		mergeCounts(counts, "issue_types", result.counts);
		for (const [key, id] of result.ids) maps.issueTypeIds.set(key, id);
	}

	const project = projectData.project;
	const leadId = project.lead
		? (maps.userIds.get(userKey(project.lead)) ?? null)
		: null;
	const projectResult = await upsertRows(
		tx,
		projects,
		[
			{
				sourceId: project.id,
				key: project.key,
				name: project.name,
				description: project.description ?? null,
				leadId,
				projectType:
					project.projectTypeKey === "service_desk"
						? "service_desk"
						: "software",
				avatarUrl: project.avatarUrls?.["48x48"] ?? null,
				categoryName: project.projectCategory?.name ?? null,
				archived: project.archived ?? false,
				lastIssueNumber: maxIssueNumber(projectIssues),
			},
		],
		(row) => String(row.sourceId),
		{ advanceKeys: ["lastIssueNumber"] },
	);
	mergeCounts(counts, "projects", projectResult.counts);
	const projectId = projectResult.ids.get(project.id);
	if (!projectId) throw new Error(`Project ${project.key} was not imported`);
	maps.serviceDesk.projectSourceIds.set(project.id, projectId);

	const serviceDeskData = dataset.serviceDesks?.find(
		(desk) => desk.desk.projectKey === project.key,
	);
	if (serviceDeskData) {
		await importServiceDesk(
			tx,
			serviceDeskData,
			{
				projectId,
				projectKey: project.key,
				issues: projectIssues,
				maps: {
					issueTypeIds: maps.issueTypeIds,
					calendarIds: maps.serviceDesk.calendarIds,
				},
				serviceDeskMaps: maps.serviceDesk,
			},
			counts,
		);
	}

	const projectIssueTypesToImport = dedupe(
		projectData.issueTypes,
		(issueType) => issueType.id,
	);
	const projectIssueTypeRows = projectIssueTypesToImport.map((issueType) => {
		const issueTypeId = maps.issueTypeIds.get(issueType.id);
		if (!issueTypeId) {
			throw new Error(
				`Project ${project.key}: issue type ${issueType.name} was not imported`,
			);
		}
		return {
			sourceId: `jira:${project.id}:issueType:${issueType.id}`,
			projectId,
			issueTypeId,
		};
	});
	const projectIssueTypeResult = await upsertRows(
		tx,
		projectIssueTypes,
		projectIssueTypeRows,
		(row) => `${row.projectId}:${row.issueTypeId}`,
	);
	mergeCounts(counts, "project_issue_types", projectIssueTypeResult.counts);
	await deleteMissingRows(
		tx,
		projectIssueTypes,
		projectIssueTypes.id,
		projectIssueTypes.projectId,
		projectId,
		[...projectIssueTypeResult.ids.values()],
		{ importedOnly: true, sourceIdColumn: projectIssueTypes.sourceId },
	);

	const componentResult = await upsertRows(
		tx,
		components,
		projectData.components.map((component) => ({
			sourceId: component.id,
			projectId,
			name: component.name,
			description: component.description ?? null,
			leadId: component.lead
				? (maps.userIds.get(userKey(component.lead)) ?? null)
				: null,
		})),
		(row) => String(row.sourceId),
	);
	mergeCounts(counts, "components", componentResult.counts);
	for (const [key, id] of componentResult.ids) maps.componentIds.set(key, id);

	const versionResult = await upsertRows(
		tx,
		versions,
		projectData.versions.map((version, sequence) => ({
			sourceId: version.id,
			projectId,
			name: version.name,
			description: version.description ?? null,
			startDate: version.startDate ?? null,
			releaseDate: version.releaseDate ?? null,
			released: version.released ?? false,
			archived: version.archived ?? false,
			sequence,
		})),
		(row) => String(row.sourceId),
	);
	mergeCounts(counts, "versions", versionResult.counts);
	for (const [key, id] of versionResult.ids) maps.versionIds.set(key, id);

	const candidates: WorkflowCandidate[] = workflowStatusSets(dataset.workflows);
	const matched = new Map<string, { name: string; ambiguous: boolean }>();
	for (const issueType of projectIssueTypesToImport) {
		const statusIds =
			projectData.statusesByIssueType
				.find((item) => item.id === issueType.id)
				?.statuses.map((status) => status.id) ?? [];
		if (statusIds.length === 0) {
			workflowMatches.unmatched++;
			continue;
		}
		const match = matchWorkflow(
			project.key,
			project.name,
			statusIds,
			candidates,
		);
		if (!match) {
			workflowMatches.unmatched++;
			continue;
		}
		workflowMatches.matched++;
		if (match.ambiguous) workflowMatches.ambiguous++;
		matched.set(issueType.id, match);
	}

	const workflowRows: {
		sourceId: string;
		projectId: string;
		issueTypeId: string | null;
		workflowId: string;
	}[] = [];
	const uniqueWorkflows = new Set(
		[...matched.values()].map((match) => match.name),
	);
	if (
		matched.size === projectIssueTypesToImport.length &&
		uniqueWorkflows.size === 1
	) {
		const workflowId = maps.workflowIds.get([...uniqueWorkflows][0]);
		if (workflowId) {
			workflowRows.push({
				sourceId: `jira:${project.id}:workflow:default`,
				projectId,
				issueTypeId: null,
				workflowId,
			});
		}
	} else {
		for (const [issueTypeId, match] of matched) {
			const workflowId = maps.workflowIds.get(match.name);
			if (!workflowId) continue;
			workflowRows.push({
				sourceId: `jira:${project.id}:workflow:${issueTypeId}`,
				projectId,
				issueTypeId: maps.issueTypeIds.get(issueTypeId) ?? null,
				workflowId,
			});
		}
	}
	const projectWorkflowResult = await upsertRows(
		tx,
		projectWorkflows,
		workflowRows,
		(row) => `${row.projectId}:${row.issueTypeId ?? "default"}`,
	);
	mergeCounts(counts, "project_workflows", projectWorkflowResult.counts);
	await deleteMissingRows(
		tx,
		projectWorkflows,
		projectWorkflows.id,
		projectWorkflows.projectId,
		projectId,
		[...projectWorkflowResult.ids.values()],
		{ importedOnly: true, sourceIdColumn: projectWorkflows.sourceId },
	);

	const sourceIds = projectIssues.map((data) => data.issue.id);
	const marked = options.overwriteLocal
		? []
		: await tx
				.select({ id: issues.id, sourceId: issues.sourceId })
				.from(issues)
				.where(
					and(
						inArray(issues.sourceId, sourceIds),
						isNotNull(issues.locallyChangedAt),
					),
				);
	const markedIds = new Map(marked.map((row) => [row.sourceId, row.id]));
	const reconciles: IssueReconcile[] = [];
	for (const data of projectIssues) {
		const kept = markedIds.get(data.issue.id);
		if (kept) {
			maps.issueIdsByKey.set(data.issue.key, kept);
			localChanges.issues ??= [];
			localChanges.issues.push(kept);
			continue;
		}
		const reconcile = await importIssue(
			tx,
			data,
			projectId,
			maps,
			counts,
			baseUrl,
			skipAttachments,
			options,
		);
		if (!reconcile) {
			const [keptRow] = await tx
				.select({ id: issues.id })
				.from(issues)
				.where(eq(issues.sourceId, data.issue.id));
			if (keptRow) {
				maps.issueIdsByKey.set(data.issue.key, keptRow.id);
				localChanges.issues ??= [];
				localChanges.issues.push(keptRow.id);
			}
			continue;
		}
		reconciles.push(reconcile);
	}
	for (const ids of reconciles) {
		await reconcileIssueChildren(tx, ids, options.privateApis === true);
	}
}

async function importIssue(
	tx: Executor,
	data: JiraIssueData,
	projectId: string,
	maps: MetadataMaps,
	counts: ImportCounts,
	baseUrl: string,
	skipAttachments: boolean,
	options: ImportOptions,
): Promise<IssueReconcile | null> {
	const issue = data.issue;
	const fields = issue.fields;
	const issueTypeId = maps.issueTypeIds.get(fields.issuetype.id);
	const statusId = maps.statusIds.get(fields.status.id);
	if (!issueTypeId) {
		throw new Error(
			`${issue.key}: issue type ${fields.issuetype.id} was not imported`,
		);
	}
	if (!statusId) {
		throw new Error(
			`${issue.key}: status ${fields.status.id} was not imported`,
		);
	}

	const mapping: IssueMapping = mapIssue(issue, {
		baseUrl,
		projectId,
		issueTypeId,
		statusId,
		priorityId: fields.priority
			? (maps.priorityIds.get(fields.priority.id) ?? null)
			: null,
		resolutionId: fields.resolution
			? (maps.resolutionIds.get(fields.resolution.id) ?? null)
			: null,
		userIds: maps.userIds,
		issueIds: maps.issueIdsByKey,
		requestTypeIds: maps.serviceDesk.requestTypeIds,
		customerRequestTypeFieldId: maps.serviceDesk.customerRequestTypeFieldId,
		requestChannel: mapRequestChannel(data.channel),
		customFields: maps.customFields,
	});

	const issueResult = await upsertRows(
		tx,
		issues,
		[mapping.row],
		(row) => String(row.sourceId),
		{
			preserveNullKeys: ["parentId", "epicId"],
			localChangeColumn: issues.locallyChangedAt,
			overwriteLocal: options.overwriteLocal,
		},
	);
	mergeCounts(counts, "issues", issueResult.counts);
	const issueId = issueResult.ids.get(issue.id);
	if (!issueId) throw new Error(`${issue.key}: issue was not imported`);
	if (issueResult.keptLocalIds.length > 0) return null;
	maps.issueIdsByKey.set(issue.key, issueId);
	const reconcile = emptyIssueReconcile(issueId);
	reconcile.overwriteLocal = options.overwriteLocal ?? false;
	reconcile.reconcileAttachments = !skipAttachments;

	const labelResult = await upsertRows(
		tx,
		issueLabels,
		mapping.labels.map((label) => ({
			sourceId: `jira:${issue.id}:label:${label}`,
			issueId,
			label,
		})),
		(row) => `${row.issueId}:${row.label}`,
	);
	mergeCounts(counts, "issue_labels", labelResult.counts);
	reconcile.labels.push(...labelResult.ids.values());

	const componentRows = mapping.componentSourceIds.map((sourceId) => {
		const componentId = maps.componentIds.get(sourceId);
		if (!componentId) {
			throw new Error(`${issue.key}: component ${sourceId} was not imported`);
		}
		return {
			sourceId: `jira:${issue.id}:component:${sourceId}`,
			issueId,
			componentId,
		};
	});
	const componentResult = await upsertRows(
		tx,
		issueComponents,
		componentRows,
		(row) => `${row.issueId}:${row.componentId}`,
	);
	mergeCounts(counts, "issue_components", componentResult.counts);
	reconcile.components.push(...componentResult.ids.values());

	const fixVersionRows = mapping.fixVersionSourceIds.map((sourceId) => {
		const versionId = maps.versionIds.get(sourceId);
		if (!versionId) {
			throw new Error(`${issue.key}: fix version ${sourceId} was not imported`);
		}
		return {
			sourceId: `jira:${issue.id}:fixVersion:${sourceId}`,
			issueId,
			versionId,
		};
	});
	const fixVersionResult = await upsertRows(
		tx,
		issueFixVersions,
		fixVersionRows,
		(row) => `${row.issueId}:${row.versionId}`,
	);
	mergeCounts(counts, "issue_fix_versions", fixVersionResult.counts);
	reconcile.fixVersions.push(...fixVersionResult.ids.values());

	const affectsVersionRows = mapping.affectsVersionSourceIds.map((sourceId) => {
		const versionId = maps.versionIds.get(sourceId);
		if (!versionId) {
			throw new Error(
				`${issue.key}: affects version ${sourceId} was not imported`,
			);
		}
		return {
			sourceId: `jira:${issue.id}:affectsVersion:${sourceId}`,
			issueId,
			versionId,
		};
	});
	const affectsVersionResult = await upsertRows(
		tx,
		issueAffectsVersions,
		affectsVersionRows,
		(row) => `${row.issueId}:${row.versionId}`,
	);
	mergeCounts(counts, "issue_affects_versions", affectsVersionResult.counts);
	reconcile.affectsVersions.push(...affectsVersionResult.ids.values());

	const commentResult = await upsertRows(
		tx,
		comments,
		data.comments.map((comment) =>
			mapComment(comment, issueId, { baseUrl, userIds: maps.userIds }),
		),
		(row) => String(row.sourceId),
	);
	mergeCounts(counts, "comments", commentResult.counts);
	reconcile.comments.push(...commentResult.ids.values());

	const worklogResult = await upsertRows(
		tx,
		worklogs,
		data.worklogs.map((worklog) =>
			mapWorklog(worklog, issueId, { userIds: maps.userIds }),
		),
		(row) => String(row.sourceId),
		{
			localChangeColumn: worklogs.locallyChangedAt,
			overwriteLocal: options.overwriteLocal,
		},
	);
	mergeCounts(counts, "worklogs", worklogResult.counts);
	reconcile.worklogs.push(...worklogResult.ids.values());

	const watcherRows = data.watchers.map((watcher) => {
		const userId = maps.userIds.get(userKey(watcher));
		if (!userId) {
			throw new Error(`${issue.key}: watcher ${watcher.name} was not imported`);
		}
		return {
			sourceId: `jira:${issue.id}:watcher:${userKey(watcher)}`,
			issueId,
			userId,
		};
	});
	const watcherResult = await upsertRows(
		tx,
		watchers,
		watcherRows,
		(row) => `${row.issueId}:${row.userId}`,
	);
	mergeCounts(counts, "watchers", watcherResult.counts);
	reconcile.watchers.push(...watcherResult.ids.values());

	const attachmentResult = await upsertRows(
		tx,
		attachments,
		data.attachments.map((attachment) => ({
			sourceId: attachment.id,
			issueId,
			fileName: attachment.filename,
			mimeType: attachment.mimeType ?? null,
			size: attachment.size ?? 0,
			authorId: attachment.author
				? (maps.userIds.get(userKey(attachment.author)) ?? null)
				: null,
			created: parseJiraDate(attachment.created),
			storagePath: attachment.storagePath,
			sha256: attachment.sha256,
		})),
		(row) => String(row.sourceId),
	);
	mergeCounts(counts, "attachments", attachmentResult.counts);
	reconcile.attachments.push(...attachmentResult.ids.values());

	const historyMappings = data.histories.map((history) =>
		mapHistory(history, issueId, { userIds: maps.userIds }),
	);
	const historyResult = await upsertRows(
		tx,
		issueHistory,
		historyMappings.map((history) => history.row),
		(row) => String(row.sourceId),
	);
	mergeCounts(counts, "issue_history", historyResult.counts);
	reconcile.history.push(...historyResult.ids.values());

	const historyItemRows = historyMappings.flatMap((history) => {
		const historyId = historyResult.ids.get(String(history.row.sourceId));
		if (!historyId) {
			throw new Error(
				`${issue.key}: history ${history.row.sourceId} was not imported`,
			);
		}
		return history.items.map((item) => ({ ...item, historyId }));
	});
	const historyItemResult = await upsertRows(
		tx,
		issueHistoryItems,
		historyItemRows,
		(row) => `${row.historyId}:${row.sequence}`,
	);
	mergeCounts(counts, "issue_history_items", historyItemResult.counts);
	reconcile.historyItems.push(...historyItemResult.ids.values());

	reconcile.slaCycles.push(
		...(await importIssueSla(
			tx,
			data,
			issueId,
			fields.project.key,
			maps.serviceDesk,
			counts,
		)),
	);
	return reconcile;
}

async function finalize(
	tx: Executor,
	dataset: JiraDataset,
	maps: MetadataMaps,
	counts: ImportCounts,
	options: ImportOptions,
) {
	const issueRows = await tx
		.select({
			id: issues.id,
			key: issues.key,
			sourceId: issues.sourceId,
			parentId: issues.parentId,
			epicId: issues.epicId,
			locallyChangedAt: issues.locallyChangedAt,
		})
		.from(issues);
	const byKey = new Map(issueRows.map((row) => [row.key, row]));
	const bySource = new Map(issueRows.map((row) => [row.sourceId, row]));
	const keptIds = new Set(
		options.overwriteLocal
			? []
			: issueRows.filter((row) => row.locallyChangedAt).map((row) => row.id),
	);

	let referenceUpdates = 0;
	const epicLinkId = customFieldId(maps.customFields, "epicLink");
	for (const data of dataset.issues) {
		const current = bySource.get(data.issue.id);
		if (!current || keptIds.has(current.id)) continue;
		const parentKey = data.issue.fields.parent?.key ?? null;
		const epicValue = epicLinkId
			? data.issue.fields[epicLinkId as `customfield_${string}`]
			: undefined;
		const epicKey = typeof epicValue === "string" ? epicValue : null;
		const parentId = parentKey
			? (byKey.get(parentKey)?.id ?? current.parentId)
			: null;
		const epicId = epicKey ? (byKey.get(epicKey)?.id ?? current.epicId) : null;
		if (parentId === current.parentId && epicId === current.epicId) continue;

		await tx
			.update(issues)
			.set({
				parentId,
				epicId,
				updatedAt: new Date(),
				locallyChangedAt: sql`'epoch'::timestamptz`,
			})
			.where(eq(issues.id, current.id));
		referenceUpdates++;
	}
	counts.issues = counts.issues ?? emptyCounts();
	counts.issues.updated += referenceUpdates;

	const links = new Map<
		string,
		{
			sourceId: string;
			typeSourceId: string;
			sourceKey: string;
			targetKey: string;
		}
	>();
	for (const data of dataset.issues) {
		for (const rawLink of data.issue.fields.issuelinks ?? []) {
			const link = mapIssueLink(data.issue.key, rawLink);
			const existing = links.get(link.sourceId);
			if (
				existing &&
				(existing.sourceKey !== link.sourceKey ||
					existing.targetKey !== link.targetKey ||
					existing.typeSourceId !== link.typeSourceId)
			) {
				throw new Error(
					`${data.issue.key}: issue link ${link.sourceId} appears twice with different directions`,
				);
			}
			links.set(link.sourceId, link);
		}
	}

	let linksSkipped = 0;
	const linkRows = [];
	for (const link of links.values()) {
		const typeId = maps.linkTypeIds.get(link.typeSourceId);
		const sourceIssueId = maps.issueIdsByKey.get(link.sourceKey);
		const targetIssueId = maps.issueIdsByKey.get(link.targetKey);
		if (!typeId) {
			throw new Error(
				`${link.sourceKey}: link type ${link.typeSourceId} was not imported`,
			);
		}
		if (
			(sourceIssueId && keptIds.has(sourceIssueId)) ||
			(targetIssueId && keptIds.has(targetIssueId))
		) {
			continue;
		}
		if (!sourceIssueId || !targetIssueId) {
			if (options.fullImport) {
				throw new Error(
					`${link.sourceKey}: link target ${link.targetKey} was not imported`,
				);
			}
			linksSkipped++;
			continue;
		}
		linkRows.push({
			sourceId: link.sourceId,
			typeId,
			sourceIssueId,
			targetIssueId,
		});
	}

	const linkResult = await upsertRows(
		tx,
		issueLinks,
		linkRows,
		(row) => String(row.sourceId),
		{
			localChangeColumn: issueLinks.locallyChangedAt,
			overwriteLocal: options.overwriteLocal,
		},
	);
	mergeCounts(counts, "issue_links", linkResult.counts);

	const importedIssueIds = dataset.issues
		.map((data) => maps.issueIdsByKey.get(data.issue.key))
		.filter((id): id is string => id !== undefined);
	if (importedIssueIds.length > 0) {
		const conditions = [
			or(
				inArray(issueLinks.sourceIssueId, importedIssueIds),
				inArray(issueLinks.targetIssueId, importedIssueIds),
			),
			isNotNull(issueLinks.sourceId),
			notLike(issueLinks.sourceId, "local:%"),
		];
		if (!options.overwriteLocal) {
			conditions.push(isNull(issueLinks.locallyChangedAt));
		}
		if (keptIds.size > 0) {
			conditions.push(
				notInArray(issueLinks.sourceIssueId, [...keptIds]),
				notInArray(issueLinks.targetIssueId, [...keptIds]),
			);
		}
		const incomingLinkIds = [...links.keys()];
		if (incomingLinkIds.length > 0) {
			conditions.push(notInArray(issueLinks.sourceId, incomingLinkIds));
		}
		await tx.delete(issueLinks).where(and(...conditions));
	}

	await importAutomationRules(
		tx,
		dataset.automationRules ?? [],
		{
			projectSourceIds: maps.serviceDesk.projectSourceIds,
			deskIds: maps.serviceDesk.deskIds,
		},
		counts,
	);

	return { linksSkipped };
}

export async function loadAttachmentIndex() {
	const rows = await db
		.select({
			sourceId: attachments.sourceId,
			storagePath: attachments.storagePath,
			sha256: attachments.sha256,
			size: attachments.size,
		})
		.from(attachments);
	return new Map(
		rows.map((row) => [
			row.sourceId,
			{
				storagePath: row.storagePath,
				sha256: row.sha256,
				size: row.size,
			},
		]),
	);
}

export async function importDataset(
	dataset: JiraDataset,
	options: ImportOptions,
): Promise<ImportResult> {
	const counts: ImportCounts = {};
	const workflowMatches: WorkflowMatchStats = {
		matched: 0,
		ambiguous: 0,
		unmatched: 0,
	};

	const localChanges: Record<string, string[]> = {};
	const maps = await db.transaction(async (tx) => {
		await tx.execute(sql`select set_config('rvna.importer', 'on', true)`);
		return importGlobal(tx as Executor, dataset, counts);
	});

	const projectKeys = new Set(
		dataset.projects.map((project) => project.project.key),
	);
	const issuesByProject = new Map<string, JiraIssueData[]>();
	for (const data of dataset.issues) {
		const key = data.issue.fields.project.key;
		if (!projectKeys.has(key)) {
			throw new Error(
				`${data.issue.key}: project ${key} was not selected for import`,
			);
		}
		const list = issuesByProject.get(key) ?? [];
		list.push(data);
		issuesByProject.set(key, list);
	}

	for (const projectData of dataset.projects) {
		const projectIssues = (
			issuesByProject.get(projectData.project.key) ?? []
		).sort(
			(left, right) =>
				Number(left.issue.key.slice(left.issue.key.lastIndexOf("-") + 1)) -
				Number(right.issue.key.slice(right.issue.key.lastIndexOf("-") + 1)),
		);
		await db.transaction(async (tx) => {
			await tx.execute(sql`select set_config('rvna.importer', 'on', true)`);
			await importProject(
				tx as Executor,
				projectData,
				projectIssues,
				dataset,
				maps,
				counts,
				workflowMatches,
				options.baseUrl,
				options.skipAttachments ?? false,
				options,
				localChanges,
			);
		});
	}

	const { linksSkipped } = await db.transaction(async (tx) => {
		await tx.execute(sql`select set_config('rvna.importer', 'on', true)`);
		return finalize(tx as Executor, dataset, maps, counts, options);
	});

	return { counts, workflowMatches, linksSkipped, localChanges };
}
