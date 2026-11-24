import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pageGuard, pathSegment } from "./client.ts";
import { type JiraClient, JiraRequestError } from "./jira.ts";
import { type PrivateApiOptions, skipPrivateApi } from "./private-apis.ts";
import {
	defaultWorkingCalendar,
	fetchAutomationRules,
	fetchRequestChannel,
	fetchRequestSla,
	fetchServiceDesks,
	fetchSlaCalendars,
} from "./servicedesk.ts";
import type {
	ImportedAttachment,
	JiraAutomationRule,
	JiraCreateMetaField,
	JiraDataset,
	JiraField,
	JiraFieldOption,
	JiraFieldOptions,
	JiraIssue,
	JiraIssueData,
	JiraIssueType,
	JiraLinkType,
	JiraPriority,
	JiraProject,
	JiraProjectData,
	JiraProjectDetail,
	JiraProjectStatuses,
	JiraResolution,
	JiraScreenField,
	JiraScreenTab,
	JiraStatus,
	JiraUser,
	JiraWorkflow,
	JiraWorkflowData,
	JiraWorkflowLayout,
	JiraWorkingCalendar,
} from "./types.ts";

const pageSize = 100;
const issuePageSize = 50;

function lastPage(
	collected: number,
	total: number | undefined,
	received: number,
	size: number,
) {
	if (received === 0) return true;
	if (total !== undefined) return collected >= total;
	return received < size;
}

export interface ExistingAttachment {
	storagePath: string;
	sha256: string;
	size: number;
}

export interface FetchOptions extends PrivateApiOptions {
	attachmentsDir: string;
	skipAttachments: boolean;
	projectKeys?: string[];
	existingAttachments?: Map<string, ExistingAttachment>;
}

function withIssueKey(key: string, error: unknown): Error {
	const message = error instanceof Error ? error.message : String(error);
	if (message.startsWith(`${key}:`)) return error as Error;
	return new Error(`${key}: ${message}`, { cause: error });
}

async function fetchUsers(client: JiraClient): Promise<JiraUser[]> {
	const users: JiraUser[] = [];
	const guard = pageGuard("/rest/api/2/user/search");
	let startAt = 0;
	for (;;) {
		const page = await client.getJson<JiraUser[]>("/rest/api/2/user/search", {
			username: ".",
			includeInactive: "true",
			startAt,
			maxResults: pageSize,
		});
		guard(page.map((user) => user.key ?? user.name));
		users.push(...page);
		if (page.length < pageSize) break;
		startAt += page.length;
	}
	return users;
}

async function fetchScreenHasResolution(
	client: JiraClient,
	screenId: number,
): Promise<boolean> {
	const tabs = await client.getJson<JiraScreenTab[]>(
		`/rest/api/2/screens/${screenId}/tabs`,
	);
	for (const tab of tabs) {
		const fields = await client.getJson<JiraScreenField[]>(
			`/rest/api/2/screens/${screenId}/tabs/${tab.id}/fields`,
		);
		if (fields.some((field) => field.id === "resolution")) return true;
	}
	return false;
}

async function fetchResolutionScreens(
	client: JiraClient,
	workflows: JiraWorkflowData[],
): Promise<Map<number, boolean>> {
	const screenIds = new Set<number>();
	for (const workflow of workflows) {
		for (const transition of workflow.layout.transitions ?? []) {
			if (typeof transition.screenId === "number") {
				screenIds.add(transition.screenId);
			}
		}
	}
	const entries = await Promise.all(
		[...screenIds].map(async (screenId) => {
			try {
				return [
					screenId,
					await fetchScreenHasResolution(client, screenId),
				] as const;
			} catch (error) {
				if (
					error instanceof JiraRequestError &&
					(error.status === 403 || error.status === 404)
				) {
					console.warn(
						`Skipping transition screen ${screenId}: request answered ${error.status}`,
					);
					return [screenId, false] as const;
				}
				throw error;
			}
		}),
	);
	return new Map(entries);
}

export async function fetchWorkflows(
	client: JiraClient,
	options: PrivateApiOptions = {},
): Promise<JiraWorkflowData[]> {
	if (skipPrivateApi(options, "workflow layouts")) return [];
	const workflows = await client.getJson<JiraWorkflow[]>(
		"/rest/api/2/workflow",
	);
	const withLayouts = await Promise.all(
		workflows.map(async (workflow) => {
			const layout = await client.getJson<Partial<JiraWorkflowLayout> | null>(
				"/rest/workflowDesigner/1.0/workflows",
				{ name: workflow.name },
			);
			return {
				...workflow,
				layout: {
					statuses: layout?.layout?.statuses ?? [],
					transitions: layout?.layout?.transitions ?? [],
				},
			};
		}),
	);
	const resolutionScreens = await fetchResolutionScreens(client, withLayouts);
	for (const workflow of withLayouts) {
		for (const transition of workflow.layout.transitions ?? []) {
			transition.hasResolutionField =
				typeof transition.screenId === "number" &&
				resolutionScreens.get(transition.screenId) === true;
		}
	}
	return withLayouts;
}

async function fetchProjects(
	client: JiraClient,
	projectKeys?: string[],
): Promise<JiraProjectData[]> {
	const projects = await client.getJson<JiraProject[]>("/rest/api/2/project", {
		expand: "description,lead",
	});
	const wanted = projectKeys
		? new Set(projectKeys.map((key) => key.toUpperCase()))
		: undefined;
	const selected = wanted
		? projects.filter((project) => wanted.has(project.key.toUpperCase()))
		: projects;

	return Promise.all(
		selected.map(async (listed) => {
			const [detail, components, versions, statusesByIssueType] =
				await Promise.all([
					client.getJson<JiraProjectDetail>(
						`/rest/api/2/project/${encodeURIComponent(listed.key)}`,
					),
					client.getJson<JiraProjectData["components"]>(
						`/rest/api/2/project/${encodeURIComponent(listed.key)}/components`,
					),
					client.getJson<JiraProjectData["versions"]>(
						`/rest/api/2/project/${encodeURIComponent(listed.key)}/versions`,
					),
					client.getJson<JiraProjectStatuses[]>(
						`/rest/api/2/project/${encodeURIComponent(listed.key)}/statuses`,
					),
				]);

			return {
				project: {
					...detail,
					projectCategory: detail.projectCategory ?? listed.projectCategory,
				},
				issueTypes: detail.issueTypes ?? [],
				components,
				versions,
				statusesByIssueType,
			};
		}),
	);
}

function addOption(
	options: Map<string, JiraFieldOption>,
	childIds: Set<string>,
	option: JiraFieldOption,
) {
	const existing = options.get(option.id);
	if (existing) {
		if (option.children && option.children.length > 0) {
			existing.children = mergeOptions(
				existing.children ?? [],
				option.children,
			);
		}
	} else {
		options.set(option.id, {
			...option,
			children: option.children ? mergeOptions([], option.children) : undefined,
		});
	}
	for (const child of option.children ?? []) {
		childIds.add(child.id);
		addOption(options, childIds, child);
	}
}

function mergeOptions(
	into: JiraFieldOption[],
	options: JiraFieldOption[],
): JiraFieldOption[] {
	const byId = new Map(into.map((option) => [option.id, option]));
	for (const option of options) {
		const existing = byId.get(option.id);
		if (existing) {
			if (option.children) {
				existing.children = mergeOptions(
					existing.children ?? [],
					option.children,
				);
			}
		} else {
			byId.set(option.id, { ...option });
		}
	}
	return [...byId.values()];
}

interface FieldOptionEntry {
	options: Map<string, JiraFieldOption>;
	childIds: Set<string>;
}

async function fetchProjectFieldOptions(
	client: JiraClient,
	project: JiraProjectData,
): Promise<Map<string, FieldOptionEntry>> {
	const fields = new Map<string, FieldOptionEntry>();
	for (const issueType of project.issueTypes) {
		let startAt = 0;
		const guard = pageGuard(
			`createmeta of ${project.project.key} ${issueType.id}`,
		);
		for (;;) {
			const page = await client.getJson<{
				values?: JiraCreateMetaField[];
				isLast?: boolean;
			}>(
				`/rest/api/2/issue/createmeta/${encodeURIComponent(project.project.key)}/issuetypes/${encodeURIComponent(issueType.id)}`,
				{ maxResults: pageSize, startAt },
			);
			const values = page.values ?? [];
			guard(values.map((field) => field.fieldId));

			for (const field of values) {
				if (
					!field.fieldId.startsWith("customfield_") ||
					!field.allowedValues ||
					field.allowedValues.length === 0
				) {
					continue;
				}
				const entry = fields.get(field.fieldId) ?? {
					options: new Map<string, JiraFieldOption>(),
					childIds: new Set<string>(),
				};
				for (const option of field.allowedValues) {
					addOption(entry.options, entry.childIds, option);
				}
				fields.set(field.fieldId, entry);
			}

			if (page.isLast || values.length === 0) break;
			startAt += values.length;
		}
	}
	return fields;
}

async function fetchFieldOptions(
	client: JiraClient,
	projects: JiraProjectData[],
): Promise<JiraFieldOptions[]> {
	const perProject = await Promise.all(
		projects.map((project) => fetchProjectFieldOptions(client, project)),
	);
	const fields = new Map<string, FieldOptionEntry>();
	for (const projectFields of perProject) {
		for (const [fieldId, entry] of projectFields) {
			const target = fields.get(fieldId) ?? {
				options: new Map<string, JiraFieldOption>(),
				childIds: new Set<string>(),
			};
			for (const option of entry.options.values()) {
				if (!entry.childIds.has(option.id)) {
					addOption(target.options, target.childIds, option);
				}
			}
			fields.set(fieldId, target);
		}
	}

	return [...fields.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([fieldId, entry]) => ({
			fieldId,
			options: [...entry.options.values()].filter(
				(option) => !entry.childIds.has(option.id),
			),
		}));
}

async function fetchComments(client: JiraClient, key: string) {
	const comments = [];
	const guard = pageGuard(`${key} comment`);
	let startAt = 0;
	for (;;) {
		const page = await client.getJson<{
			comments?: JiraIssueData["comments"];
			total?: number;
		}>(`/rest/api/2/issue/${encodeURIComponent(key)}/comment`, {
			expand: "renderedBody,properties",
			startAt,
			maxResults: pageSize,
		});
		const values = page.comments ?? [];
		guard(values.map((row) => row.id));
		comments.push(...values);
		if (lastPage(comments.length, page.total, values.length, pageSize)) break;
		startAt += values.length;
	}
	return comments;
}

async function fetchWorklogs(client: JiraClient, key: string) {
	const worklogs = [];
	const guard = pageGuard(`${key} worklog`);
	let startAt = 0;
	for (;;) {
		const page = await client.getJson<{
			worklogs?: JiraIssueData["worklogs"];
			total?: number;
		}>(`/rest/api/2/issue/${encodeURIComponent(key)}/worklog`, {
			startAt,
			maxResults: pageSize,
		});
		const values = page.worklogs ?? [];
		guard(values.map((row) => row.id));
		worklogs.push(...values);
		if (lastPage(worklogs.length, page.total, values.length, pageSize)) break;
		startAt += values.length;
	}
	return worklogs;
}

async function fetchWatchers(client: JiraClient, key: string) {
	const page = await client.getJson<{ watchers?: JiraUser[] }>(
		`/rest/api/2/issue/${encodeURIComponent(key)}/watchers`,
	);
	return page.watchers ?? [];
}

async function fetchChangelog(client: JiraClient, key: string) {
	const histories = [];
	const guard = pageGuard(`${key} changelog`);
	let startAt = 0;
	for (;;) {
		const page = await client.getJson<{
			histories?: JiraIssueData["histories"];
			total?: number;
		}>(`/rest/api/2/issue/${encodeURIComponent(key)}/changelog`, {
			startAt,
			maxResults: pageSize,
		});
		const values = page.histories ?? [];
		guard(values.map((row) => row.id));
		histories.push(...values);
		if (lastPage(histories.length, page.total, values.length, pageSize)) break;
		startAt += values.length;
	}
	return histories;
}

async function downloadAttachment(
	client: JiraClient,
	attachment: NonNullable<JiraIssue["fields"]["attachment"]>[number],
	options: FetchOptions,
): Promise<ImportedAttachment> {
	const existing = options.existingAttachments?.get(attachment.id);
	if (existing) {
		try {
			const path = join(options.attachmentsDir, existing.storagePath);
			const info = await stat(path);
			if (info.size === (attachment.size ?? info.size)) {
				const bytes = await readFile(path);
				const sha256 = createHash("sha256").update(bytes).digest("hex");
				if (sha256 === existing.sha256) {
					return {
						...attachment,
						storagePath: existing.storagePath,
						sha256: existing.sha256,
					};
				}
			}
		} catch {
			// Download the missing file again.
		}
	}

	const bytes = await client.getBytes(attachment.content);
	if (typeof attachment.size === "number" && bytes.length !== attachment.size) {
		throw new Error(
			`attachment ${attachment.id} size ${bytes.length} does not match ${attachment.size}`,
		);
	}
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const storagePath = join(sha256, pathSegment(attachment.id));
	const target = join(options.attachmentsDir, storagePath);
	await mkdir(dirname(target), { recursive: true });
	const temporary = join(
		dirname(target),
		`.${pathSegment(attachment.id)}-${randomUUID()}.tmp`,
	);
	try {
		await writeFile(temporary, bytes, { flag: "wx" });
		await rename(temporary, target);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
	return { ...attachment, storagePath, sha256 };
}

async function enrichIssue(
	client: JiraClient,
	issue: JiraIssue,
	options: FetchOptions,
	serviceDesk: boolean,
): Promise<JiraIssueData> {
	const commentTotal = issue.fields.comment?.total ?? 0;
	const worklogTotal = issue.fields.worklog?.total ?? 0;
	const watchCount = issue.fields.watches?.watchCount ?? 0;
	const historyTotal = issue.changelog?.total ?? 0;
	const embeddedHistories = issue.changelog?.histories ?? [];

	try {
		const [comments, worklogs, watchers, histories, attachments, sla, channel] =
			await Promise.all([
				commentTotal > 0
					? fetchComments(client, issue.key)
					: Promise.resolve([]),
				worklogTotal > 0
					? fetchWorklogs(client, issue.key)
					: Promise.resolve([]),
				watchCount > 0 ? fetchWatchers(client, issue.key) : Promise.resolve([]),
				historyTotal > embeddedHistories.length
					? fetchChangelog(client, issue.key)
					: Promise.resolve(embeddedHistories),
				options.skipAttachments
					? Promise.resolve([])
					: Promise.all(
							(issue.fields.attachment ?? []).map((attachment) =>
								downloadAttachment(client, attachment, options),
							),
						),
				serviceDesk && !skipPrivateApi(options, "service desk SLA data")
					? fetchRequestSla(client, issue.key)
					: Promise.resolve(null),
				serviceDesk
					? fetchRequestChannel(client, issue.key)
					: Promise.resolve(null),
			]);

		return {
			issue,
			comments,
			worklogs,
			watchers,
			histories,
			attachments,
			sla,
			channel,
		};
	} catch (error) {
		throw withIssueKey(issue.key, error);
	}
}

async function fetchProjectIssues(
	client: JiraClient,
	projectKey: string,
	options: FetchOptions,
	serviceDesk: boolean,
): Promise<JiraIssueData[]> {
	const issues: JiraIssueData[] = [];
	const guard = pageGuard(`issues of ${projectKey}`);
	let startAt = 0;
	for (;;) {
		const page = await client.getJson<{
			issues?: JiraIssue[];
			total?: number;
		}>("/rest/api/2/search", {
			jql: `project="${projectKey.replaceAll('"', '\\"')}" ORDER BY key`,
			startAt,
			maxResults: issuePageSize,
			fields: "*all",
			expand: "changelog,renderedFields",
		});
		const values = page.issues ?? [];
		guard(values.map((issue) => issue.key));
		const enriched = await Promise.all(
			values.map((issue) => enrichIssue(client, issue, options, serviceDesk)),
		);
		issues.push(...enriched);
		if (lastPage(issues.length, page.total, values.length, issuePageSize)) {
			break;
		}
		startAt += values.length;
	}
	return issues;
}

export async function fetchDataset(
	client: JiraClient,
	options: FetchOptions,
): Promise<JiraDataset> {
	const requested = options.projectKeys?.map((key) => key.toUpperCase());
	const [
		users,
		issueTypes,
		priorities,
		resolutions,
		statuses,
		linkTypes,
		fields,
		workflows,
		projects,
	] = await Promise.all([
		fetchUsers(client),
		client.getJson<JiraIssueType[]>("/rest/api/2/issuetype"),
		client.getJson<JiraPriority[]>("/rest/api/2/priority"),
		client.getJson<JiraResolution[]>("/rest/api/2/resolution"),
		client.getJson<JiraStatus[]>("/rest/api/2/status"),
		client
			.getJson<{ issueLinkTypes: JiraLinkType[] }>("/rest/api/2/issueLinkType")
			.then((response) => response.issueLinkTypes),
		client.getJson<JiraField[]>("/rest/api/2/field"),
		fetchWorkflows(client, options),
		fetchProjects(client, requested),
	]);

	if (requested) {
		const missing = requested.filter(
			(key) =>
				!projects.some((project) => project.project.key.toUpperCase() === key),
		);
		if (missing.length > 0) {
			throw new Error(`Unknown project keys: ${missing.join(", ")}`);
		}
	}

	const fieldOptions = await fetchFieldOptions(client, projects);
	const serviceDeskKeys = new Set(
		projects
			.filter((project) => project.project.projectTypeKey === "service_desk")
			.map((project) => project.project.key),
	);
	const issues: JiraIssueData[] = [];
	for (const project of projects) {
		const fetched = await fetchProjectIssues(
			client,
			project.project.key,
			options,
			serviceDeskKeys.has(project.project.key),
		);
		for (const issue of fetched) issues.push(issue);
	}

	let serviceDesks: Awaited<ReturnType<typeof fetchServiceDesks>> = [];
	let slaCalendars: JiraWorkingCalendar[] = [];
	let automationRules: JiraAutomationRule[] = [];
	if (serviceDeskKeys.size > 0) {
		[serviceDesks, slaCalendars, automationRules] = await Promise.all([
			fetchServiceDesks(
				client,
				projects.map((project) => project.project.key),
				options,
			),
			fetchSlaCalendars(client, options),
			fetchAutomationRules(client, options),
		]);
		if (
			options.privateApis &&
			!slaCalendars.some((calendar) => calendar.id === -1)
		) {
			slaCalendars.push(defaultWorkingCalendar());
		}
	}

	return {
		users,
		issueTypes,
		priorities,
		resolutions,
		statuses,
		linkTypes,
		fields,
		workflows,
		fieldOptions,
		projects,
		issues,
		serviceDesks,
		slaCalendars,
		automationRules,
	};
}
