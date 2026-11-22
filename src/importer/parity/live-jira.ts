import { fetchWorkflows } from "../fetch.ts";
import { type JiraClient, JiraRequestError } from "../jira.ts";
import { type PrivateApiOptions, skipPrivateApi } from "../private-apis.ts";
import type {
	JiraIssue,
	JiraIssueType,
	JiraLinkType,
	JiraPriority,
	JiraProject,
	JiraProjectStatuses,
	JiraQueue,
	JiraRequestType,
	JiraResolution,
	JiraServiceDeskRef,
	JiraSlaMetricsResponse,
	JiraStatus,
	JiraUser,
} from "../types.ts";
import type {
	JiraAgileData,
	JiraBoardData,
	JiraFilterData,
	JiraIssueData,
	JiraLiveSnapshot,
	JiraProjectData,
	JiraServiceDeskData,
	JiraSprintData,
} from "./types.ts";

const PAGE_SIZE = 100;
const EXPERIMENTAL = { "X-ExperimentalApi": "opt-in" };

interface Paged<T> {
	values?: T[];
	isLastPage?: boolean;
	isLast?: boolean;
}

function issueAssignee(user: JiraUser | null | undefined) {
	if (!user) return null;
	return user.key ?? user.name ?? null;
}

function issueNumber(key: string) {
	const number = Number(key.slice(key.lastIndexOf("-") + 1));
	return Number.isFinite(number) ? number : 0;
}

async function fetchIssues(
	client: JiraClient,
	projectKey: string,
): Promise<JiraIssueData[]> {
	const issues: JiraIssueData[] = [];
	const jql = `project="${projectKey.replaceAll('"', '\\"')}" ORDER BY key`;
	let startAt = 0;
	for (;;) {
		const page = await client.getJson<{
			issues?: JiraIssue[];
			total?: number;
		}>("/rest/api/2/search", {
			jql,
			startAt,
			maxResults: PAGE_SIZE,
			fields:
				"comment,worklog,attachment,issuelinks,watches,subtasks,status,resolution,assignee,updated,issuetype,project",
			expand: "changelog",
		});
		const values = page.issues ?? [];
		for (const issue of values) {
			const fields = issue.fields;
			issues.push({
				key: issue.key,
				number: issueNumber(issue.key),
				projectKey: fields.project?.key ?? projectKey,
				status: fields.status?.id ?? "",
				resolution: fields.resolution?.id ?? null,
				assignee: issueAssignee(fields.assignee),
				updated: fields.updated ?? null,
				comments: fields.comment?.total ?? 0,
				worklogs: fields.worklog?.total ?? 0,
				attachments: fields.attachment?.length ?? 0,
				attachmentBytes: (fields.attachment ?? []).reduce(
					(total, attachment) => total + (attachment.size ?? 0),
					0,
				),
				links: fields.issuelinks?.length ?? 0,
				watchers: fields.watches?.watchCount ?? 0,
				subtasks: fields.subtasks?.length ?? 0,
				history: issue.changelog?.total ?? 0,
			});
		}
		if (values.length === 0) break;
		if (
			typeof page.total === "number" &&
			startAt + values.length >= page.total
		) {
			break;
		}
		startAt += values.length;
	}
	return issues;
}

async function fetchUsers(client: JiraClient): Promise<JiraUser[]> {
	const users: JiraUser[] = [];
	let startAt = 0;
	for (;;) {
		const page = await client.getJson<JiraUser[]>("/rest/api/2/user/search", {
			username: ".",
			includeInactive: "true",
			startAt,
			maxResults: PAGE_SIZE,
		});
		users.push(...page);
		if (page.length < PAGE_SIZE) break;
		startAt += page.length;
	}
	return users;
}

async function fetchProject(
	client: JiraClient,
	project: JiraProject,
): Promise<JiraProjectData> {
	const key = encodeURIComponent(project.key);
	const [total, statuses, versions, components] = await Promise.all([
		client.getJson<{ total?: number }>("/rest/api/2/search", {
			jql: `project="${project.key.replaceAll('"', '\\"')}"`,
			maxResults: 0,
		}),
		client.getJson<JiraProjectStatuses[]>(
			`/rest/api/2/project/${key}/statuses`,
		),
		client.getJson<{ id: string }[]>(`/rest/api/2/project/${key}/versions`),
		client.getJson<{ id: string }[]>(`/rest/api/2/project/${key}/components`),
	]);
	return {
		key: project.key,
		issueTotal: total.total ?? 0,
		versions: versions.map((version) => version.id),
		components: components.map((component) => component.id),
		statusesByIssueType: new Map(
			statuses.map((group) => [
				group.id,
				(group.statuses ?? []).map((status) => status.id),
			]),
		),
	};
}

async function fetchPaged<T>(
	client: JiraClient,
	path: string,
	params: Record<string, string | number> = {},
): Promise<T[]> {
	const values: T[] = [];
	for (let start = 0; ; ) {
		const page = await client.getJson<Paged<T>>(
			path,
			{ ...params, start, limit: PAGE_SIZE },
			{ headers: EXPERIMENTAL },
		);
		const pageValues = page.values ?? [];
		values.push(...pageValues);
		if (page.isLastPage || pageValues.length === 0) break;
		start += pageValues.length;
	}
	return values;
}

async function fetchServiceDesks(
	client: JiraClient,
	projectKeys: Set<string>,
	options: PrivateApiOptions = {},
): Promise<JiraServiceDeskData[]> {
	const metricsEnabled = !skipPrivateApi(options, "service desk SLA metrics");
	const desks = await fetchPaged<JiraServiceDeskRef>(
		client,
		"/rest/servicedeskapi/servicedesk",
	);
	const result: JiraServiceDeskData[] = [];
	for (const desk of desks.filter((item) => projectKeys.has(item.projectKey))) {
		const [requestTypes, queues, metrics] = await Promise.all([
			fetchPaged<JiraRequestType>(
				client,
				`/rest/servicedeskapi/servicedesk/${encodeURIComponent(desk.id)}/requesttype`,
			),
			fetchPaged<JiraQueue>(
				client,
				`/rest/servicedeskapi/servicedesk/${encodeURIComponent(desk.id)}/queue`,
				{ includeCount: "true" },
			),
			metricsEnabled
				? client
						.getJson<JiraSlaMetricsResponse>(
							`/rest/servicedesk/1/servicedesk/agent/${encodeURIComponent(desk.projectKey)}/sla/metrics`,
							undefined,
							{ headers: EXPERIMENTAL },
						)
						.catch((error) => {
							console.warn(
								`Skipping SLA metrics for ${desk.projectKey}: ${error instanceof Error ? error.message : String(error)}`,
							);
							return {} as JiraSlaMetricsResponse;
						})
				: Promise.resolve({} as JiraSlaMetricsResponse),
		]);
		result.push({
			sourceId: desk.id,
			projectKey: desk.projectKey,
			requestTypes: requestTypes.map((requestType) => requestType.id),
			queues: queues.map((queue) => ({
				id: queue.id,
				jql: queue.jql ?? "",
				issueCount: queue.issueCount ?? null,
			})),
			metrics: (metrics.timeMetrics ?? []).map((metric) => String(metric.id)),
		});
	}
	return result;
}

async function fetchAgileBoards(client: JiraClient): Promise<JiraAgileData> {
	const boards: JiraBoardData[] = [];
	try {
		for (let startAt = 0; ; ) {
			const page = await client.getJson<{
				values?: { id: number }[];
				isLast?: boolean;
			}>("/rest/agile/1.0/board", { startAt, maxResults: PAGE_SIZE });
			const values = page.values ?? [];
			for (const board of values) {
				boards.push({ id: String(board.id), sprints: [] });
			}
			if (page.isLast || values.length === 0) break;
			startAt += values.length;
		}
	} catch (error) {
		if (
			error instanceof JiraRequestError &&
			(error.status === 400 || error.status === 404)
		) {
			return { boards: [] };
		}
		throw error;
	}
	return { boards };
}

async function fetchAgile(client: JiraClient): Promise<JiraAgileData> {
	const boards: JiraBoardData[] = [];
	for (let startAt = 0; ; ) {
		const page = await client.getJson<{
			values?: { id: number; name?: string }[];
			isLast?: boolean;
		}>("/rest/agile/1.0/board", { startAt, maxResults: PAGE_SIZE });
		const values = page.values ?? [];
		for (const board of values) {
			const sprints: JiraSprintData[] = [];
			try {
				for (let sprintStart = 0; ; ) {
					const sprintPage = await client.getJson<{
						values?: { id: number; state: string }[];
						isLast?: boolean;
					}>(`/rest/agile/1.0/board/${board.id}/sprint`, {
						startAt: sprintStart,
						maxResults: PAGE_SIZE,
					});
					const sprintValues = sprintPage.values ?? [];
					for (const sprint of sprintValues) {
						let issueCount = 0;
						try {
							const issues = await client.getJson<{ total?: number }>(
								`/rest/agile/1.0/sprint/${sprint.id}/issue`,
								{ startAt: 0, maxResults: 0 },
							);
							issueCount = issues.total ?? 0;
						} catch (error) {
							if (
								!(error instanceof JiraRequestError) ||
								error.status !== 404
							) {
								throw error;
							}
						}
						sprints.push({
							id: String(sprint.id),
							state: sprint.state,
							issueCount,
						});
					}
					if (sprintPage.isLast || sprintValues.length === 0) break;
					sprintStart += sprintValues.length;
				}
			} catch (error) {
				if (!(error instanceof JiraRequestError) || error.status !== 400) {
					throw error;
				}
			}
			boards.push({ id: String(board.id), sprints });
		}
		if (page.isLast || values.length === 0) break;
		startAt += values.length;
	}
	return { boards };
}

/** The saved filters the database holds, as Jira has them now; a filter deleted in Jira is absent. */
async function fetchFilters(
	client: JiraClient,
	ids: string[],
): Promise<JiraFilterData[]> {
	const filters: JiraFilterData[] = [];
	for (const id of ids) {
		try {
			const filter = await client.getJson<{
				id: string | number;
				name?: string;
				jql?: string;
			}>(`/rest/api/2/filter/${encodeURIComponent(id)}`);
			filters.push({
				id: String(filter.id),
				name: filter.name ?? "",
				jql: filter.jql ?? "",
			});
		} catch (error) {
			if (!(error instanceof JiraRequestError) || error.status !== 404) {
				throw error;
			}
		}
	}
	return filters;
}

async function fetchWorkflowResolutionTransitions(
	client: JiraClient,
	options: PrivateApiOptions,
): Promise<Map<string, string[]>> {
	const workflows = await fetchWorkflows(client, options);
	return new Map(
		workflows.map((workflow) => [
			workflow.name,
			workflow.layout.transitions
				.filter((transition) => transition.hasResolutionField === true)
				.map((transition) => transition.id),
		]),
	);
}

export interface JiraLiveOptions extends PrivateApiOptions {
	serviceDesks: boolean;
	agile: boolean;
	boardsOnly?: boolean;
	filters: boolean;
	/** Source ids of the filters in the database, to look up in Jira. */
	filterIds?: string[];
}

export async function fetchJiraLive(
	client: JiraClient,
	options: JiraLiveOptions,
): Promise<JiraLiveSnapshot> {
	const [
		projects,
		issueTypes,
		statuses,
		priorities,
		resolutions,
		linkTypes,
		users,
	] = await Promise.all([
		client.getJson<JiraProject[]>("/rest/api/2/project", {
			expand: "description,lead",
		}),
		client.getJson<JiraIssueType[]>("/rest/api/2/issuetype"),
		client.getJson<JiraStatus[]>("/rest/api/2/status"),
		client.getJson<JiraPriority[]>("/rest/api/2/priority"),
		client.getJson<JiraResolution[]>("/rest/api/2/resolution"),
		client
			.getJson<{ issueLinkTypes: JiraLinkType[] }>("/rest/api/2/issueLinkType")
			.then((response) => response.issueLinkTypes),
		fetchUsers(client),
	]);

	const projectData: JiraProjectData[] = [];
	const issues = new Map<string, JiraIssueData>();
	for (const project of projects) {
		const [data, projectIssues] = await Promise.all([
			fetchProject(client, project),
			fetchIssues(client, project.key),
		]);
		projectData.push(data);
		for (const issue of projectIssues) issues.set(issue.key, issue);
	}

	const projectKeys = new Set(projects.map((project) => project.key));
	const [workflowResolutionTransitions, serviceDesks, agile, filters] =
		await Promise.all([
			skipPrivateApi(options, "workflow layouts")
				? Promise.resolve(new Map<string, string[]>())
				: fetchWorkflowResolutionTransitions(client, options),
			options.serviceDesks
				? fetchServiceDesks(client, projectKeys, options)
				: Promise.resolve(null),
			options.agile
				? fetchAgile(client)
				: options.boardsOnly
					? fetchAgileBoards(client)
					: Promise.resolve(null),
			options.filters
				? fetchFilters(client, options.filterIds ?? [])
				: Promise.resolve(null),
		]);

	return {
		projects: projectData,
		issues,
		users: users
			.filter((user) => user.name)
			.map((user) => ({
				key: user.key ?? null,
				username: user.name,
				active: user.active !== false && user.deleted !== true,
			})),
		issueTypes: issueTypes.map((issueType) => issueType.id),
		statuses: statuses.map((status) => status.id),
		priorities: priorities.map((priority) => priority.id),
		resolutions: resolutions.map((resolution) => resolution.id),
		linkTypes: linkTypes.map((linkType) => linkType.id),
		workflowResolutionTransitions,
		workflowResolutionSkipped: options.privateApis !== true,
		serviceDesks,
		serviceDeskMetricsSkipped:
			options.serviceDesks === true && options.privateApis !== true,
		agile,
		filters,
	};
}
