import { type JiraClient, JiraRequestError } from "./jira.ts";
import { type PrivateApiOptions, skipPrivateApi } from "./private-apis.ts";
import type {
	JiraAutomationRule,
	JiraPortal,
	JiraQueue,
	JiraRequestSla,
	JiraRequestSlaMetric,
	JiraRequestType,
	JiraRequestTypeField,
	JiraRequestTypeFields,
	JiraRequestTypeGroup,
	JiraServiceDeskData,
	JiraServiceDeskRef,
	JiraSlaMetricsResponse,
	JiraWorkingCalendar,
	JiraWorkingCalendarList,
} from "./types.ts";

const EXPERIMENTAL = { "X-ExperimentalApi": "opt-in" };
const pageSize = 100;
const maxPages = 10_000;
const PORTAL_LINK_BASE = "https://jira.invalid";
const weekdays = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
];

/** Jira's default calendar is virtual and has no endpoint; it counts every minute. */
export function defaultWorkingCalendar(): JiraWorkingCalendar {
	return {
		id: -1,
		name: "Default 24/7 calendar",
		timezoneId: "UTC",
		holidays: [],
		workingTimes: weekdays.map((weekday) => ({
			weekday,
			start: 0,
			end: 86_400_000,
			disabled: false,
		})),
	};
}

interface Paged<T> {
	values?: T[];
	size?: number;
	isLastPage?: boolean;
}

async function fetchPaged<T>(
	client: JiraClient,
	path: string,
	params: Record<string, string | number> = {},
): Promise<T[]> {
	const values: T[] = [];
	for (let start = 0, pages = 0; ; pages++) {
		if (pages >= maxPages) {
			throw new Error(`paging did not finish after ${maxPages} pages: ${path}`);
		}
		const page = await client.getJson<Paged<T>>(
			path,
			{ ...params, start, limit: pageSize },
			{ headers: EXPERIMENTAL },
		);
		const pageValues = page.values ?? [];
		values.push(...pageValues);
		if (page.isLastPage || pageValues.length === 0) break;
		if (page.size !== undefined && start + pageValues.length >= page.size) {
			break;
		}
		start += pageValues.length;
	}
	return values;
}

function portalId(desk: JiraServiceDeskRef): string | null {
	const link = desk._links?.portal;
	if (!link) return null;
	try {
		const id = new URL(link, PORTAL_LINK_BASE).pathname
			.split("/")
			.filter(Boolean)
			.pop();
		return id ?? null;
	} catch {
		return null;
	}
}

async function fetchPortal(
	client: JiraClient,
	desk: JiraServiceDeskRef,
): Promise<JiraPortal | null> {
	const id = portalId(desk);
	if (!id) return null;
	return client.getJson<JiraPortal>(
		`/rest/servicedeskapi/portals/${encodeURIComponent(id)}`,
		undefined,
		{ headers: EXPERIMENTAL },
	);
}

async function fetchRequestTypes(
	client: JiraClient,
	deskId: string,
): Promise<{ requestType: JiraRequestType; fields: JiraRequestTypeField[] }[]> {
	const requestTypes = await fetchPaged<JiraRequestType>(
		client,
		`/rest/servicedeskapi/servicedesk/${encodeURIComponent(deskId)}/requesttype`,
	);
	return Promise.all(
		requestTypes.map(async (requestType) => {
			const response = await client.getJson<JiraRequestTypeFields>(
				`/rest/servicedeskapi/servicedesk/${encodeURIComponent(deskId)}/requesttype/${encodeURIComponent(requestType.id)}/field`,
				undefined,
				{ headers: EXPERIMENTAL },
			);
			return { requestType, fields: response.requestTypeFields ?? [] };
		}),
	);
}

/** The desk's "anyone with an account may raise requests" setting; null when Jira does not say. */
export async function fetchOpenAccess(
	client: JiraClient,
	projectKey: string,
	options: PrivateApiOptions = {},
): Promise<boolean | null> {
	if (skipPrivateApi(options, "service desk request security")) return null;
	try {
		const response = await client.getJson<{ serviceDeskOpenAccess?: unknown }>(
			`/rest/servicedesk/1/servicedesk/${encodeURIComponent(projectKey)}/settings/requestsecurity`,
			undefined,
			{ headers: EXPERIMENTAL },
		);
		if (typeof response.serviceDeskOpenAccess === "boolean") {
			return response.serviceDeskOpenAccess;
		}
		console.log(
			`service desk ${projectKey}: request security has no serviceDeskOpenAccess field, open access not imported`,
		);
	} catch (error) {
		const status = (error as { status?: number }).status;
		if (status !== 404) throw error;
		console.log(
			`service desk ${projectKey}: request security is not available (404), open access not imported`,
		);
	}
	return null;
}

export async function fetchServiceDesks(
	client: JiraClient,
	projectKeys: string[],
	options: PrivateApiOptions = {},
): Promise<JiraServiceDeskData[]> {
	const metricsEnabled = !skipPrivateApi(options, "service desk SLA metrics");
	const desks = await fetchPaged<JiraServiceDeskRef>(
		client,
		"/rest/servicedeskapi/servicedesk",
	);
	const wanted = new Set(projectKeys);
	return Promise.all(
		desks
			.filter((desk) => wanted.has(desk.projectKey))
			.map(async (desk) => {
				const [portal, groups, requestTypes, queues, metrics, openAccess] =
					await Promise.all([
						fetchPortal(client, desk),
						fetchPaged<JiraRequestTypeGroup>(
							client,
							`/rest/servicedeskapi/servicedesk/${encodeURIComponent(desk.id)}/requesttypegroup`,
						),
						fetchRequestTypes(client, desk.id),
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
									.catch(() => ({}) as JiraSlaMetricsResponse)
							: Promise.resolve({} as JiraSlaMetricsResponse),
						fetchOpenAccess(client, desk.projectKey, options),
					]);

				return {
					desk,
					portal,
					groups,
					requestTypes,
					queues,
					metrics: metrics.timeMetrics ?? [],
					openAccess,
				};
			}),
	);
}

export async function fetchSlaCalendars(
	client: JiraClient,
	options: PrivateApiOptions = {},
): Promise<JiraWorkingCalendar[]> {
	if (skipPrivateApi(options, "SLA calendars")) return [];
	const list = await client.getJson<JiraWorkingCalendarList>(
		"/rest/workinghours/1/api/calendar",
		undefined,
		{ headers: EXPERIMENTAL },
	);
	return Promise.all(
		(list.calendars ?? []).map((calendar) =>
			client.getJson<JiraWorkingCalendar>(
				`/rest/workinghours/1/api/calendar/${calendar.id}`,
				undefined,
				{ headers: EXPERIMENTAL },
			),
		),
	);
}

export async function fetchAutomationRules(
	client: JiraClient,
	options: PrivateApiOptions = {},
): Promise<JiraAutomationRule[]> {
	if (skipPrivateApi(options, "automation rules")) return [];
	return client.getJson<JiraAutomationRule[]>(
		"/rest/cb-automation/latest/project/GLOBAL/rule",
		undefined,
		{ headers: EXPERIMENTAL },
	);
}

export async function fetchRequestSla(
	client: JiraClient,
	issueKey: string,
): Promise<JiraRequestSla> {
	return {
		values: await fetchPaged<JiraRequestSlaMetric>(
			client,
			`/rest/servicedeskapi/request/${encodeURIComponent(issueKey)}/sla`,
		),
	};
}

export async function fetchRequestChannel(
	client: JiraClient,
	issueKey: string,
): Promise<string | null> {
	try {
		const property = await client.getJson<{ value?: { value?: string } }>(
			`/rest/api/2/issue/${encodeURIComponent(issueKey)}/properties/request.channel.type`,
		);
		return property.value?.value ?? null;
	} catch (error) {
		if (error instanceof JiraRequestError && error.status === 404) return null;
		throw error;
	}
}
