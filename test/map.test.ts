import { describe, expect, test } from "vitest";
import {
	mapComment,
	mapHistory,
	mapIssue,
	mapIssueLink,
	mapWorkflowLayout,
	mapWorklog,
	matchWorkflow,
	parseJiraDate,
} from "../src/importer/map.ts";
import { fixtureBaseUrl, fixtureFieldIds } from "./fixtures/jira.ts";

const userIds = new Map([
	["FIXTUREUSER1", "user-1"],
	["fixture_reporter", "user-1"],
	["FIXTUREUSER2", "user-2"],
	["fixture_other", "user-2"],
]);

const issueIds = new Map([
	["FIXT-1", "issue-1"],
	["FIXT-2", "issue-2"],
	["FIXT-3", "issue-3"],
]);

function fixtureIssue() {
	return {
		id: "fixture-issue-1",
		key: "FIXT-1",
		fields: {
			summary: "Fixture issue one",
			description: "Fixture wiki description",
			environment: "Fixture environment",
			created: "2026-01-02T03:04:05.000+0000",
			updated: "2026-01-03T04:05:06.000+0000",
			resolutiondate: "2026-01-04T05:06:07.000+0000",
			duedate: "2026-01-20",
			timeoriginalestimate: 3600,
			timeestimate: 1800,
			timespent: 900,
			labels: ["fixture", "alpha"],
			components: [{ id: "fixture-component", name: "Fixture Component" }],
			fixVersions: [{ id: "fixture-version", name: "Fixture 1.0" }],
			versions: [{ id: "fixture-version", name: "Fixture 1.0" }],
			issuetype: { id: "fixture-type-task", name: "Fixture Task" },
			status: { id: "fixture-status-todo", name: "Fixture To Do" },
			priority: { id: "fixture-priority", name: "Fixture Priority" },
			resolution: {
				id: "fixture-resolution",
				name: "Fixture Resolution",
			},
			project: {
				id: "fixture-project",
				key: "FIXT",
				name: "Fixture Project",
			},
			reporter: {
				key: "FIXTUREUSER1",
				name: "fixture_reporter",
				displayName: "Fixture Reporter",
			},
			assignee: {
				key: "FIXTUREUSER2",
				name: "fixture_other",
				displayName: "Fixture Other",
			},
			creator: {
				key: "FIXTUREUSER1",
				name: "fixture_reporter",
				displayName: "Fixture Reporter",
			},
			parent: { key: "FIXT-1" },
			[fixtureFieldIds.epicLink]: "FIXT-2",
			[fixtureFieldIds.storyPoints]: 3,
			[fixtureFieldIds.rank]: "0|i00001:",
			[fixtureFieldIds.sprint]: ["Fixture Sprint 1"],
			customfield_99001: { id: "fixture-option-1", value: "Option One" },
			issuelinks: [
				{
					id: "fixture-link-1",
					type: {
						id: "fixture-link",
						name: "Fixture Relates",
						inward: "is related to",
						outward: "relates to",
					},
					outwardIssue: { key: "FIXT-3" },
				},
				{
					id: "fixture-link-2",
					type: {
						id: "fixture-link",
						name: "Fixture Relates",
						inward: "is related to",
						outward: "relates to",
					},
					inwardIssue: { key: "FIXT-3" },
				},
			],
		},
		renderedFields: {
			description: `<p>Fixture description with <a href="${fixtureBaseUrl}/browse/FIXT-2">a link</a> and <img src="${fixtureBaseUrl}/secure/thumbnail/12345/picture.png" onerror="alert(1)">.</p>`,
		},
		changelog: {
			total: 1,
			histories: [
				{
					id: "fixture-history-1",
					author: {
						key: "FIXTUREUSER1",
						name: "fixture_reporter",
						displayName: "Fixture Reporter",
					},
					created: "2026-01-04T05:06:07.000+0000",
					items: [
						{
							field: "status",
							fieldtype: "jira",
							from: "fixture-status-todo",
							fromString: "Fixture To Do",
							to: "fixture-status-done",
							toString: "Fixture Done",
						},
					],
				},
			],
		},
	};
}

const refs = {
	baseUrl: fixtureBaseUrl,
	projectId: "project-1",
	issueTypeId: "type-1",
	statusId: "status-1",
	priorityId: "priority-1",
	resolutionId: "resolution-1",
	userIds,
	issueIds,
	customFields: {
		storyPoints: fixtureFieldIds.storyPoints,
		sprint: fixtureFieldIds.sprint,
		epicLink: fixtureFieldIds.epicLink,
		rank: fixtureFieldIds.rank,
	},
};

describe("issue mapping", () => {
	test("keeps the milliseconds of Jira timestamps", () => {
		expect(parseJiraDate("2026-07-13T10:11:12.345+0300")?.toISOString()).toBe(
			"2026-07-13T07:11:12.345Z",
		);
		expect(parseJiraDate("2026-07-13T10:11:12.345Z")?.toISOString()).toBe(
			"2026-07-13T10:11:12.345Z",
		);
	});

	test("maps fields, parent, epic, labels, links and custom values", () => {
		const mapping = mapIssue(fixtureIssue(), refs);

		expect(mapping.row.key).toBe("FIXT-1");
		expect(mapping.row.number).toBe(1);
		expect(mapping.row.summary).toBe("Fixture issue one");
		expect(mapping.row.descriptionSource).toBe("Fixture wiki description");
		expect(mapping.row.descriptionHtml).toContain('href="/browse/FIXT-2"');
		expect(mapping.row.descriptionHtml).toContain(
			'src="/api/attachments/12345"',
		);
		expect(mapping.row.descriptionHtml).not.toContain("onerror");
		expect(mapping.row.reporterId).toBe("user-1");
		expect(mapping.row.assigneeId).toBe("user-2");
		expect(mapping.row.parentId).toBe("issue-1");
		expect(mapping.row.epicId).toBe("issue-2");
		expect(mapping.parentKey).toBe("FIXT-1");
		expect(mapping.epicKey).toBe("FIXT-2");
		expect(mapping.row.storyPoints).toBe(3);
		expect(mapping.row.originalEstimate).toBe(3600);
		expect(mapping.row.remainingEstimate).toBe(1800);
		expect(mapping.row.timeSpent).toBe(900);
		expect(mapping.row.dueDate).toBe("2026-01-20");
		expect(mapping.row.rank).toBe("0|i00001:");
		expect(mapping.row.created?.toISOString()).toBe("2026-01-02T03:04:05.000Z");
		expect(mapping.labels).toEqual(["fixture", "alpha"]);
		expect(mapping.componentSourceIds).toEqual(["fixture-component"]);
		expect(mapping.fixVersionSourceIds).toEqual(["fixture-version"]);
		expect(mapping.affectsVersionSourceIds).toEqual(["fixture-version"]);
		expect(mapping.row.custom).toEqual({
			customfield_99001: {
				id: "fixture-option-1",
				value: "Option One",
			},
			[fixtureFieldIds.sprint]: ["Fixture Sprint 1"],
		});
		expect(mapping.links).toEqual([
			{
				sourceId: "fixture-link-1",
				typeSourceId: "fixture-link",
				sourceKey: "FIXT-1",
				targetKey: "FIXT-3",
			},
			{
				sourceId: "fixture-link-2",
				typeSourceId: "fixture-link",
				sourceKey: "FIXT-3",
				targetKey: "FIXT-1",
			},
		]);
	});

	test("maps an inward link to the outward direction", () => {
		expect(
			mapIssueLink("FIXT-1", {
				id: "fixture-link",
				type: {
					id: "fixture-link",
					name: "Fixture Relates",
				},
				inwardIssue: { key: "FIXT-9" },
			}),
		).toEqual({
			sourceId: "fixture-link",
			typeSourceId: "fixture-link",
			sourceKey: "FIXT-9",
			targetKey: "FIXT-1",
		});
	});
});

describe("comment, worklog and history mapping", () => {
	test("detects internal service desk comments", () => {
		const row = mapComment(
			{
				id: "fixture-comment",
				author: {
					key: "FIXTUREUSER1",
					name: "fixture_reporter",
					displayName: "Fixture Reporter",
				},
				body: "Fixture internal",
				renderedBody: "<p>Fixture internal</p>",
				created: "2026-01-06T07:08:09.000+0000",
				updated: "2026-01-06T07:08:09.000+0000",
				properties: [{ key: "sd.public.comment", value: { internal: true } }],
			},
			"issue-1",
			{ baseUrl: fixtureBaseUrl, userIds },
		);

		expect(row.internal).toBe(true);
		expect(row.bodyHtml).toBe("<p>Fixture internal</p>");
		expect(row.authorId).toBe("user-1");
	});

	test("maps worklogs and history items", () => {
		const worklog = mapWorklog(
			{
				id: "fixture-worklog",
				author: {
					key: "FIXTUREUSER2",
					name: "fixture_other",
					displayName: "Fixture Other",
				},
				started: "2026-01-07T09:10:11.000+0000",
				timeSpentSeconds: 900,
				comment: "Fixture worklog",
			},
			"issue-1",
			{ userIds },
		);
		expect(worklog.seconds).toBe(900);
		expect(worklog.authorId).toBe("user-2");

		const history = mapHistory(
			{
				id: "fixture-history",
				author: {
					key: "FIXTUREUSER1",
					name: "fixture_reporter",
					displayName: "Fixture Reporter",
				},
				created: "2026-01-04T05:06:07.000+0000",
				items: [
					{
						field: "status",
						fieldtype: "jira",
						from: "fixture-status-todo",
						fromString: "Fixture To Do",
						to: "fixture-status-done",
						toString: "Fixture Done",
					},
				],
			},
			"issue-1",
			{ userIds },
		);
		expect(history.items).toEqual([
			{
				sourceId: null,
				field: "status",
				fieldType: "jira",
				fromValue: "fixture-status-todo",
				fromText: "Fixture To Do",
				toValue: "fixture-status-done",
				toText: "Fixture Done",
				sequence: 0,
			},
		]);
	});
});

describe("workflow layout", () => {
	const layout = {
		statuses: [
			{ id: "S<1>", name: "Fixture To Do", statusId: "fixture-status-todo" },
			{ id: "S<2>", name: "Fixture Done", statusId: "fixture-status-done" },
			{ id: "I<1>", name: "Create" },
		],
		transitions: [
			{
				id: "A<1:S<1>:S<2>>",
				name: "Global",
				sourceId: "S<1>",
				targetId: "S<2>",
				globalTransition: true,
			},
			{
				id: "A<2:S<1>:S<2>>",
				name: "Normal",
				sourceId: "S<1>",
				targetId: "S<2>",
			},
			{
				id: "IA<1:I<1>:S<1>>",
				name: "Create",
				sourceId: "I<1>",
				targetId: "S<1>",
				initial: true,
			},
		],
	};

	test("maps a global transition as from any and skips create", () => {
		const mapped = mapWorkflowLayout(layout);

		expect(mapped.statuses).toHaveLength(2);
		expect(mapped.transitions).toEqual([
			{
				sourceId: "A<1:S<1>:S<2>>",
				name: "Global",
				fromStatusId: null,
				toStatusId: "fixture-status-done",
				asksResolution: false,
				sequence: 0,
			},
			{
				sourceId: "A<2:S<1>:S<2>>",
				name: "Normal",
				fromStatusId: "fixture-status-todo",
				toStatusId: "fixture-status-done",
				asksResolution: false,
				sequence: 1,
			},
		]);
	});

	test("matches a workflow by status set and prefers the project key", () => {
		const match = matchWorkflow(
			"FIXT",
			"Fixture Project",
			["fixture-status-todo", "fixture-status-done"],
			[
				{
					name: "Other Workflow",
					statusIds: new Set(["fixture-status-todo", "fixture-status-done"]),
				},
				{
					name: "Fixture Workflow for FIXT",
					statusIds: new Set(["fixture-status-todo", "fixture-status-done"]),
				},
			],
		);

		expect(match).toEqual({
			name: "Fixture Workflow for FIXT",
			ambiguous: false,
		});
	});

	test("matches a short project key as a whole word", () => {
		const statuses = ["fixture-status-todo", "fixture-status-done"];
		const match = matchWorkflow("WEB", "Web", statuses, [
			{
				name: "Software Simplified Workflow for Project HELP",
				statusIds: new Set(statuses),
			},
			{
				name: "Software Simplified Workflow for Project WEB",
				statusIds: new Set(statuses),
			},
		]);

		expect(match).toEqual({
			name: "Software Simplified Workflow for Project WEB",
			ambiguous: false,
		});
	});

	test("prefers a workflow over its copy when the status sets match", () => {
		const statuses = ["fixture-status-todo", "fixture-status-done"];
		const match = matchWorkflow("OPS", "Operations infrastructure", statuses, [
			{
				name: "Copy of Software Simplified Workflow for Project OPS",
				statusIds: new Set(statuses),
			},
			{
				name: "Software Simplified Workflow for Project OPS",
				statusIds: new Set(statuses),
			},
		]);

		expect(match).toEqual({
			name: "Software Simplified Workflow for Project OPS",
			ambiguous: false,
		});
	});
});
