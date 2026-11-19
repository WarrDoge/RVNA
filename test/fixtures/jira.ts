import type {
	JiraDataset,
	JiraIssue,
	JiraProjectData,
	JiraUser,
	JiraWorkflowData,
} from "../../src/importer/types.ts";

export const fixtureBaseUrl = "https://jira.example.test";
export const fixtureProjectKey = "FIXT";
export const fixtureWorkflowName = "Fixture Workflow";

export const fixtureFieldIds = {
	storyPoints: "customfield_20001",
	sprint: "customfield_20002",
	epicLink: "customfield_20003",
	rank: "customfield_20004",
} as const;

const reporter: JiraUser = {
	key: "FIXTUREUSER1",
	name: "fixture_reporter",
	emailAddress: "reporter@example.test",
	displayName: "Fixture Reporter",
	active: true,
	avatarUrls: { "48x48": "https://jira.example.test/avatar/reporter.png" },
};

const other: JiraUser = {
	key: "FIXTUREUSER2",
	name: "fixture_other",
	emailAddress: "other@example.test",
	displayName: "Fixture Other",
	active: true,
};

const issueType = {
	id: "fixture-type-task",
	name: "Fixture Task",
	description: "An invented issue type",
	subtask: false,
	iconUrl: "https://jira.example.test/icon/task.png",
};

const subtaskType = {
	id: "fixture-type-subtask",
	name: "Fixture Sub-task",
	description: "An invented sub-task type",
	subtask: true,
};

const todo = {
	id: "fixture-status-todo",
	name: "Fixture To Do",
	statusCategory: { key: "new" },
};

const done = {
	id: "fixture-status-done",
	name: "Fixture Done",
	statusCategory: { key: "done" },
};

const priority = {
	id: "fixture-priority",
	name: "Fixture Priority",
	statusColor: "#123456",
};

const resolution = {
	id: "fixture-resolution",
	name: "Fixture Resolution",
	description: "An invented resolution",
};

const linkType = {
	id: "fixture-link",
	name: "Fixture Relates",
	inward: "is related to",
	outward: "relates to",
};

const component = {
	id: "fixture-component",
	name: "Fixture Component",
	description: "An invented component",
	lead: other,
};

const version = {
	id: "fixture-version",
	name: "Fixture 1.0",
	description: "An invented version",
	releaseDate: "2026-02-03",
	released: true,
	archived: false,
};

const workflow: JiraWorkflowData = {
	name: fixtureWorkflowName,
	description: "An invented workflow",
	layout: {
		statuses: [
			{ id: "S<1>", name: "Fixture To Do", statusId: todo.id },
			{ id: "S<2>", name: "Fixture Done", statusId: done.id },
			{ id: "I<1>", name: "Create" },
		],
		transitions: [
			{
				id: "A<1:S<1>:S<2>>",
				name: "Fixture Done",
				sourceId: "S<1>",
				targetId: "S<2>",
				globalTransition: true,
				screenId: 9001,
				hasResolutionField: true,
			},
			{
				id: "A<2:S<1>:S<2>>",
				name: "Fixture Done",
				sourceId: "S<1>",
				targetId: "S<2>",
				globalTransition: false,
				screenId: 9002,
				hasResolutionField: false,
			},
			{
				id: "A<3:S<2>:S<1>>",
				name: "Fixture Reopen",
				sourceId: "S<2>",
				targetId: "S<1>",
				globalTransition: false,
			},
			{
				id: "IA<1:I<1>:S<1>>",
				name: "Create",
				sourceId: "I<1>",
				targetId: "S<1>",
				initial: true,
			},
		],
	},
};

function issue(
	overrides: Partial<JiraIssue> & {
		id: string;
		key: string;
		fields: JiraIssue["fields"];
	},
): JiraIssue {
	return {
		...overrides,
		renderedFields: {
			description: `<p>Fixture description for ${overrides.key}.</p>`,
			...overrides.renderedFields,
		},
	};
}

const firstIssue = issue({
	id: "fixture-issue-1",
	key: "FIXT-1",
	fields: {
		summary: "Fixture issue one",
		description: "Fixture wiki description",
		environment: "Fixture environment",
		created: "2026-01-02T03:04:05.000+0000",
		updated: "2026-01-03T04:05:06.000+0000",
		resolutiondate: null,
		duedate: "2026-01-20",
		timeoriginalestimate: 3600,
		timeestimate: 1800,
		timespent: 900,
		labels: ["fixture", "alpha"],
		components: [component],
		fixVersions: [version],
		versions: [],
		issuetype: issueType,
		status: todo,
		priority,
		resolution: null,
		project: {
			id: "fixture-project",
			key: fixtureProjectKey,
			name: "Fixture Project",
		},
		reporter,
		assignee: other,
		creator: reporter,
		parent: null,
		subtasks: [],
		issuelinks: [
			{
				id: "fixture-link-1",
				type: linkType,
				outwardIssue: { key: "FIXT-3" },
			},
		],
		attachment: [],
		comment: { total: 0, comments: [] },
		worklog: { total: 0, worklogs: [] },
		watches: { watchCount: 1 },
		[fixtureFieldIds.epicLink]: "FIXT-2",
		[fixtureFieldIds.storyPoints]: 3,
		[fixtureFieldIds.rank]: "0|i00001:",
		[fixtureFieldIds.sprint]: ["Fixture Sprint 1"],
		customfield_99001: { id: "fixture-option-1", value: "Option One" },
	},
	renderedFields: {
		description: `<p>Fixture description with <a href="${fixtureBaseUrl}/browse/FIXT-2">a link</a> and <img src="${fixtureBaseUrl}/secure/thumbnail/99999/picture.png" onerror="alert(1)">.</p>`,
	},
	changelog: {
		total: 1,
		histories: [
			{
				id: "fixture-history-1",
				author: reporter,
				created: "2026-01-04T05:06:07.000+0000",
				items: [
					{
						field: "status",
						fieldtype: "jira",
						from: todo.id,
						fromString: todo.name,
						to: done.id,
						toString: done.name,
					},
				],
			},
		],
	},
});

const secondIssue = issue({
	id: "fixture-issue-2",
	key: "FIXT-2",
	fields: {
		summary: "Fixture issue two",
		description: null,
		created: "2026-01-02T03:04:05.000+0000",
		updated: "2026-01-02T03:04:05.000+0000",
		labels: [],
		components: [],
		fixVersions: [],
		versions: [],
		issuetype: issueType,
		status: done,
		priority,
		resolution,
		project: {
			id: "fixture-project",
			key: fixtureProjectKey,
			name: "Fixture Project",
		},
		reporter,
		assignee: null,
		creator: reporter,
		parent: null,
		subtasks: [],
		issuelinks: [],
		attachment: [],
		comment: { total: 0, comments: [] },
		worklog: { total: 0, worklogs: [] },
		watches: { watchCount: 0 },
	},
});

const thirdIssue = issue({
	id: "fixture-issue-3",
	key: "FIXT-3",
	fields: {
		summary: "Fixture sub-task",
		description: "Fixture sub-task description",
		created: "2026-01-05T06:07:08.000+0000",
		updated: "2026-01-05T06:07:08.000+0000",
		labels: [],
		components: [],
		fixVersions: [],
		versions: [],
		issuetype: subtaskType,
		status: todo,
		priority,
		resolution: null,
		project: {
			id: "fixture-project",
			key: fixtureProjectKey,
			name: "Fixture Project",
		},
		reporter,
		assignee: reporter,
		creator: reporter,
		parent: { key: "FIXT-1" },
		subtasks: [],
		issuelinks: [],
		attachment: [],
		comment: { total: 0, comments: [] },
		worklog: { total: 0, worklogs: [] },
		watches: { watchCount: 0 },
	},
});

const project: JiraProjectData = {
	project: {
		id: "fixture-project",
		key: fixtureProjectKey,
		name: "Fixture Project",
		description: "An invented project",
		lead: reporter,
		avatarUrls: { "48x48": "https://jira.example.test/avatar/project.png" },
		projectTypeKey: "software",
		archived: false,
		projectCategory: { id: "fixture-category", name: "Fixture Category" },
		issueTypes: [issueType, subtaskType],
		components: [component],
		versions: [version],
	},
	issueTypes: [issueType, subtaskType],
	components: [component],
	versions: [version],
	statusesByIssueType: [
		{ id: issueType.id, name: issueType.name, statuses: [todo, done] },
		{ id: subtaskType.id, name: subtaskType.name, statuses: [todo, done] },
	],
};

export function fixtureDataset(): JiraDataset {
	return {
		users: [reporter, other],
		issueTypes: [issueType, subtaskType],
		priorities: [priority],
		resolutions: [resolution],
		statuses: [todo, done],
		linkTypes: [linkType],
		fields: [
			{
				id: fixtureFieldIds.storyPoints,
				name: "Story Points",
				custom: true,
				schema: {
					type: "number",
					custom: "com.atlassian.jira.plugin.system.customfieldtypes:float",
				},
			},
			{
				id: fixtureFieldIds.sprint,
				name: "Sprint",
				custom: true,
				schema: {
					type: "array",
					custom: "com.pyxis.greenhopper.jira:gh-sprint",
				},
			},
			{
				id: fixtureFieldIds.epicLink,
				name: "Epic Link",
				custom: true,
				schema: {
					type: "any",
					custom: "com.pyxis.greenhopper.jira:gh-epic-link",
				},
			},
			{
				id: fixtureFieldIds.rank,
				name: "Rank",
				custom: true,
				schema: {
					type: "string",
					custom: "com.pyxis.greenhopper.jira:gh-lexo-rank",
				},
			},
			{
				id: "customfield_99001",
				name: "Fixture Select",
				custom: true,
				schema: {
					type: "option",
					custom: "com.atlassian.jira.plugin.system.customfieldtypes:select",
				},
			},
		],
		workflows: [workflow],
		fieldOptions: [
			{
				fieldId: "customfield_99001",
				options: [
					{ id: "fixture-option-1", value: "Option One" },
					{
						id: "fixture-option-2",
						value: "Option Two",
						children: [{ id: "fixture-option-2-1", value: "Option Two Child" }],
					},
				],
			},
		],
		projects: [project],
		issues: [
			{
				issue: firstIssue,
				comments: [
					{
						id: "fixture-comment-1",
						author: reporter,
						body: "Fixture public comment",
						renderedBody: "<p>Fixture public comment</p>",
						created: "2026-01-06T07:08:09.000+0000",
						updated: "2026-01-06T07:08:09.000+0000",
						properties: [
							{ key: "sd.public.comment", value: { internal: false } },
						],
					},
					{
						id: "fixture-comment-2",
						author: other,
						body: "Fixture internal comment",
						renderedBody: "<p>Fixture internal comment</p>",
						created: "2026-01-06T08:09:10.000+0000",
						updated: "2026-01-06T08:09:10.000+0000",
						properties: [
							{ key: "sd.public.comment", value: { internal: true } },
						],
					},
				],
				worklogs: [
					{
						id: "fixture-worklog-1",
						author: reporter,
						started: "2026-01-07T09:10:11.000+0000",
						timeSpentSeconds: 900,
						comment: "Fixture worklog",
					},
				],
				watchers: [reporter],
				histories: firstIssue.changelog?.histories ?? [],
				attachments: [],
			},
			{
				issue: secondIssue,
				comments: [],
				worklogs: [],
				watchers: [],
				histories: [],
				attachments: [],
			},
			{
				issue: thirdIssue,
				comments: [],
				worklogs: [],
				watchers: [],
				histories: [],
				attachments: [],
			},
		],
	};
}
