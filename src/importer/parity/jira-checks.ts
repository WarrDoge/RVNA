import {
	check,
	compareSets,
	compareSetsByKey,
	skipped,
	sorted,
	symmetricDifference,
} from "./checks.ts";
import type {
	CheckResult,
	JiraDatabaseSnapshot,
	JiraIssueData,
	JiraLiveSnapshot,
} from "./types.ts";

const issueMetrics = [
	["jira.issue.comments", "comments"],
	["jira.issue.worklogs", "worklogs"],
	["jira.issue.attachments", "attachments"],
	["jira.issue.attachment_bytes", "attachmentBytes"],
	["jira.issue.links", "links"],
	["jira.issue.watchers", "watchers"],
	["jira.issue.subtasks", "subtasks"],
	["jira.issue.changelog", "history"],
] as const;

function projectIssueKeys(
	issues: Map<string, JiraIssueData>,
	projectKey: string,
) {
	return new Set(
		[...issues.values()]
			.filter((issue) => issue.projectKey === projectKey)
			.map((issue) => issue.key),
	);
}

function issuesByProjectStatus(issues: Map<string, JiraIssueData>) {
	const result = new Map<string, Map<string, Set<string>>>();
	for (const issue of issues.values()) {
		const statuses = result.get(issue.projectKey) ?? new Map();
		const keys = statuses.get(issue.status) ?? new Set();
		keys.add(issue.key);
		statuses.set(issue.status, keys);
		result.set(issue.projectKey, statuses);
	}
	return result;
}

function updatedTime(value: string | null) {
	if (!value) return null;
	const time = Date.parse(value);
	return Number.isNaN(time) ? null : time;
}

function queueUsesCurrentUser(jql: string) {
	return /currentuser\s*\(\s*\)/i.test(jql);
}

export interface JiraCheckResult {
	checks: CheckResult[];
	watermark: string | null;
	changedSinceImport: string[];
	notes: string[];
}

export function jiraChecks(
	live: JiraLiveSnapshot,
	database: JiraDatabaseSnapshot,
): JiraCheckResult {
	const checks: CheckResult[] = [];
	const notes: string[] = [];
	const localIssues = database.localIssues ?? new Set<string>();
	const liveIssues = new Map(
		[...live.issues].filter(([key]) => !localIssues.has(key)),
	);
	const dbIssues = new Map(
		[...database.issues].filter(([key]) => !localIssues.has(key)),
	);
	const localCheck = check(
		"jira.local_changes",
		localIssues.size,
		localIssues.size,
	);
	localCheck.note = `local changes kept: ${localIssues.size}`;
	checks.push(localCheck);
	const liveProjects = new Map(
		live.projects.map((project) => [project.key, project]),
	);
	const projectKeys = sorted([
		...live.projects.map((project) => project.key),
		...database.projects,
	]);
	const liveByProject = new Map<string, Set<string>>();
	const dbByProject = new Map<string, Set<string>>();
	for (const key of projectKeys) {
		liveByProject.set(key, projectIssueKeys(liveIssues, key));
		dbByProject.set(key, projectIssueKeys(dbIssues, key));
	}

	checks.push(
		compareSets(
			"jira.projects",
			live.projects.map((project) => project.key),
			database.projects,
		),
	);

	for (const key of projectKeys) {
		const liveKeys = liveByProject.get(key) ?? new Set<string>();
		const dbKeys = dbByProject.get(key) ?? new Set<string>();
		checks.push(
			check(
				`jira.project.${key}.issues`,
				localIssues.size > 0
					? liveKeys.size
					: (liveProjects.get(key)?.issueTotal ?? liveKeys.size),
				dbKeys.size,
				symmetricDifference(liveKeys, dbKeys),
			),
		);
	}

	const liveStatuses = issuesByProjectStatus(liveIssues);
	const dbStatuses = issuesByProjectStatus(dbIssues);
	for (const key of projectKeys) {
		const liveMap = liveStatuses.get(key) ?? new Map<string, Set<string>>();
		const dbMap = dbStatuses.get(key) ?? new Map<string, Set<string>>();
		for (const status of sorted([
			...new Set([...liveMap.keys(), ...dbMap.keys()]),
		])) {
			const liveSet = liveMap.get(status) ?? new Set<string>();
			const dbSet = dbMap.get(status) ?? new Set<string>();
			checks.push(
				check(
					`jira.project.${key}.status.${status}`,
					liveSet.size,
					dbSet.size,
					symmetricDifference(liveSet, dbSet),
				),
			);
		}
	}

	for (const [name, field] of issueMetrics) {
		let liveTotal = 0;
		let databaseTotal = 0;
		const details: string[] = [];
		for (const issue of liveIssues.values()) {
			const dbIssue = dbIssues.get(issue.key);
			liveTotal += Number(issue[field]);
			if (!dbIssue) {
				details.push(issue.key);
				continue;
			}
			databaseTotal += Number(dbIssue[field]);
			if (Number(dbIssue[field]) !== Number(issue[field])) {
				details.push(issue.key);
			}
		}
		for (const key of dbIssues.keys()) {
			if (!liveIssues.has(key)) {
				databaseTotal += Number(dbIssues.get(key)?.[field] ?? 0);
				details.push(key);
			}
		}
		checks.push(check(name, liveTotal, databaseTotal, details));
	}

	const equalityMetrics: {
		name: string;
		equal: (liveIssue: JiraIssueData, dbIssue: JiraIssueData) => boolean;
	}[] = [
		{
			name: "jira.issue.status",
			equal: (left, right) => left.status === right.status,
		},
		{
			name: "jira.issue.resolution",
			equal: (left, right) => left.resolution === right.resolution,
		},
		{
			name: "jira.issue.assignee",
			equal: (left, right) => left.assignee === right.assignee,
		},
		{
			name: "jira.issue.updated",
			equal: (left, right) =>
				updatedTime(left.updated) !== null &&
				updatedTime(left.updated) === updatedTime(right.updated),
		},
	];
	for (const metric of equalityMetrics) {
		let matched = 0;
		const details: string[] = [];
		for (const issue of liveIssues.values()) {
			const dbIssue = dbIssues.get(issue.key);
			if (dbIssue && metric.equal(issue, dbIssue)) {
				matched++;
			} else {
				details.push(issue.key);
			}
		}
		for (const key of dbIssues.keys()) {
			if (!liveIssues.has(key)) details.push(key);
		}
		checks.push(check(metric.name, liveIssues.size, matched, details));
	}

	let watermark: string | null = null;
	for (const issue of dbIssues.values()) {
		const time = updatedTime(issue.updated);
		if (time === null) continue;
		if (watermark === null || time > Date.parse(watermark)) {
			watermark = issue.updated;
		}
	}
	const changedSinceImport: string[] = [];
	if (watermark) {
		const watermarkTime = Date.parse(watermark);
		for (const issue of liveIssues.values()) {
			const time = updatedTime(issue.updated);
			if (time !== null && time > watermarkTime)
				changedSinceImport.push(issue.key);
		}
	}

	const userKey = (user: { key: string | null; username: string }) =>
		user.key ?? user.username;
	for (const active of [true, false]) {
		const liveUsers = new Set(
			live.users.filter((user) => user.active === active).map(userKey),
		);
		const dbUsers = new Set(
			database.users.filter((user) => user.active === active).map(userKey),
		);
		checks.push(
			check(
				active ? "jira.users.active" : "jira.users.inactive",
				liveUsers.size,
				dbUsers.size,
				symmetricDifference(liveUsers, dbUsers),
			),
		);
	}

	checks.push(
		compareSets("jira.issue_types", live.issueTypes, database.issueTypes),
		compareSets("jira.statuses", live.statuses, database.statuses),
		compareSets("jira.priorities", live.priorities, database.priorities),
		compareSets("jira.resolutions", live.resolutions, database.resolutions),
		compareSets("jira.link_types", live.linkTypes, database.linkTypes),
	);

	for (const key of projectKeys) {
		const liveProject = liveProjects.get(key);
		checks.push(
			compareSets(
				`jira.project.${key}.versions`,
				liveProject?.versions ?? [],
				database.versionsByProject.get(key) ?? [],
			),
			compareSets(
				`jira.project.${key}.components`,
				liveProject?.components ?? [],
				database.componentsByProject.get(key) ?? [],
			),
		);
	}

	const dbWorkflows = new Map<
		string,
		(typeof database.projectWorkflows)[number][]
	>();
	for (const row of database.projectWorkflows) {
		const list = dbWorkflows.get(row.projectKey) ?? [];
		list.push(row);
		dbWorkflows.set(row.projectKey, list);
	}
	for (const key of projectKeys) {
		const liveStatusesByType =
			liveProjects.get(key)?.statusesByIssueType ?? new Map<string, string[]>();
		const rows = dbWorkflows.get(key) ?? [];
		let matched = 0;
		const details: string[] = [];
		const defaultRow = rows.find((row) => row.issueTypeSourceId === null);
		if (liveStatusesByType.size === 0) {
			for (const row of rows) {
				details.push(`${key}:${row.issueTypeSourceId ?? "default"}`);
			}
		}
		for (const [issueTypeId, statuses] of liveStatusesByType) {
			const row =
				rows.find((item) => item.issueTypeSourceId === issueTypeId) ??
				defaultRow;
			if (!row || symmetricDifference(statuses, row.statuses).length > 0) {
				details.push(`${key}:${issueTypeId}`);
			} else {
				matched++;
			}
		}
		for (const row of rows) {
			if (
				row.issueTypeSourceId !== null &&
				!liveStatusesByType.has(row.issueTypeSourceId) &&
				!defaultRow
			) {
				details.push(`${key}:${row.issueTypeSourceId}`);
			}
		}
		checks.push(
			check(
				`jira.project.${key}.workflows`,
				liveStatusesByType.size,
				matched,
				details,
			),
		);
	}

	if (database.workflowResolutionTransitions === null) {
		checks.push(
			skipped(
				"jira.workflow.resolution_screens",
				"workflow resolution columns are not present",
			),
		);
	} else if (live.workflowResolutionSkipped) {
		checks.push(
			skipped(
				"jira.workflow.resolution_screens",
				"workflow layouts are skipped without --private-apis",
			),
		);
	} else {
		checks.push(
			compareSetsByKey(
				"jira.workflow.resolution_screens",
				live.workflowResolutionTransitions,
				database.workflowResolutionTransitions,
			),
		);
	}

	if (database.serviceDesks === null) {
		for (const name of [
			"jira.servicedesk.request_types",
			"jira.servicedesk.queues",
			"jira.servicedesk.sla_metrics",
		]) {
			checks.push(skipped(name, "service desk tables are not present"));
		}
	} else {
		const liveDesks = live.serviceDesks ?? [];
		const liveByKey = new Map(liveDesks.map((desk) => [desk.projectKey, desk]));
		const dbByKey = new Map(
			database.serviceDesks.map((desk) => [desk.projectKey, desk]),
		);
		for (const key of sorted([...liveByKey.keys(), ...dbByKey.keys()])) {
			const liveDesk = liveByKey.get(key);
			const dbDesk = dbByKey.get(key);
			checks.push(
				compareSets(
					`jira.servicedesk.${key}.request_types`,
					liveDesk?.requestTypes ?? [],
					dbDesk?.requestTypes ?? [],
				),
			);
			const liveQueues = new Map(
				(liveDesk?.queues ?? []).map((queue) => [queue.id, queue]),
			);
			const dbQueues = new Map(
				(dbDesk?.queues ?? []).map((queue) => [queue.id, queue]),
			);
			let liveIssueTotal = 0;
			let dbIssueTotal = 0;
			const queueDetails: string[] = [];
			for (const id of sorted([...liveQueues.keys(), ...dbQueues.keys()])) {
				const liveQueue = liveQueues.get(id);
				const dbQueue = dbQueues.get(id);
				if (!liveQueue || !dbQueue) {
					queueDetails.push(id);
					if (liveQueue && !queueUsesCurrentUser(liveQueue.jql)) {
						liveIssueTotal += liveQueue.issueCount ?? 0;
					}
					if (dbQueue && !queueUsesCurrentUser(dbQueue.jql)) {
						dbIssueTotal += dbQueue.issueCount ?? 0;
					}
					continue;
				}
				const liveCount = liveQueue.issueCount ?? 0;
				const dbCount = dbQueue.issueCount ?? 0;
				if (
					!queueUsesCurrentUser(liveQueue.jql) &&
					!queueUsesCurrentUser(dbQueue.jql) &&
					liveCount !== dbCount
				) {
					queueDetails.push(id);
				}
				if (!queueUsesCurrentUser(liveQueue.jql)) liveIssueTotal += liveCount;
				if (!queueUsesCurrentUser(dbQueue.jql)) dbIssueTotal += dbCount;
			}
			checks.push(
				check(
					`jira.servicedesk.${key}.queues`,
					liveIssueTotal,
					dbIssueTotal,
					queueDetails,
				),
			);
			checks.push(
				live.serviceDeskMetricsSkipped
					? skipped(
							`jira.servicedesk.${key}.sla_metrics`,
							"SLA metrics are skipped without --private-apis",
						)
					: compareSets(
							`jira.servicedesk.${key}.sla_metrics`,
							liveDesk?.metrics ?? [],
							dbDesk?.metrics ?? [],
						),
			);
		}
	}

	if (database.agile === null) {
		for (const name of [
			"jira.agile.boards",
			"jira.agile.sprints",
			"jira.agile.sprint_issues",
		]) {
			checks.push(skipped(name, "agile tables are not present"));
		}
	} else {
		const liveBoards = live.agile?.boards ?? [];
		const dbBoards = database.agile.boards;
		checks.push(
			compareSets(
				"jira.agile.boards",
				liveBoards.map((board) => board.id),
				dbBoards.map((board) => board.id),
			),
		);
		const liveSprints = new Map<string, string>();
		const dbSprints = new Map<string, string>();
		const liveSprintIssues = new Map<string, number>();
		const dbSprintIssues = new Map<string, number>();
		for (const board of liveBoards) {
			for (const sprint of board.sprints) {
				liveSprints.set(`${board.id}:${sprint.id}`, sprint.state);
				liveSprintIssues.set(sprint.id, sprint.issueCount);
			}
		}
		for (const board of dbBoards) {
			for (const sprint of board.sprints) {
				dbSprints.set(`${board.id}:${sprint.id}`, sprint.state);
				dbSprintIssues.set(sprint.id, sprint.issueCount);
			}
		}
		const sprintDetails: string[] = [];
		for (const id of sorted([
			...new Set([...liveSprints.keys(), ...dbSprints.keys()]),
		])) {
			if (liveSprints.get(id) !== dbSprints.get(id)) sprintDetails.push(id);
		}
		checks.push(
			check(
				"jira.agile.sprints",
				liveSprints.size,
				dbSprints.size,
				sprintDetails,
			),
		);
		const issueDetails: string[] = [];
		for (const id of sorted([
			...new Set([...liveSprintIssues.keys(), ...dbSprintIssues.keys()]),
		])) {
			if (liveSprintIssues.get(id) !== dbSprintIssues.get(id)) {
				issueDetails.push(id);
			}
		}
		let liveIssues = 0;
		let dbIssues = 0;
		for (const count of liveSprintIssues.values()) liveIssues += count;
		for (const count of dbSprintIssues.values()) dbIssues += count;
		checks.push(
			check("jira.agile.sprint_issues", liveIssues, dbIssues, issueDetails),
		);
	}

	if (database.filters === null) {
		checks.push(
			skipped("jira.filters", "filters table has no source_id, name or jql"),
		);
	} else {
		const liveFilters = new Map(
			(live.filters ?? []).map((filter) => [filter.id, filter]),
		);
		const databaseFilters = new Map(
			database.filters.map((filter) => [filter.id, filter]),
		);
		const filterDetails: string[] = [];
		for (const id of sorted([
			...new Set([...liveFilters.keys(), ...databaseFilters.keys()]),
		])) {
			const filter = databaseFilters.get(id);
			const current = liveFilters.get(id);
			if (
				!filter ||
				!current ||
				current.name !== filter.name ||
				current.jql !== filter.jql
			) {
				filterDetails.push(id);
			}
		}
		checks.push(
			check(
				"jira.filters",
				liveFilters.size,
				database.filters.length,
				filterDetails,
			),
		);
	}

	return {
		checks,
		watermark,
		changedSinceImport: changedSinceImport.sort(),
		notes,
	};
}
