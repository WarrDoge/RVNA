import type {
	JiraDataset,
	JiraIssue,
	JiraIssueData,
	JiraProjectData,
	JiraUser,
} from "../../src/importer/types.ts";

export const serviceDeskProjectKey = "SDFIX";
export const serviceDeskBaseUrl = "https://jira.example.test";
export const serviceDeskCalendarIds = ["9101", "9102"];

const reporter: JiraUser = {
	key: "SDUSER1",
	name: "sd_fixture_reporter",
	emailAddress: "sd-reporter@example.test",
	displayName: "Fixture Requester",
	active: true,
};

const agent: JiraUser = {
	key: "SDUSER2",
	name: "sd_fixture_agent",
	emailAddress: "sd-agent@example.test",
	displayName: "Fixture Agent",
	active: true,
};

const issueType = {
	id: "fixture-sd-issue-type",
	name: "Fixture Request",
	description: "An invented request issue type",
	subtask: false,
};

const openStatus = {
	id: "fixture-sd-status-open",
	name: "Fixture Open",
	statusCategory: { key: "new" },
};

const closedStatus = {
	id: "fixture-sd-status-closed",
	name: "Fixture Closed",
	statusCategory: { key: "done" },
};

const priority = { id: "fixture-sd-priority", name: "Fixture Priority" };
const resolution = { id: "fixture-sd-resolution", name: "Fixture Done" };

const project = {
	id: "90900",
	key: serviceDeskProjectKey,
	name: "Fixture Service Desk",
	description: "An invented service desk",
	projectTypeKey: "service_desk",
	lead: agent,
	avatarUrls: {},
};

const projectData: JiraProjectData = {
	project: { ...project, issueTypes: [issueType] },
	issueTypes: [issueType],
	components: [],
	versions: [],
	statusesByIssueType: [
		{
			id: issueType.id,
			name: issueType.name,
			subtask: false,
			statuses: [openStatus, closedStatus],
		},
	],
};

const issueOne: JiraIssue = {
	id: "fixture-sd-issue-1",
	key: "SDFIX-1",
	fields: {
		summary: "Fixture request one",
		description: "One request",
		created: "2026-01-05T09:00:00.355+0000",
		updated: "2026-01-05T13:00:00.000+0000",
		issuetype: issueType,
		status: openStatus,
		priority,
		resolution: null,
		project,
		reporter,
		assignee: agent,
		creator: reporter,
		customfield_90003: { requestType: { id: "fixture-rt-1" } },
	},
	changelog: { total: 0, histories: [] },
};

const issueTwo: JiraIssue = {
	id: "fixture-sd-issue-2",
	key: "SDFIX-2",
	fields: {
		summary: "Fixture request two",
		description: "Two request",
		created: "2026-01-06T09:00:00.000+0000",
		updated: "2026-01-06T20:00:00.000+0000",
		resolutiondate: "2026-01-06T20:00:00.000+0000",
		issuetype: issueType,
		status: closedStatus,
		priority,
		resolution,
		project,
		reporter,
		assignee: null,
		creator: reporter,
		customfield_90003: { requestType: { id: "fixture-rt-2" } },
	},
	changelog: { total: 0, histories: [] },
};

const issueOneData: JiraIssueData = {
	issue: issueOne,
	comments: [],
	worklogs: [],
	watchers: [],
	histories: [],
	attachments: [],
	channel: "portal",
	sla: {
		values: [
			{
				id: "9101",
				name: "Fixture SLA",
				completedCycles: [
					{
						startTime: { epochMillis: Date.parse("2026-01-05T09:00:00Z") },
						stopTime: { epochMillis: Date.parse("2026-01-05T13:00:00Z") },
						breached: false,
						goalDuration: { millis: 28_800_000 },
						elapsedTime: { millis: 14_400_000 },
						remainingTime: { millis: 14_400_000 },
					},
				],
			},
		],
	},
};

const issueTwoData: JiraIssueData = {
	issue: issueTwo,
	comments: [],
	worklogs: [],
	watchers: [],
	histories: [],
	attachments: [],
	channel: "email",
	sla: {
		values: [
			{
				id: "9101",
				name: "Fixture SLA",
				completedCycles: [
					{
						startTime: { epochMillis: Date.parse("2026-01-06T09:00:00Z") },
						stopTime: { epochMillis: Date.parse("2026-01-06T20:00:00Z") },
						breached: true,
						goalDuration: { millis: 28_800_000 },
						elapsedTime: { millis: 36_000_000 },
						remainingTime: { millis: -7_200_000 },
					},
				],
			},
		],
	},
};

const weekdays = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
];

export function serviceDeskFixtureDataset(): JiraDataset {
	return {
		users: [reporter, agent],
		issueTypes: [issueType],
		priorities: [priority],
		resolutions: [resolution],
		statuses: [openStatus, closedStatus],
		linkTypes: [],
		fields: [
			{
				id: "customfield_90003",
				name: "Customer Request Type",
				custom: true,
			},
		],
		workflows: [],
		fieldOptions: [],
		projects: [projectData],
		issues: [issueOneData, issueTwoData],
		slaCalendars: [
			{
				id: 9101,
				name: "Fixture 9-5",
				timezoneId: "Etc/UTC",
				workingTimes: weekdays.slice(0, 5).map((weekday) => ({
					weekday,
					start: 32_400_000,
					end: 61_200_000,
				})),
				holidays: [],
			},
			{
				id: 9102,
				name: "Fixture 24/7",
				timezoneId: "UTC",
				workingTimes: weekdays.map((weekday) => ({
					weekday,
					start: 0,
					end: 86_400_000,
				})),
				holidays: [],
			},
		],
		serviceDesks: [
			{
				desk: {
					id: "9100",
					projectId: project.id,
					projectName: "Fixture Desk",
					projectKey: serviceDeskProjectKey,
					_links: {
						portal:
							"https://jira.example.test/rest/servicedeskapi/portals/9100",
					},
				},
				portal: {
					id: 9100,
					name: "Fixture Portal",
					description: "Welcome to the fixture desk",
				},
				groups: [{ id: "fixture-group-1", name: "Fixture Group" }],
				requestTypes: [
					{
						requestType: {
							id: "fixture-rt-1",
							name: "Request One",
							description: "The first request type",
							helpText: "Help for one",
							groupIds: ["fixture-group-1"],
							icon: { id: "fixture-icon-1" },
						},
						fields: [
							{ fieldId: "summary", name: "Summary", required: true },
							{
								fieldId: "description",
								name: "Details",
								description: "Tell us more",
								required: false,
							},
						],
					},
					{
						requestType: {
							id: "fixture-rt-2",
							name: "Request Two",
							groupIds: ["fixture-group-1"],
						},
						fields: [{ fieldId: "summary", name: "Summary", required: true }],
					},
					{
						requestType: { id: "fixture-rt-3", name: "Unused Request" },
						fields: [{ fieldId: "summary", name: "Summary", required: true }],
					},
				],
				queues: [
					{
						id: "fixture-queue-1",
						name: "All open",
						jql: "project = SDFIX AND resolution = Unresolved",
						fields: ["issuekey", "summary"],
						issueCount: 1,
					},
					{
						id: "fixture-queue-2",
						name: "↳ Mine",
						jql: "project = SDFIX AND assignee = currentUser()",
						fields: [],
						issueCount: 0,
					},
				],
				metrics: [
					{
						projectKey: serviceDeskProjectKey,
						id: 9101,
						name: "Fixture SLA",
						customerVisible: false,
						config: {
							definition: {
								start: [
									{
										factoryKey: "issue-created-sla-condition-factory",
										conditionId: "issue-created-hit-condition",
										type: "Start",
										name: "Issue Created",
									},
								],
								pause: [],
								stop: [
									{
										factoryKey: "resolution-sla-condition-factory",
										conditionId: "resolution-set-hit-condition",
										type: "Stop",
										name: "Resolution: Set",
									},
								],
							},
							goals: [
								{
									id: 9101,
									jqlQuery: 'issuetype = "Fixture Request"',
									duration: 28_800_000,
									calendarId: 9101,
								},
								{
									id: 9102,
									jqlQuery: "",
									duration: 14_400_000,
									calendarId: 9102,
									defaultGoal: true,
								},
							],
						},
					},
				],
				openAccess: false,
			},
		],
		automationRules: [
			{
				id: 9101,
				name: "Fixture Rule",
				state: "ENABLED",
				trigger: {
					type: "jira.issue.event.trigger:created",
					value: { eventKey: "jira:issue_created" },
				},
				conditions: [],
				components: [
					{
						type: "jira.issue.edit",
						value: { operations: [] },
					},
				],
				projects: [{ projectId: project.id, projectTypeKey: "service_desk" }],
			},
		],
	};
}
