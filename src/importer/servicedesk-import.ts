import { eq } from "drizzle-orm";
import {
	automationRules,
	queues,
	requestTypeFields,
	requestTypeGroupMembers,
	requestTypeGroups,
	requestTypes,
	serviceDesks,
	slaCalendars,
	slaGoals,
	slaImportedCycles,
	slaMetrics,
} from "../lib/server/schema.ts";
import type {
	JiraAutomationRule,
	JiraIssueData,
	JiraServiceDeskData,
	JiraSlaCondition,
	JiraSlaCycle,
	JiraSlaMetric,
	JiraWorkingCalendar,
	JiraWorkingHoliday,
} from "./types.ts";
import type { Executor, ImportCounts } from "./upsert.ts";
import { emptyCounts, mergeCounts, upsertRows } from "./upsert.ts";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const WEEKDAYS = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
] as const;

export const requestChannels = [
	"portal",
	"email",
	"agent",
	"api",
	"chat",
] as const;
export type RequestChannel = (typeof requestChannels)[number];

export interface ServiceDeskMaps {
	projectSourceIds: Map<string, string>;
	calendarIds: Map<string, string>;
	requestTypeIds: Map<string, string>;
	metricIds: Map<string, string>;
	deskIds: Map<string, string>;
	customerRequestTypeFieldId: string | null;
}

function isRequestChannel(value: unknown): value is RequestChannel {
	return requestChannels.includes(value as RequestChannel);
}

export function mapRequestChannel(value: string | null | undefined) {
	return isRequestChannel(value) ? value : null;
}

function holidayDates(holiday: JiraWorkingHoliday): string[] {
	if (holiday.date) return [holiday.date];
	if (holiday.startDate) {
		const end = holiday.endDate ?? holiday.startDate;
		const dates: string[] = [];
		for (
			let cursor = Date.parse(`${holiday.startDate}T00:00:00Z`);
			cursor <= Date.parse(`${end}T00:00:00Z`);
			cursor += DAY_MS
		) {
			dates.push(new Date(cursor).toISOString().slice(0, 10));
		}
		return dates;
	}
	throw new Error(
		`Unsupported SLA calendar holiday shape: ${JSON.stringify(holiday)}`,
	);
}

/** Jira stores milliseconds from midnight; intervals past midnight move to the next day. */
export function mapWorkingHours(calendar: JiraWorkingCalendar) {
	const hours: { start: number; end: number }[][] = WEEKDAYS.map(() => []);
	for (const time of calendar.workingTimes ?? []) {
		if (time.disabled) continue;
		const weekday = WEEKDAYS.indexOf(
			time.weekday.toLowerCase() as (typeof WEEKDAYS)[number],
		);
		if (weekday < 0) {
			throw new Error(`Unknown weekday in SLA calendar: ${time.weekday}`);
		}
		let start = time.start / MINUTE_MS;
		let end = time.end / MINUTE_MS;
		if (end <= start) continue;
		let day = weekday;
		while (end > 1440) {
			hours[day].push({ start, end: 1440 });
			day = (day + 1) % 7;
			start = 0;
			end -= 1440;
		}
		hours[day].push({ start, end });
	}
	for (const intervals of hours) {
		intervals.sort((left, right) => left.start - right.start);
	}
	return hours;
}

function mapCondition(condition: JiraSlaCondition) {
	if (condition.missing) {
		throw new Error(
			`SLA condition is marked missing: ${JSON.stringify(condition)}`,
		);
	}
	const factory = condition.factoryKey ?? "";
	const id = condition.conditionId ?? "";

	if (factory === "issue-created-sla-condition-factory") {
		return { type: "issue_created" as const };
	}
	if (factory === "resolution-sla-condition-factory") {
		if (id === "resolution-set-hit-condition") {
			return { type: "resolution_set" as const };
		}
		if (id === "resolution-cleared-hit-condition") {
			return { type: "resolution_cleared" as const };
		}
	}
	if (factory === "comment-sla-condition-factory") {
		if (id === "comment-for-reporter-hit-condition") {
			return { type: "comment_for_customer" as const };
		}
		if (id === "comment-by-reporter-hit-condition") {
			return { type: "comment_by_customer" as const };
		}
	}
	if (factory === "assignee-sla-condition-factory") {
		if (id === "assignee-set-hit-condition") {
			return { type: "assignee_set" as const };
		}
		if (id === "assignee-cleared-hit-condition") {
			return { type: "assignee_cleared" as const };
		}
	}
	if (factory === "status-sla-condition-factory" && id) {
		return { type: "entered_status" as const, statusId: id };
	}

	throw new Error(`Unsupported SLA condition: ${JSON.stringify(condition)}`);
}

export function mapConditions(conditions: JiraSlaCondition[] | undefined) {
	return (conditions ?? []).map(mapCondition);
}

export function importSlaCalendars(
	tx: Executor,
	calendars: JiraWorkingCalendar[],
	counts: ImportCounts,
): Promise<Map<string, string>> {
	return upsertRows(
		tx,
		slaCalendars,
		calendars.map((calendar) => ({
			sourceId: String(calendar.id),
			name: calendar.name,
			timezone: calendar.timezoneId,
			workingHours: mapWorkingHours(calendar),
			holidays: (calendar.holidays ?? []).flatMap(holidayDates),
		})),
		(row) => String(row.sourceId),
	).then((result) => {
		mergeCounts(counts, "sla_calendars", result.counts);
		return result.ids;
	});
}

interface ServiceDeskImportContext {
	projectId: string;
	projectKey: string;
	issues: JiraIssueData[];
	fields: { id: string; name: string }[];
	maps: {
		issueTypeIds: Map<string, string>;
		calendarIds: Map<string, string>;
	};
	serviceDeskMaps: ServiceDeskMaps;
}

function requestTypeIssueTypes(context: ServiceDeskImportContext) {
	const byRequestType = new Map<string, Set<string>>();
	const fieldId = context.serviceDeskMaps.customerRequestTypeFieldId;
	if (!fieldId) return byRequestType;
	for (const data of context.issues) {
		const value = data.issue.fields[fieldId as `customfield_${string}`];
		const requestTypeId = (
			value as { requestType?: { id?: string } } | undefined
		)?.requestType?.id;
		if (!requestTypeId) continue;
		const issueTypeId = context.maps.issueTypeIds.get(
			data.issue.fields.issuetype.id,
		);
		if (!issueTypeId) continue;
		const types = byRequestType.get(requestTypeId) ?? new Set<string>();
		types.add(issueTypeId);
		byRequestType.set(requestTypeId, types);
	}
	return byRequestType;
}

function queueParents(queueRows: { id: string; name: string }[]) {
	const parents = new Map<string, string>();
	let parentId: string | null = null;
	for (const queue of queueRows) {
		if (queue.name.startsWith("↳")) {
			if (parentId) parents.set(queue.id, parentId);
		} else {
			parentId = queue.id;
		}
	}
	return parents;
}

export async function importServiceDesk(
	tx: Executor,
	data: JiraServiceDeskData,
	context: ServiceDeskImportContext,
	counts: ImportCounts,
) {
	const [existingDesk] = await tx
		.select({ id: serviceDesks.id })
		.from(serviceDesks)
		.where(eq(serviceDesks.sourceId, data.desk.id))
		.limit(1);
	const deskResult = await upsertRows(
		tx,
		serviceDesks,
		[
			{
				sourceId: data.desk.id,
				projectId: context.projectId,
				portalName: data.portal?.name ?? data.desk.projectName,
				description: data.portal?.description ?? null,
				announcement: null,
			},
		],
		(row) => String(row.sourceId),
	);
	mergeCounts(counts, "service_desks", deskResult.counts);
	const deskId = deskResult.ids.get(data.desk.id);
	if (!deskId) throw new Error(`Service desk ${data.desk.id} was not imported`);
	if (!existingDesk && data.openAccess !== null) {
		await tx
			.update(serviceDesks)
			.set({ openAccess: data.openAccess })
			.where(eq(serviceDesks.id, deskId));
	}
	context.serviceDeskMaps.deskIds.set(context.projectId, deskId);

	const groupResult = await upsertRows(
		tx,
		requestTypeGroups,
		data.groups.map((group, sequence) => ({
			sourceId: group.id,
			deskId,
			name: group.name,
			sequence,
		})),
		(row) => `${row.deskId}:${row.sourceId}`,
	);
	mergeCounts(counts, "request_type_groups", groupResult.counts);

	const issueTypesByRequestType = requestTypeIssueTypes(context);
	const requestTypeRows = data.requestTypes.map(({ requestType }, sequence) => {
		const issueTypes = issueTypesByRequestType.get(requestType.id);
		if (issueTypes && issueTypes.size > 1) {
			throw new Error(
				`Request type ${requestType.id} maps to several issue types: ${[...issueTypes].join(", ")}`,
			);
		}
		return {
			sourceId: requestType.id,
			deskId,
			issueTypeId: issueTypes ? [...issueTypes][0] : null,
			name: requestType.name,
			description: requestType.description ?? null,
			helpText: requestType.helpText ?? null,
			iconName: requestType.icon?.id ?? null,
			sequence,
		};
	});
	const requestTypeResult = await upsertRows(
		tx,
		requestTypes,
		requestTypeRows,
		(row) => `${row.deskId}:${row.sourceId}`,
	);
	mergeCounts(counts, "request_types", requestTypeResult.counts);
	for (const row of requestTypeRows) {
		const id = requestTypeResult.ids.get(`${deskId}:${row.sourceId}`);
		if (id) {
			context.serviceDeskMaps.requestTypeIds.set(
				`${context.projectId}:${row.sourceId}`,
				id,
			);
		}
	}

	const memberRows = data.requestTypes.flatMap(({ requestType }) => {
		const requestTypeId = context.serviceDeskMaps.requestTypeIds.get(
			`${context.projectId}:${requestType.id}`,
		);
		if (!requestTypeId) {
			throw new Error(`Request type ${requestType.id} was not imported`);
		}
		return (requestType.groupIds ?? []).map((groupId, sequence) => {
			const group = groupResult.ids.get(`${deskId}:${groupId}`);
			if (!group) {
				throw new Error(
					`Request type ${requestType.id}: group ${groupId} was not imported`,
				);
			}
			return { requestTypeId, groupId: group, sequence };
		});
	});
	const memberResult = await upsertRows(
		tx,
		requestTypeGroupMembers,
		memberRows,
		(row) => `${row.requestTypeId}:${row.groupId}`,
	);
	mergeCounts(counts, "request_type_group_members", memberResult.counts);

	const fieldRows = data.requestTypes.flatMap(({ requestType, fields }) => {
		const requestTypeId = context.serviceDeskMaps.requestTypeIds.get(
			`${context.projectId}:${requestType.id}`,
		);
		if (!requestTypeId) {
			throw new Error(`Request type ${requestType.id} was not imported`);
		}
		return fields.map((field, sequence) => ({
			requestTypeId,
			fieldId: field.fieldId,
			label: field.name,
			description: field.description ?? null,
			required: field.required ?? false,
			sequence,
			hiddenValue: field.hidden ? (field.value ?? null) : null,
		}));
	});
	const fieldResult = await upsertRows(
		tx,
		requestTypeFields,
		fieldRows,
		(row) => `${row.requestTypeId}:${row.fieldId}`,
	);
	mergeCounts(counts, "request_type_fields", fieldResult.counts);

	const queueRows = data.queues.map((queue, sequence) => ({
		sourceId: queue.id,
		deskId,
		name: queue.name,
		jql: queue.jql,
		columns: queue.fields ?? [],
		issueCount: queue.issueCount ?? null,
		sequence,
		parentId: null as string | null,
	}));
	const topLevel = queueRows.filter((row) => !row.name.startsWith("↳"));
	const indented = queueRows.filter((row) => row.name.startsWith("↳"));
	const topLevelResult = await upsertRows(
		tx,
		queues,
		topLevel,
		(row) => `${row.deskId}:${row.sourceId}`,
		{ preserveNullKeys: ["parentId"] },
	);
	mergeCounts(counts, "queues", topLevelResult.counts);
	const indentedResult = await upsertRows(
		tx,
		queues,
		indented,
		(row) => `${row.deskId}:${row.sourceId}`,
		{ preserveNullKeys: ["parentId"] },
	);
	mergeCounts(counts, "queues", indentedResult.counts);
	const queueIds = new Map([...topLevelResult.ids, ...indentedResult.ids]);
	const parentIds = queueParents(
		queueRows.map((row) => ({
			id: queueIds.get(`${deskId}:${row.sourceId}`) ?? "",
			name: row.name,
		})),
	);
	const existingQueues = await tx
		.select({ id: queues.id, parentId: queues.parentId })
		.from(queues)
		.where(eq(queues.deskId, deskId));
	const currentParents = new Map(
		existingQueues.map((queue) => [queue.id, queue.parentId]),
	);
	let parentUpdates = 0;
	for (const queueId of queueIds.values()) {
		const wanted = parentIds.get(queueId) ?? null;
		if (currentParents.get(queueId) === wanted) continue;
		await tx
			.update(queues)
			.set({ parentId: wanted, updatedAt: new Date() })
			.where(eq(queues.id, queueId));
		parentUpdates++;
	}
	if (parentUpdates > 0) {
		const rowCounts = counts.queues ?? emptyCounts();
		rowCounts.updated += parentUpdates;
		counts.queues = rowCounts;
	}

	await importSlaMetrics(tx, data.metrics, deskId, context, counts);
}

async function importSlaMetrics(
	tx: Executor,
	metrics: JiraSlaMetric[],
	deskId: string,
	context: ServiceDeskImportContext,
	counts: ImportCounts,
) {
	const metricResult = await upsertRows(
		tx,
		slaMetrics,
		metrics.map((metric) => ({
			sourceId: String(metric.id),
			deskId,
			name: metric.name,
			customerVisible: metric.customerVisible ?? false,
			startConditions: mapConditions(metric.config?.definition?.start),
			pauseConditions: mapConditions(metric.config?.definition?.pause),
			stopConditions: mapConditions(metric.config?.definition?.stop),
		})),
		(row) => `${row.deskId}:${row.sourceId}`,
	);
	mergeCounts(counts, "sla_metrics", metricResult.counts);

	const goalRows = metrics.flatMap((metric) => {
		const metricId = metricResult.ids.get(`${deskId}:${metric.id}`);
		if (!metricId) {
			throw new Error(`SLA metric ${metric.id} was not imported`);
		}
		context.serviceDeskMaps.metricIds.set(
			`${context.projectKey}:${metric.id}`,
			metricId,
		);
		return (metric.config?.goals ?? []).map((goal, sequence) => {
			const calendarId = context.maps.calendarIds.get(String(goal.calendarId));
			if (!calendarId) {
				throw new Error(
					`SLA goal ${goal.id}: calendar ${goal.calendarId} was not imported`,
				);
			}
			return {
				sourceId: `${deskId}:${metric.id}:${goal.id}`,
				metricId,
				jql: goal.jqlQuery ?? "",
				goalMinutes:
					goal.duration === undefined
						? null
						: Math.round(goal.duration / MINUTE_MS),
				calendarId,
				sequence,
			};
		});
	});
	const goalResult = await upsertRows(tx, slaGoals, goalRows, (row) =>
		String(row.sourceId),
	);
	mergeCounts(counts, "sla_goals", goalResult.counts);
}

function timeOf(value: JiraSlaCycle["startTime"]) {
	if (!value) return null;
	if (typeof value.epochMillis === "number") return new Date(value.epochMillis);
	const raw = value.iso8601 ?? value.jira;
	if (!raw) return null;
	const date = new Date(raw.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
	return Number.isNaN(date.getTime()) ? null : date;
}

function millisOf(value: { millis?: number } | undefined) {
	return typeof value?.millis === "number" ? value.millis : null;
}

function cycleRow(
	issueId: string,
	metricId: string,
	cycleNumber: number,
	cycle: JiraSlaCycle,
) {
	const startedAt = timeOf(cycle.startTime);
	if (!startedAt) {
		throw new Error(`SLA cycle ${cycleNumber} has no start time`);
	}
	const goalMillis = millisOf(cycle.goalDuration);
	const elapsedMillis = millisOf(cycle.elapsedTime);
	const remainingMillis = millisOf(cycle.remainingTime);
	return {
		issueId,
		metricId,
		cycleNumber,
		startedAt,
		stoppedAt: timeOf(cycle.stopTime),
		goalMinutes:
			goalMillis === null ? null : Math.round(goalMillis / MINUTE_MS),
		elapsedMinutes:
			elapsedMillis === null ? 0 : Math.round(elapsedMillis / MINUTE_MS),
		remainingMinutes:
			remainingMillis === null ? null : Math.round(remainingMillis / MINUTE_MS),
		breached: cycle.breached ?? false,
	};
}

export async function importIssueSla(
	tx: Executor,
	data: JiraIssueData,
	issueId: string,
	projectKey: string,
	serviceDeskMaps: ServiceDeskMaps,
	counts: ImportCounts,
): Promise<string[]> {
	if (!data.sla?.values?.length) return [];
	const rows = data.sla.values.flatMap((metric) => {
		const metricId = serviceDeskMaps.metricIds.get(
			`${projectKey}:${metric.id}`,
		);
		if (!metricId) {
			throw new Error(
				`${data.issue.key}: SLA metric ${metric.id} was not imported`,
			);
		}
		const cycles = [...(metric.completedCycles ?? [])];
		if (metric.ongoingCycle) cycles.push(metric.ongoingCycle);
		return cycles.map((cycle, index) =>
			cycleRow(issueId, metricId, index + 1, cycle),
		);
	});
	const result = await upsertRows(
		tx,
		slaImportedCycles,
		rows,
		(row) => `${row.issueId}:${row.metricId}:${row.cycleNumber}`,
	);
	mergeCounts(counts, "sla_imported_cycles", result.counts);
	return [...result.ids.values()];
}

export async function importAutomationRules(
	tx: Executor,
	rules: JiraAutomationRule[],
	maps: {
		projectSourceIds: Map<string, string>;
		deskIds: Map<string, string>;
	},
	counts: ImportCounts,
) {
	const rows = rules
		.filter(
			(rule) =>
				!rule.projects ||
				rule.projects.length === 0 ||
				rule.projects.some((project) =>
					maps.projectSourceIds.has(project.projectId),
				),
		)
		.map((rule) => {
			const deskKeys = new Set<string>();
			for (const project of rule.projects ?? []) {
				const projectId = maps.projectSourceIds.get(project.projectId);
				if (projectId) deskKeys.add(projectId);
			}
			const deskId =
				deskKeys.size === 1
					? (maps.deskIds.get([...deskKeys][0]) ?? null)
					: null;
			const trigger = rule.trigger ?? {};
			const triggerValue = (trigger.value ?? {}) as Record<string, unknown>;
			const actions = (rule.components ?? []).map((component) => ({
				type: component.type,
				value: component.value,
			}));
			return {
				sourceId: `GLOBAL:${rule.id}`,
				deskId,
				name: rule.name,
				enabled: rule.state === "ENABLED",
				trigger: {
					type: trigger.type ?? null,
					eventKey: triggerValue.eventKey ?? null,
				},
				conditions: rule.conditions ?? [],
				actions,
				raw: rule as Record<string, unknown>,
			};
		});
	const result = await upsertRows(tx, automationRules, rows, (row) =>
		String(row.sourceId),
	);
	mergeCounts(counts, "automation_rules", result.counts);
}

export function emptyServiceDeskMaps(): ServiceDeskMaps {
	return {
		projectSourceIds: new Map(),
		calendarIds: new Map(),
		requestTypeIds: new Map(),
		metricIds: new Map(),
		deskIds: new Map(),
		customerRequestTypeFieldId: null,
	};
}
