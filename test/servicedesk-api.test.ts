import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { Pool } from "pg";

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { type CurrentUser, userForSession } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	automationRules,
	comments,
	components,
	fieldOptions,
	fields,
	issues,
	issueTypes,
	priorities,
	projectIssueTypes,
	projects,
	projectWorkflows,
	queues,
	requestTypeFields,
	requestTypeGroupMembers,
	requestTypeGroups,
	requestTypes,
	resolutions,
	serviceDesks,
	slaCalendars,
	slaCycles,
	slaGoals,
	slaMetrics,
	statuses,
	watchers,
	workflowStatuses,
	workflows,
	workflowTransitions,
} from "../src/lib/server/schema.ts";
import {
	canViewRequest,
	deskByProjectId,
	isParticipant,
	participatingIssueIds,
} from "../src/lib/server/servicedesk/access.ts";
import { applyCreateAutomation } from "../src/lib/server/servicedesk/automation.ts";
import { issueSla } from "../src/lib/server/servicedesk/sla.ts";
import { load as loadQueueList } from "../src/routes/projects/[key]/queues/+page.server.ts";
import { load as loadQueue } from "../src/routes/projects/[key]/queues/custom/[queueId]/+page.server.ts";
import { load as loadPortalLayout } from "../src/routes/servicedesk/customer/+layout.server.ts";
import { load as loadPortalHome } from "../src/routes/servicedesk/customer/portal/[id]/+page.server.ts";
import { load as loadPortalRequest } from "../src/routes/servicedesk/customer/portal/[id]/[key]/+page.server.ts";
import {
	actions as createPortalActions,
	load as loadPortalCreate,
} from "../src/routes/servicedesk/customer/portal/[id]/create/[requestTypeId]/+page.server.ts";
import { load as loadPortalGroup } from "../src/routes/servicedesk/customer/portal/[id]/group/[groupId]/+page.server.ts";
import { load as loadMyRequests } from "../src/routes/servicedesk/customer/user/requests/+page.server.ts";
import {
	adminGroup,
	buildServer,
	cleanupTestData,
	grantDefaultProjectRole,
	login,
} from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = randomUUID().slice(0, 8);
const tag = `sd-${run}`;
const projectKey = `SD${run.slice(0, 5).toUpperCase()}`;
const sprintDescriptor =
	"com.atlassian.greenhopper.service.sprint.Sprint@[activatedDate=2026-10-01T09:00:00.000Z,id=77,name=Sprint 77,state=ACTIVE]";

let app: TestApp;
let customerSession: string;
let agentSession: string;
let adminSession: string;
let customerId: string;

let projectId: string;
let deskId: string;
let commonGroupId: string;
let accountsGroupId: string;
let requestTypeId: string;
let otherRequestTypeId: string;
let requiredRequestTypeId: string;
let resolutionId: string;
let multiselectFieldId: string;
let multiuserFieldId: string;
let labelsFieldId: string;
let queueId: string;
let calendarId: string;
let resolutionMetricId: string;
let responseMetricId: string;
let priorityId: string;
let componentId: string;
let resolveTransitionId: string;
let startTransitionId: string;
let sprintFieldId: string;
let seededIssueId: string;

function inject(
	method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
	url: string,
	session: string | null,
	payload?: unknown,
) {
	return app.inject({
		method,
		url,
		cookies: session ? { sid: session } : undefined,
		headers: session ? { "x-requested-with": "rvna" } : {},
		payload: payload as never,
	});
}

test("the portal page title is in the server HTML", async () => {
	const response = await app.inject({
		method: "GET",
		url: `/servicedesk/customer/portal/${deskId}`,
		cookies: { sid: customerSession },
		headers: { accept: "text/html" },
	});
	expect(response.statusCode).toBe(200);
	expect(response.body).toMatch(new RegExp(`<title>${tag} Portal - `));
});

const week = [
	[{ start: 0, end: 1440 }],
	[{ start: 0, end: 1440 }],
	[{ start: 0, end: 1440 }],
	[{ start: 0, end: 1440 }],
	[{ start: 0, end: 1440 }],
	[{ start: 0, end: 1440 }],
	[{ start: 0, end: 1440 }],
];

beforeAll(async () => {
	await runMigrations();
	app = buildServer();

	const customer = await login(app, {
		sub: `${tag}-customer`,
		username: `t-${run}-customer`,
		name: "Portal Customer",
		email: `t-${run}-customer@example.test`,
		groups: [],
	});
	customerSession = customer.sessionId as string;

	const agent = await login(app, {
		sub: `${tag}-agent`,
		username: `t-${run}-agent`,
		name: "Desk Lead",
		email: `t-${run}-agent@example.test`,
		groups: [],
	});
	agentSession = agent.sessionId as string;

	const admin = await login(app, {
		sub: `${tag}-admin`,
		username: `t-${run}-admin`,
		name: "Desk Admin",
		groups: [adminGroup()],
	});
	adminSession = admin.sessionId as string;

	const users = await pool.query<{ id: string; username: string }>(
		"select id, username from users where username like $1",
		[`t-${run}-%`],
	);
	customerId = users.rows.find((row) => row.username === `t-${run}-customer`)
		?.id as string;
	const agentId = users.rows.find((row) => row.username === `t-${run}-agent`)
		?.id as string;

	const typeRows = await db
		.insert(issueTypes)
		.values([
			{ sourceId: `${tag}:type:a`, name: `${tag} Request` },
			{ sourceId: `${tag}:type:b`, name: `${tag} Access` },
		])
		.returning();
	const typeA = typeRows[0].id;
	const typeB = typeRows[1].id;

	const statusRows = await db
		.insert(statuses)
		.values([
			{ sourceId: `${tag}:status:open`, name: `${tag} Open`, category: "new" },
			{
				sourceId: `${tag}:status:progress`,
				name: `${tag} In Progress`,
				category: "indeterminate",
			},
			{ sourceId: `${tag}:status:done`, name: `${tag} Done`, category: "done" },
		])
		.returning();
	const openStatus = statusRows[0].id;
	const progressStatus = statusRows[1].id;
	const doneStatus = statusRows[2].id;

	const [workflow] = await db
		.insert(workflows)
		.values({ sourceId: `${tag}:workflow`, name: `${tag} Workflow` })
		.returning();
	await db.insert(workflowStatuses).values(
		[openStatus, progressStatus, doneStatus].map((statusId) => ({
			sourceId: `${tag}:workflow-status:${statusId}`,
			workflowId: workflow.id,
			statusId,
		})),
	);
	const transitionRows = await db
		.insert(workflowTransitions)
		.values([
			{
				sourceId: `${tag}:transition:start`,
				workflowId: workflow.id,
				name: "Start progress",
				fromStatusId: openStatus,
				toStatusId: progressStatus,
				sequence: 0,
			},
			{
				sourceId: `${tag}:transition:resolve`,
				workflowId: workflow.id,
				name: "Resolve",
				fromStatusId: progressStatus,
				toStatusId: doneStatus,
				sequence: 1,
			},
		])
		.returning();
	resolveTransitionId = transitionRows[1].id;
	startTransitionId = transitionRows[0].id;

	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `${tag}:project`,
			key: projectKey,
			name: `${tag} Desk`,
			projectType: "service_desk",
			leadId: agentId,
			lastIssueNumber: 1,
		})
		.returning();
	projectId = project.id;
	await grantDefaultProjectRole(projectId, [`t-${run}-agent`], "admin");

	await db.insert(projectIssueTypes).values([
		{
			sourceId: `${tag}:project-type:a`,
			projectId,
			issueTypeId: typeA,
		},
		{
			sourceId: `${tag}:project-type:b`,
			projectId,
			issueTypeId: typeB,
		},
	]);
	await db.insert(projectWorkflows).values({
		sourceId: `${tag}:project-workflow`,
		projectId,
		issueTypeId: null,
		workflowId: workflow.id,
	});

	const [priority] = await db
		.insert(priorities)
		.values({ sourceId: `${tag}:priority`, name: `${tag} Priority` })
		.returning();
	priorityId = priority.id;

	const [resolution] = await db
		.insert(resolutions)
		.values({ sourceId: `${tag}:resolution`, name: `${tag} Done` })
		.returning();
	resolutionId = resolution.id;

	const [component] = await db
		.insert(components)
		.values({
			sourceId: `${tag}:component`,
			projectId,
			name: `${tag} Laptop`,
		})
		.returning();
	componentId = component.id;

	const fieldRows = await db
		.insert(fields)
		.values([
			{
				sourceId: `${tag}:customfield:sprint`,
				name: "Sprint",
				type: "array",
				customKey: "com.pyxis.greenhopper.jira:gh-sprint",
			},
			{
				sourceId: `${tag}:customfield:sla`,
				name: `${tag} Time to resolution`,
				type: "sd-servicelevelagreement",
			},
			{
				sourceId: `${tag}:customfield:type`,
				name: `${tag} Change type`,
				type: "option",
			},
			{
				sourceId: `${tag}:customfield:preset`,
				name: `${tag} Preset`,
				type: "option",
			},
			{
				sourceId: `${tag}:customfield:multiselect`,
				name: `${tag} Colors`,
				type: "array",
				customKey:
					"com.atlassian.jira.plugin.system.customfieldtypes:multiselect",
			},
			{
				sourceId: `${tag}:customfield:multiuser`,
				name: `${tag} Reviewers`,
				type: "array",
				customKey:
					"com.atlassian.jira.plugin.system.customfieldtypes:multiuserpicker",
			},
			{
				sourceId: `${tag}:customfield:labels`,
				name: `${tag} Tags`,
				type: "array",
				customKey: "com.atlassian.jira.plugin.system.customfieldtypes:labels",
			},
		])
		.returning();
	sprintFieldId = `${tag}:customfield:sprint`;
	multiselectFieldId = `${tag}:customfield:multiselect`;
	multiuserFieldId = `${tag}:customfield:multiuser`;
	labelsFieldId = `${tag}:customfield:labels`;
	const typeField = fieldRows[2];
	const colorField = fieldRows[4];
	await db.insert(fieldOptions).values([
		{
			sourceId: `${tag}:option:normal`,
			fieldId: typeField.id,
			value: "Normal",
			sequence: 0,
		},
		{
			sourceId: `${tag}:option:emergency`,
			fieldId: typeField.id,
			value: "Emergency",
			sequence: 1,
		},
		{
			sourceId: `${tag}:option:red`,
			fieldId: colorField.id,
			value: "Red",
			sequence: 0,
		},
		{
			sourceId: `${tag}:option:blue`,
			fieldId: colorField.id,
			value: "Blue",
			sequence: 1,
		},
	]);

	const [desk] = await db
		.insert(serviceDesks)
		.values({
			sourceId: `${tag}:desk`,
			projectId,
			portalName: `${tag} Portal`,
			description: "Welcome to the test desk",
		})
		.returning();
	deskId = desk.id;

	const groupRows = await db
		.insert(requestTypeGroups)
		.values([
			{ sourceId: `${tag}:group:common`, deskId, name: "Common", sequence: 0 },
			{
				sourceId: `${tag}:group:accounts`,
				deskId,
				name: "Accounts",
				sequence: 1,
			},
		])
		.returning();
	commonGroupId = groupRows[0].id;
	accountsGroupId = groupRows[1].id;

	const requestTypeRows = await db
		.insert(requestTypes)
		.values([
			{
				sourceId: `${tag}:rt:help`,
				deskId,
				issueTypeId: typeA,
				name: "Get help",
				description: "Ask the desk for help",
				sequence: 0,
			},
			{
				sourceId: `${tag}:rt:access`,
				deskId,
				issueTypeId: typeB,
				name: "Get access",
				sequence: 1,
			},
			{
				sourceId: `${tag}:rt:required`,
				deskId,
				issueTypeId: typeA,
				name: "Required fields",
				sequence: 2,
			},
		])
		.returning();
	requestTypeId = requestTypeRows[0].id;
	otherRequestTypeId = requestTypeRows[1].id;
	requiredRequestTypeId = requestTypeRows[2].id;

	await db.insert(requestTypeGroupMembers).values([
		{
			requestTypeId,
			groupId: commonGroupId,
			sequence: 0,
		},
		{
			requestTypeId: otherRequestTypeId,
			groupId: accountsGroupId,
			sequence: 0,
		},
	]);

	await db.insert(requestTypeFields).values([
		{
			requestTypeId,
			fieldId: "summary",
			label: "Summary",
			required: true,
			sequence: 0,
		},
		{
			requestTypeId,
			fieldId: "description",
			label: "Details",
			description: "Tell us more",
			sequence: 1,
		},
		{
			requestTypeId,
			fieldId: "duedate",
			label: "Needed by",
			sequence: 2,
		},
		{
			requestTypeId,
			fieldId: "priority",
			label: "Priority",
			sequence: 3,
		},
		{
			requestTypeId,
			fieldId: "components",
			label: "Hardware",
			sequence: 4,
		},
		{
			requestTypeId,
			fieldId: `${tag}:customfield:type`,
			label: "Change type",
			sequence: 5,
		},
		{
			requestTypeId,
			fieldId: `${tag}:customfield:preset`,
			label: "Preset",
			hiddenValue: "Normal",
			sequence: 6,
		},
		{
			requestTypeId,
			fieldId: multiselectFieldId,
			label: "Colors",
			sequence: 7,
		},
		{
			requestTypeId,
			fieldId: multiuserFieldId,
			label: "Reviewers",
			sequence: 8,
		},
		{
			requestTypeId,
			fieldId: labelsFieldId,
			label: "Tags",
			sequence: 9,
		},
		{
			requestTypeId: otherRequestTypeId,
			fieldId: "summary",
			label: "Summary",
			required: true,
			sequence: 0,
		},
		{
			requestTypeId: requiredRequestTypeId,
			fieldId: "summary",
			label: "Summary",
			required: true,
			sequence: 0,
		},
		{
			requestTypeId: requiredRequestTypeId,
			fieldId: "description",
			label: "Details",
			required: true,
			sequence: 1,
		},
		{
			requestTypeId: requiredRequestTypeId,
			fieldId: "attachment",
			label: "Attachment",
			required: true,
			sequence: 2,
		},
	]);

	const queueRows = await db
		.insert(queues)
		.values([
			{
				sourceId: `${tag}:queue:all`,
				deskId,
				name: "All open",
				jql: `project = ${projectKey} AND resolution = Unresolved`,
				columns: ["issuekey", "summary", `${tag}:customfield:sla`],
				issueCount: 0,
				sequence: 0,
			},
			{
				sourceId: `${tag}:queue:mine`,
				deskId,
				name: "↳ Mine",
				jql: `project = ${projectKey} AND assignee = currentUser()`,
				columns: ["issuekey", "summary"],
				issueCount: 0,
				sequence: 1,
			},
		])
		.returning();
	queueId = queueRows[0].id;
	await db
		.update(queues)
		.set({ parentId: queueId })
		.where(eq(queues.id, queueRows[1].id));

	const [calendar] = await db
		.insert(slaCalendars)
		.values({
			sourceId: `${tag}:calendar`,
			name: `${tag} 24/7`,
			timezone: "UTC",
			workingHours: week,
			holidays: [],
		})
		.returning();
	calendarId = calendar.id;

	const metricRows = await db
		.insert(slaMetrics)
		.values([
			{
				sourceId: `${tag}:metric:resolution`,
				deskId,
				name: `${tag} Time to resolution`,
				startConditions: [{ type: "issue_created" }],
				pauseConditions: [],
				stopConditions: [{ type: "resolution_set" }],
			},
			{
				sourceId: `${tag}:metric:response`,
				deskId,
				name: `${tag} Time to first response`,
				startConditions: [{ type: "issue_created" }],
				pauseConditions: [],
				stopConditions: [{ type: "comment_for_customer" }],
			},
		])
		.returning();
	resolutionMetricId = metricRows[0].id;
	responseMetricId = metricRows[1].id;
	await db.insert(slaGoals).values([
		{
			sourceId: `${tag}:goal:resolution`,
			metricId: resolutionMetricId,
			jql: "",
			goalMinutes: 60,
			calendarId,
			sequence: 0,
		},
		{
			sourceId: `${tag}:goal:response`,
			metricId: responseMetricId,
			jql: "",
			goalMinutes: 30,
			calendarId,
			sequence: 0,
		},
	]);

	await db.insert(automationRules).values({
		sourceId: `${tag}:rule`,
		deskId,
		name: `${tag} Rule`,
		enabled: true,
		trigger: {
			type: "jira.issue.event.trigger:created",
			value: { eventKey: "jira:issue_created" },
		},
		conditions: [],
		actions: [
			{
				type: "jira.issue.edit",
				value: {
					operations: [
						{
							type: "SET",
							fieldId: sprintFieldId,
							fieldType: "com.pyxis.greenhopper.jira:gh-sprint",
							value: { type: "REFERENCE", value: "CURRENT", additional: 77 },
						},
					],
				},
			},
		],
		raw: {},
	});

	const [seeded] = await db
		.insert(issues)
		.values({
			sourceId: `${tag}:issue:seed`,
			projectId,
			number: 1,
			key: `${projectKey}-1`,
			typeId: typeA,
			statusId: openStatus,
			resolutionId: null,
			summary: "Seeded request",
			reporterId: customerId,
			creatorId: customerId,
			created: new Date(),
			updated: new Date(),
			custom: { [sprintFieldId]: [sprintDescriptor] },
		})
		.returning();
	seededIssueId = seeded.id;
	void seededIssueId;
});

afterAll(async () => {
	await pool.query("delete from projects where id = $1", [projectId]);
	await pool.query("delete from workflows where name = $1", [
		`${tag} Workflow`,
	]);
	await pool.query("delete from issue_types where source_id like $1", [
		`${tag}%`,
	]);
	await pool.query("delete from statuses where source_id like $1", [`${tag}%`]);
	await pool.query("delete from priorities where source_id like $1", [
		`${tag}%`,
	]);
	await pool.query("delete from resolutions where source_id like $1", [
		`${tag}%`,
	]);
	await pool.query("delete from fields where source_id like $1", [`${tag}%`]);
	await pool.query("delete from sla_calendars where source_id = $1", [
		`${tag}:calendar`,
	]);
	await cleanupTestData(run);
	await pool.end();
});

async function createRequest(
	session: string,
	body: Record<string, unknown> = {},
) {
	return inject(
		"POST",
		`/api/servicedesk/portals/${deskId}/requests`,
		session,
		{
			requestTypeId,
			summary: "Laptop will not start",
			description: "<p>The laptop is dead</p>",
			...body,
		},
	);
}

async function issueRow(key: string) {
	const { rows } = await pool.query<{
		id: string;
		request_type_id: string | null;
		request_channel: string | null;
		reporter_id: string | null;
		summary: string;
		description_html: string | null;
		due_date: string | null;
		priority_id: string | null;
		custom: Record<string, unknown>;
		status_id: string;
	}>(
		"select id, request_type_id, request_channel, reporter_id, summary, description_html, due_date::text as due_date, priority_id, custom, status_id from issues where key = $1",
		[key],
	);
	return rows[0];
}

describe("portal API", () => {
	test("lists the desk's groups and request types", async () => {
		const response = await inject(
			"GET",
			`/api/servicedesk/portals/${deskId}`,
			customerSession,
		);
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.name).toBe(`${tag} Portal`);
		expect(body.groups.map((group: { name: string }) => group.name)).toEqual([
			"Common",
			"Accounts",
		]);
		expect(body.groups[0].requestTypes[0].name).toBe("Get help");
		expect(body.groups[1].requestTypes[0].name).toBe("Get access");
	});

	test("the portal detail counts only its own open requests", async () => {
		const [type] = await db
			.select({ issueTypeId: requestTypes.issueTypeId })
			.from(requestTypes)
			.where(eq(requestTypes.id, requestTypeId));
		const otherKey = `OT${run.slice(0, 5).toUpperCase()}`;
		const [otherProject] = await db
			.insert(projects)
			.values({
				sourceId: `${tag}:project:other`,
				key: otherKey,
				name: `${tag} Other Project`,
				projectType: "service_desk",
				lastIssueNumber: 1,
			})
			.returning();
		try {
			const [otherDesk] = await db
				.insert(serviceDesks)
				.values({
					sourceId: `${tag}:desk:other`,
					projectId: otherProject.id,
					portalName: `${tag} Other Portal`,
				})
				.returning();
			const [otherType] = await db
				.insert(requestTypes)
				.values({
					sourceId: `${tag}:rt:other`,
					deskId: otherDesk.id,
					issueTypeId: type.issueTypeId,
					name: "Other type",
				})
				.returning();

			const portal = `/api/servicedesk/portals/${deskId}`;
			const before = (await inject("GET", portal, customerSession)).json()
				.openRequestCount as number;
			await pool.query(
				`insert into issues (
					source_id, project_id, number, key, type_id, status_id, summary,
					reporter_id, creator_id, request_type_id, created, updated
				 ) select $1, $2, 1, $3, type_id, status_id, $4,
					reporter_id, creator_id, $5, now(), now()
				 from issues where id = $6`,
				[
					`${tag}:issue:other-desk`,
					otherProject.id,
					`${otherKey}-1`,
					"Other desk request",
					otherType.id,
					seededIssueId,
				],
			);
			const after = (await inject("GET", portal, customerSession)).json()
				.openRequestCount as number;
			expect(after).toBe(before);

			const other = (
				await inject(
					"GET",
					`/api/servicedesk/portals/${otherDesk.id}`,
					customerSession,
				)
			).json();
			expect(other.openRequestCount).toBe(1);
		} finally {
			await pool.query("delete from projects where id = $1", [otherProject.id]);
		}
	});

	test("returns the form fields with their input kind", async () => {
		const response = await inject(
			"GET",
			`/api/servicedesk/portals/${deskId}/request-types/${requestTypeId}`,
			customerSession,
		);
		expect(response.statusCode).toBe(200);
		const fields = response.json().fields as {
			fieldId: string;
			required: boolean;
			hidden: boolean;
			kind: string;
			options: { id: string; label: string }[];
		}[];
		expect(fields.map((field) => field.fieldId)).toEqual([
			"summary",
			"description",
			"duedate",
			"priority",
			"components",
			`${tag}:customfield:type`,
			`${tag}:customfield:preset`,
			multiselectFieldId,
			multiuserFieldId,
			labelsFieldId,
		]);
		expect(fields[0].required).toBe(true);
		expect(fields[0].kind).toBe("text");
		expect(fields[1].kind).toBe("rich");
		expect(fields[2].kind).toBe("date");
		expect(fields[3].options.map((option) => option.label)).toContain(
			`${tag} Priority`,
		);
		expect(fields[4].options.map((option) => option.label)).toEqual([
			`${tag} Laptop`,
		]);
		expect(fields[5].options.map((option) => option.label)).toEqual([
			"Normal",
			"Emergency",
		]);
		expect(fields[6].hidden).toBe(true);
		expect(fields[6].options).toEqual([]);
		expect(fields[7].options.map((option) => option.label)).toEqual([
			"Red",
			"Blue",
		]);
		expect(fields[8].options.map((option) => option.label)).toContain(
			"Portal Customer",
		);
		expect(
			fields[8].options.every((option) => /^[0-9a-f-]{36}$/.test(option.id)),
		).toBe(true);
		expect(fields[9].options).toEqual([]);
		expect(fields.some((field) => "arrayKind" in field)).toBe(false);
	});

	test("stores the three array kinds in the shapes the issue form uses", async () => {
		const created = await createRequest(customerSession, {
			summary: "Array values request",
			fields: {
				[multiselectFieldId]: ["Red"],
				[multiuserFieldId]: [customerId],
				[labelsFieldId]: ["printer", "urgent"],
			},
		});
		expect(created.statusCode).toBe(201);
		const row = await issueRow(created.json().key);
		expect(row.custom[multiselectFieldId]).toEqual([
			{ value: "Red", id: expect.any(String) },
		]);
		expect(row.custom[multiuserFieldId]).toEqual([
			{
				id: customerId,
				name: `t-${run}-customer`,
				displayName: "Portal Customer",
			},
		]);
		expect(row.custom[labelsFieldId]).toEqual(["printer", "urgent"]);
	});

	test("a required description or attachment cannot be empty", async () => {
		const missingDescription = await inject(
			"POST",
			`/api/servicedesk/portals/${deskId}/requests`,
			customerSession,
			{
				requestTypeId: requiredRequestTypeId,
				summary: "Required fields request",
				description: "",
				fields: {},
			},
		);
		expect(missingDescription.statusCode).toBe(400);
		expect(missingDescription.json().error).toBe("Details is required");

		const missingAttachment = await inject(
			"POST",
			`/api/servicedesk/portals/${deskId}/requests`,
			customerSession,
			{
				requestTypeId: requiredRequestTypeId,
				summary: "Required attachment request",
				description: "<p>Details</p>",
				fields: {},
			},
		);
		// The REST create endpoint has no attachment count; the page action sends it.
		expect(missingAttachment.statusCode).toBe(201);
	});

	test("requires the summary", async () => {
		const response = await createRequest(customerSession, { summary: " " });
		expect(response.statusCode).toBe(400);
		expect(response.json().error).toBe("Summary is required");
	});

	test("creates a request with its presets and values", async () => {
		const response = await createRequest(customerSession, {
			fields: {
				duedate: "2026-12-01",
				priority: priorityId,
				components: [componentId],
				[`${tag}:customfield:type`]: "Emergency",
			},
		});
		expect(response.statusCode).toBe(201);
		const created = response.json();
		expect(created.key).toMatch(new RegExp(`^${projectKey}-\\d+$`));

		const row = await issueRow(created.key);
		expect(row.request_type_id).toBe(requestTypeId);
		expect(row.request_channel).toBe("portal");
		expect(row.reporter_id).toBe(customerId);
		expect(row.summary).toBe("Laptop will not start");
		expect(row.description_html).toBe("<p>The laptop is dead</p>");
		expect(row.due_date).toBe("2026-12-01");
		expect(row.priority_id).toBe(priorityId);
		expect(row.custom[`${tag}:customfield:type`]).toEqual({
			value: "Emergency",
		});
		expect(row.custom[`${tag}:customfield:preset`]).toEqual({
			value: "Normal",
		});

		const components = await pool.query(
			"select component_id from issue_components where issue_id = $1",
			[row.id],
		);
		expect(components.rows.map((item) => item.component_id)).toEqual([
			componentId,
		]);
	});

	test("filters my requests by status, scope and text", async () => {
		const created = await createRequest(customerSession, {
			summary: "Printer is offline",
		});
		const key = created.json().key;

		const open = await inject(
			"GET",
			"/api/servicedesk/requests?status=open&scope=created",
			customerSession,
		);
		expect(open.statusCode).toBe(200);
		expect(
			open.json().requests.map((item: { key: string }) => item.key),
		).toContain(key);

		const search = await inject(
			"GET",
			"/api/servicedesk/requests?status=open&scope=created&q=Printer",
			customerSession,
		);
		expect(search.json().requests).toHaveLength(1);
		expect(search.json().requests[0].key).toBe(key);

		const participating = await inject(
			"GET",
			"/api/servicedesk/requests?status=all&scope=participating",
			agentSession,
		);
		expect(participating.statusCode).toBe(200);

		await inject("POST", `/api/issues/${key}/comments`, agentSession, {
			body: "We are on it",
		});
		const afterComment = await inject(
			"GET",
			"/api/servicedesk/requests?status=open&scope=participating",
			agentSession,
		);
		expect(
			afterComment.json().requests.map((item: { key: string }) => item.key),
		).toContain(key);
	});
});

describe("comment visibility", () => {
	test("a customer never receives internal comments", async () => {
		const created = await createRequest(customerSession, {
			summary: "Need a monitor",
		});
		const key = created.json().key;

		const internal = await inject(
			"POST",
			`/api/issues/${key}/comments`,
			agentSession,
			{ body: "Ordering from the supplier", internal: true },
		);
		expect(internal.statusCode).toBe(201);
		expect(internal.json().internal).toBe(true);

		const publicComment = await inject(
			"POST",
			`/api/servicedesk/portals/${deskId}/requests/${key}/comments`,
			customerSession,
			{ body: "Thanks!" },
		);
		expect(publicComment.statusCode).toBe(201);

		const customerComments = await inject(
			"GET",
			`/api/issues/${key}/comments`,
			customerSession,
		);
		expect(
			customerComments
				.json()
				.map((comment: { internal: boolean }) => comment.internal),
		).toEqual([false]);

		const agentComments = await inject(
			"GET",
			`/api/issues/${key}/comments`,
			agentSession,
		);
		expect(agentComments.json()).toHaveLength(2);

		const portalView = await inject(
			"GET",
			`/api/servicedesk/portals/${deskId}/requests/${key}`,
			customerSession,
		);
		expect(portalView.statusCode).toBe(200);
		expect(portalView.json().comments).toHaveLength(1);
		expect(portalView.json().comments[0].bodyHtml).toContain("Thanks!");

		const agentPortalView = await inject(
			"GET",
			`/api/servicedesk/portals/${deskId}/requests/${key}`,
			agentSession,
		);
		expect(agentPortalView.json().comments).toHaveLength(1);

		const customerInternal = await inject(
			"POST",
			`/api/issues/${key}/comments`,
			customerSession,
			{ body: "Trying to hide this", internal: true },
		);
		expect(customerInternal.statusCode).toBe(403);
	});

	test("a customer comment bumps the issue's updated timestamp", async () => {
		const created = await createRequest(customerSession, {
			summary: "Comment bumps updated",
		});
		const key = created.json().key as string;
		await pool.query(
			"update issues set updated = now() - interval '1 day' where key = $1",
			[key],
		);
		const before = await pool.query<{ updated: Date }>(
			"select updated from issues where key = $1",
			[key],
		);
		const commented = await inject(
			"POST",
			`/api/servicedesk/portals/${deskId}/requests/${key}/comments`,
			customerSession,
			{ body: "Any update?" },
		);
		expect(commented.statusCode).toBe(201);
		const after = await pool.query<{ updated: Date }>(
			"select updated from issues where key = $1",
			[key],
		);
		expect(after.rows[0].updated.getTime()).toBeGreaterThan(
			before.rows[0].updated.getTime(),
		);
	});
});

async function userFor(session: string): Promise<CurrentUser> {
	const user = await userForSession(session);
	if (!user) throw new Error("The session has no user");
	return user;
}

function event(
	user: CurrentUser,
	path: string,
	params: Record<string, string> = {},
) {
	return {
		locals: { user },
		url: new URL(`http://localhost${path}`),
		params,
		route: { id: path.split("?")[0] },
		depends: () => undefined,
	} as never;
}

function actionEvent(
	user: CurrentUser,
	path: string,
	params: Record<string, string>,
	form: FormData,
	routeId = path,
) {
	return {
		locals: { user },
		url: new URL(`http://localhost${path}`),
		params,
		route: { id: routeId },
		request: new Request(`http://localhost${path}`, {
			method: "POST",
			body: form,
		}),
		depends: () => undefined,
		cookies: { get: () => undefined },
	} as never;
}

describe("portal pages", () => {
	async function seed() {
		const own = (
			await createRequest(customerSession, {
				summary: "Portal page own request",
			})
		).json().key as string;
		const other = (
			await createRequest(adminSession, {
				summary: "Portal page somebody else's request",
			})
		).json().key as string;
		await inject("POST", `/api/issues/${own}/comments`, agentSession, {
			body: "Portal page internal note",
			internal: true,
		});
		await inject("POST", `/api/issues/${own}/comments`, agentSession, {
			body: "Portal page public answer",
		});
		return { own, other };
	}

	test("the request page holds what the portal API returns for that customer and nothing more", async () => {
		const customer = await userFor(customerSession);
		const { own, other } = await seed();
		const api = (
			await inject(
				"GET",
				`/api/servicedesk/portals/${deskId}/requests/${own}`,
				customerSession,
			)
		).json();
		const page = await loadPortalRequest(
			event(customer, `/servicedesk/customer/portal/${deskId}/${own}`, {
				id: deskId,
				key: own,
			}),
		);
		expect(page.request).toEqual(api);
		expect(page.portal).toEqual({ id: deskId, name: `${tag} Portal` });
		const text = JSON.stringify(page);
		expect(text).toContain("Portal page public answer");
		expect(text).not.toContain("Portal page internal note");
		expect(text).not.toContain("somebody else's request");

		await expect(
			loadPortalRequest(
				event(customer, `/servicedesk/customer/portal/${deskId}/${other}`, {
					id: deskId,
					key: other,
				}),
			),
		).rejects.toMatchObject({ status: 404 });
	});

	test("malformed ids answer 404 before they reach the database", async () => {
		const customer = await userFor(customerSession);
		await expect(
			loadPortalHome(
				event(customer, "/servicedesk/customer/portal/not-a-uuid", {
					id: "not-a-uuid",
				}),
			),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			loadPortalCreate(
				event(
					customer,
					`/servicedesk/customer/portal/${deskId}/create/not-a-uuid`,
					{ id: deskId, requestTypeId: "not-a-uuid" },
				),
			),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			loadQueue(
				event(
					await userFor(agentSession),
					`/projects/${projectKey}/queues/custom/not-a-uuid`,
					{ key: projectKey, queueId: "not-a-uuid" },
				),
			),
		).rejects.toMatchObject({ status: 404 });
	});

	test("the create action refuses an empty required description or attachment", async () => {
		const customer = await userFor(customerSession);
		const path = `/servicedesk/customer/portal/${deskId}/create/${requiredRequestTypeId}`;
		const params = { id: deskId, requestTypeId: requiredRequestTypeId };
		const form = (description: string, attachmentCount: string) => {
			const data = new FormData();
			data.set("summary", "Action required fields");
			data.set("description", description);
			data.set("attachmentCount", attachmentCount);
			return data;
		};

		expect(
			await createPortalActions.default(
				actionEvent(
					customer,
					path,
					params,
					form("", "0"),
					"/servicedesk/customer/portal/[id]/create/[requestTypeId]",
				),
			),
		).toMatchObject({ status: 400, data: { error: "Details is required" } });

		expect(
			await createPortalActions.default(
				actionEvent(
					customer,
					path,
					params,
					form("<p>Details</p>", "0"),
					"/servicedesk/customer/portal/[id]/create/[requestTypeId]",
				),
			),
		).toMatchObject({
			status: 400,
			data: { error: "Attachment is required" },
		});

		const created = await createPortalActions.default(
			actionEvent(
				customer,
				path,
				params,
				form("<p>Details</p>", "1"),
				"/servicedesk/customer/portal/[id]/create/[requestTypeId]",
			),
		);
		expect(created).toMatchObject({
			created: {
				key: expect.stringMatching(new RegExp(`^${projectKey}-\\d+$`)),
			},
		});
	});

	test("the request list holds the customer's own requests, as the API lists them", async () => {
		const customer = await userFor(customerSession);
		const { own, other } = await seed();
		const api = (
			await inject(
				"GET",
				"/api/servicedesk/requests?status=open&scope=all",
				customerSession,
			)
		).json();
		const page = await loadMyRequests(
			event(customer, "/servicedesk/customer/user/requests"),
		);
		expect(page.requests).toEqual(api.requests);
		expect(page.total).toBe(api.total);
		const keys = page.requests.map((item: { key: string }) => item.key);
		expect(keys).toContain(own);
		expect(keys).not.toContain(other);
		expect(JSON.stringify(page)).not.toContain("somebody else's request");
	});

	test("the layout, home, group and create pages hold what their portal API calls return", async () => {
		const customer = await userFor(customerSession);
		const portal = (
			await inject("GET", `/api/servicedesk/portals/${deskId}`, customerSession)
		).json();
		const groupId = portal.groups[0].id as string;
		const mine = (
			await inject(
				"GET",
				"/api/servicedesk/requests?status=open&scope=all",
				customerSession,
			)
		).json();

		const layout = await loadPortalLayout(
			event(customer, "/servicedesk/customer"),
		);
		expect(layout).toEqual({ openRequests: mine.total });

		const summary = {
			id: portal.id,
			name: portal.name,
			description: portal.description,
			announcement: portal.announcement,
			groups: portal.groups,
		};
		const home = await loadPortalHome(
			event(customer, `/servicedesk/customer/portal/${deskId}`, {
				id: deskId,
			}),
		);
		expect(home).toEqual({ portal: summary });
		const group = await loadPortalGroup(
			event(
				customer,
				`/servicedesk/customer/portal/${deskId}/group/${groupId}`,
				{
					id: deskId,
					groupId,
				},
			),
		);
		expect(group).toEqual({ portal: summary, groupId });

		const form = (
			await inject(
				"GET",
				`/api/servicedesk/portals/${deskId}/request-types/${requestTypeId}`,
				customerSession,
			)
		).json();
		const create = await loadPortalCreate(
			event(
				customer,
				`/servicedesk/customer/portal/${deskId}/create/${requestTypeId}`,
				{ id: deskId, requestTypeId },
			),
		);
		expect(create.portalId).toBe(deskId);
		expect(create.form.requestType).toEqual(form.requestType);
		expect(create.form.fields.map(({ arrayKind, ...field }) => field)).toEqual(
			form.fields,
		);
	});
});

describe("queues", () => {
	test("lists queues with live counts and nesting", async () => {
		const response = await inject(
			"GET",
			`/api/servicedesk/projects/${projectKey}/queues`,
			agentSession,
		);
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.isAgent).toBe(true);
		expect(body.queues).toHaveLength(2);
		expect(body.queues[0].name).toBe("All open");
		expect(body.queues[1].parentId).toBe(queueId);
		expect(body.queues[0].liveCount).toBeGreaterThan(0);
	});

	test("runs the queue and fills the SLA column", async () => {
		const response = await inject(
			"GET",
			`/api/servicedesk/projects/${projectKey}/queues/${queueId}`,
			agentSession,
		);
		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.columns.map((column: { kind: string }) => column.kind)).toEqual(
			["key", "summary", "sla"],
		);
		expect(body.total).toBeGreaterThan(0);
		const cells = body.issues[0].cells;
		expect(cells.issuekey.kind).toBe("key");
		const slaCell = cells[`${tag}:customfield:sla`];
		expect(slaCell.kind).toBe("sla");
		expect(slaCell.remainingMinutes).not.toBeNull();
		expect(slaCell.state).toBe("ongoing");
	});

	test("fills updated, resolution, labels, watchers and work ratio", async () => {
		const key = `${projectKey}-1`;
		const updated = new Date("2026-01-02T03:04:05.000Z");
		await pool.query(
			"update issues set updated = $1, resolution_id = $2, original_estimate = 3600, time_spent = 1800 where key = $3",
			[updated, resolutionId, key],
		);
		await pool.query(
			`insert into issue_labels (source_id, issue_id, label)
			 select $1, id, $2 from issues where key = $3`,
			[`${tag}:label:alpha`, "alpha", key],
		);
		await pool.query(
			`insert into issue_labels (source_id, issue_id, label)
			 select $1, id, $2 from issues where key = $3`,
			[`${tag}:label:beta`, "beta", key],
		);
		await pool.query(
			`insert into watchers (issue_id, user_id)
			 select id, $1 from issues where key = $2`,
			[customerId, key],
		);
		const [queue] = await db
			.insert(queues)
			.values({
				sourceId: `${tag}:queue:columns`,
				deskId,
				name: "All columns",
				jql: `project = ${projectKey}`,
				columns: [
					"issuekey",
					"updated",
					"resolution",
					"labels",
					"watchers",
					"workratio",
				],
				issueCount: 0,
				sequence: 2,
			})
			.returning();
		const response = await inject(
			"GET",
			`/api/servicedesk/projects/${projectKey}/queues/${queue.id}`,
			agentSession,
		);
		expect(response.statusCode).toBe(200);
		const row = response
			.json()
			.issues.find((issue: { key: string }) => issue.key === key);
		expect(row.cells.updated).toMatchObject({
			kind: "date",
			text: updated.toISOString(),
		});
		expect(row.cells.resolution.text).toBe(`${tag} Done`);
		expect(row.cells.labels).toMatchObject({
			text: "alpha, beta",
			names: ["alpha", "beta"],
		});
		expect(row.cells.watchers).toMatchObject({
			text: "Portal Customer",
			names: ["Portal Customer"],
		});
		expect(row.cells.workratio.text).toBe("50%");
	});

	test("a queue list for a non-agent answers 403, not an empty 200 page", async () => {
		await expect(
			loadQueueList(
				event(
					await userFor(customerSession),
					`/projects/${projectKey}/queues`,
					{
						key: projectKey,
					},
				),
			),
		).rejects.toMatchObject({ status: 403 });
	});

	test("a queue with a bad JQL answers 400, not a 200 page with error text", async () => {
		const [queue] = await db
			.insert(queues)
			.values({
				sourceId: `${tag}:queue:bad-jql`,
				deskId,
				name: "Bad JQL",
				jql: "project = (",
				columns: ["issuekey"],
				issueCount: 0,
				sequence: 9,
			})
			.returning();
		await expect(
			loadQueue(
				event(
					await userFor(agentSession),
					`/projects/${projectKey}/queues/custom/${queue.id}`,
					{ key: projectKey, queueId: queue.id },
				),
			),
		).rejects.toMatchObject({ status: 400 });
	});

	test("only agents see queues", async () => {
		const response = await inject(
			"GET",
			`/api/servicedesk/projects/${projectKey}/queues`,
			customerSession,
		);
		expect(response.statusCode).toBe(403);
	});
});

describe("SLA at run time", () => {
	test("starts a cycle on creation and stops it on a transition", async () => {
		const created = await createRequest(customerSession, {
			summary: "SLA transition request",
		});
		const key = created.json().key;

		const before = await inject(
			"GET",
			`/api/servicedesk/issues/${key}/sla`,
			agentSession,
		);
		expect(before.statusCode).toBe(200);
		const metric = before
			.json()
			.metrics.find((item: { id: string }) => item.id === resolutionMetricId);
		expect(metric.cycles[0].state).toBe("ongoing");
		expect(metric.cycles[0].goalMinutes).toBe(60);

		const start = await inject(
			"POST",
			`/api/issues/${key}/transitions`,
			agentSession,
			{ transitionId: startTransitionId },
		);
		expect(start.statusCode).toBe(200);

		const done = await inject(
			"POST",
			`/api/issues/${key}/transitions`,
			agentSession,
			{ transitionId: resolveTransitionId },
		);
		expect(done.statusCode).toBe(200);

		const after = await inject(
			"GET",
			`/api/servicedesk/issues/${key}/sla`,
			agentSession,
		);
		const stopped = after
			.json()
			.metrics.find((item: { id: string }) => item.id === resolutionMetricId);
		expect(stopped.cycles[0].stoppedAt).not.toBeNull();
		expect(stopped.cycles[0].state).toBe("completed");
	});

	test("stops the first response cycle when the desk answers", async () => {
		const created = await createRequest(customerSession, {
			summary: "SLA comment request",
		});
		const key = created.json().key;

		await inject("POST", `/api/issues/${key}/comments`, agentSession, {
			body: "Looking into it",
		});

		const after = await inject(
			"GET",
			`/api/servicedesk/issues/${key}/sla`,
			agentSession,
		);
		const responseMetric = after
			.json()
			.metrics.find((item: { id: string }) => item.id === responseMetricId);
		expect(responseMetric.cycles[0].stoppedAt).not.toBeNull();
		expect(responseMetric.cycles[0].state).toBe("completed");

		const resolutionMetric = after
			.json()
			.metrics.find((item: { id: string }) => item.id === resolutionMetricId);
		expect(resolutionMetric.cycles[0].stoppedAt).toBeNull();
	});

	test("customers do not see SLAs", async () => {
		const created = await createRequest(customerSession, {
			summary: "Customer SLA probe",
		});
		const response = await inject(
			"GET",
			`/api/servicedesk/issues/${created.json().key}/sla`,
			customerSession,
		);
		expect(response.statusCode).toBe(403);
	});
});

describe("automation hook", () => {
	test("sets the current sprint when a request is created", async () => {
		const created = await createRequest(customerSession, {
			summary: "Automation request",
		});
		const row = await issueRow(created.json().key);
		expect(row.custom[sprintFieldId]).toEqual([sprintDescriptor]);
	});
});

describe("agent access", () => {
	test("the project lead and administrators are agents", async () => {
		const created = await createRequest(customerSession, {
			summary: "Agent panel request",
		});
		const key = created.json().key;

		const lead = await inject(
			"GET",
			`/api/servicedesk/issues/${key}/request`,
			agentSession,
		);
		expect(lead.statusCode).toBe(200);
		expect(lead.json().isAgent).toBe(true);
		expect(lead.json().customerUrl).toBe(
			`/servicedesk/customer/portal/${deskId}/${key}`,
		);

		const admin = await inject(
			"GET",
			`/api/servicedesk/projects/${projectKey}/queues`,
			adminSession,
		);
		expect(admin.statusCode).toBe(200);

		const customer = await inject(
			"GET",
			`/api/servicedesk/issues/${key}/request`,
			customerSession,
		);
		expect(customer.statusCode).toBe(200);
		expect(customer.json().isAgent).toBe(false);
	});
});

describe("portal access when the desk is open", () => {
	const schemeSource = `${tag}:open-scheme`;
	let newcomerSession: string;
	let newcomerId: string;

	beforeAll(async () => {
		await pool.query(
			"update service_desks set open_access = true where id = $1",
			[deskId],
		);
		const [scheme] = await pool
			.query<{ id: string }>(
				"insert into permission_schemes (source_id, name, project_ids, raw) values ($1, $1, $2::jsonb, '{}'::jsonb) returning id",
				[schemeSource, JSON.stringify([projectId])],
			)
			.then((result) => result.rows);
		await pool.query(
			"insert into permission_grants (source_id, scheme_id, permission_key, holder_type, raw) values ($1, $2, 'CREATE_ISSUES', 'sd.customer.portal.only', '{}'::jsonb)",
			[`${schemeSource}:create`, scheme.id],
		);
		const newcomer = await login(app, {
			sub: `${tag}-newcomer`,
			username: `t-${run}-newcomer`,
			name: "Portal Newcomer",
			groups: [],
		});
		newcomerSession = newcomer.sessionId as string;
		const me = await inject("GET", "/api/me", newcomerSession);
		newcomerId = me.json().id;
	});

	afterAll(async () => {
		await pool.query("delete from permission_schemes where source_id = $1", [
			schemeSource,
		]);
	});

	test("a user in no group has no project yet uses the portal", async () => {
		const projects = await inject("GET", "/api/projects", newcomerSession);
		expect(
			(projects.json() as { key: string }[]).map((row) => row.key),
		).not.toContain(projectKey);

		const portals = await inject(
			"GET",
			"/api/servicedesk/portals",
			newcomerSession,
		);
		expect((portals.json() as { id: string }[]).map((row) => row.id)).toContain(
			deskId,
		);
		const portal = `/api/servicedesk/portals/${deskId}`;
		expect((await inject("GET", portal, newcomerSession)).statusCode).toBe(200);
		expect(
			(
				await inject(
					"GET",
					`${portal}/request-types/${requestTypeId}`,
					newcomerSession,
				)
			).statusCode,
		).toBe(200);
	});

	test("the user raises a request and sees only their own", async () => {
		const others = await createRequest(customerSession, {
			summary: "Someone else's request",
		});
		const othersKey = others.json().key as string;
		const mine = await createRequest(newcomerSession, {
			summary: "The newcomer's request",
		});
		expect(mine.statusCode).toBe(201);
		const mineKey = mine.json().key as string;

		const listed = await inject(
			"GET",
			"/api/servicedesk/requests?status=all&scope=all",
			newcomerSession,
		);
		expect(listed.statusCode).toBe(200);
		expect(
			listed.json().requests.map((item: { key: string }) => item.key),
		).toEqual([mineKey]);

		const portal = `/api/servicedesk/portals/${deskId}`;
		expect(
			(await inject("GET", `${portal}/requests/${mineKey}`, newcomerSession))
				.statusCode,
		).toBe(200);
		expect(
			(await inject("GET", `${portal}/requests/${othersKey}`, newcomerSession))
				.statusCode,
		).toBe(404);

		const own = await inject(
			"POST",
			`${portal}/requests/${mineKey}/comments`,
			newcomerSession,
			{ body: "Any news?" },
		);
		expect(own.statusCode).toBe(201);
		const foreign = await inject(
			"POST",
			`${portal}/requests/${othersKey}/comments`,
			newcomerSession,
			{ body: "Let me in" },
		);
		expect(foreign.statusCode).toBe(404);
		expect(
			await pool
				.query("select 1 from issues where key = $1 and reporter_id = $2", [
					mineKey,
					newcomerId,
				])
				.then((result) => result.rowCount),
		).toBe(1);
	});

	test("an ordinary issue in the desk project is not a portal request", async () => {
		const key = `${projectKey}-1`;
		const portal = `/api/servicedesk/portals/${deskId}/requests/${key}`;

		expect((await inject("GET", portal, customerSession)).statusCode).toBe(404);
		expect(
			(
				await inject("POST", `${portal}/comments`, customerSession, {
					body: "Internal issue comment",
				})
			).statusCode,
		).toBe(404);
		const browse = await inject("GET", `/browse/${key}`, customerSession);
		expect(browse.statusCode).not.toBe(302);

		const boundary = `----rvna${randomUUID()}`;
		const upload = (session: string) =>
			app.inject({
				method: "POST",
				url: `/api/issues/${key}/attachments`,
				cookies: { sid: session },
				headers: {
					"x-requested-with": "rvna",
					"content-type": `multipart/form-data; boundary=${boundary}`,
				},
				payload: Buffer.from(
					`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="internal.txt"\r\nContent-Type: text/plain\r\n\r\ninternal\r\n--${boundary}--\r\n`,
				),
			});

		expect((await upload(customerSession)).statusCode).toBe(404);
		const attached = await upload(adminSession);
		expect(attached.statusCode).toBe(201);
		expect(
			(
				await inject(
					"GET",
					`/api/attachments/${attached.json()[0].id}`,
					customerSession,
				)
			).statusCode,
		).toBe(404);
	});

	test("a non-agent cannot use the SLA answer to probe issue existence", async () => {
		const existing = await inject(
			"GET",
			`/api/servicedesk/issues/${projectKey}-1/sla`,
			newcomerSession,
		);
		const missing = await inject(
			"GET",
			`/api/servicedesk/issues/${projectKey}-99999/sla`,
			newcomerSession,
		);
		expect(existing.statusCode).toBe(404);
		expect(missing.statusCode).toBe(404);
	});

	test("an agent without BROWSE_PROJECTS cannot read the SLA of an issue", async () => {
		const username = `t-${run}-sla-agent`;
		const slaAgent = await login(app, {
			sub: `${tag}-sla-agent`,
			username,
			name: "SLA Agent",
			groups: [],
		});
		const grant = `${tag}:sla-agent-grant`;
		await pool.query(
			"insert into permission_grants (source_id, scheme_id, permission_key, holder_type, holder_parameter, raw) select $1, id, 'SERVICEDESK_AGENT', 'user', $2, '{}'::jsonb from permission_schemes where source_id = $3",
			[grant, username, schemeSource],
		);
		try {
			const response = await inject(
				"GET",
				`/api/servicedesk/issues/${projectKey}-1/sla`,
				slaAgent.sessionId as string,
			);
			expect(response.statusCode).toBe(404);
			expect(response.json().error).toBe("Issue not found");
		} finally {
			await pool.query("delete from permission_grants where source_id = $1", [
				grant,
			]);
		}
	});

	test("a customer who opens /browse/<KEY> of their own request lands on its portal view", async () => {
		const mine = (await createRequest(newcomerSession)).json().key as string;
		const others = (await createRequest(customerSession)).json().key as string;
		const portalView = `/servicedesk/customer/portal/${deskId}/${mine}`;

		const own = await inject("GET", `/browse/${mine}`, newcomerSession);
		expect(own.statusCode).toBe(302);
		expect(own.headers.location).toBe(portalView);
		expect(
			(await inject("GET", `/browse/${mine.toLowerCase()}`, newcomerSession))
				.headers.location,
		).toBe(portalView);

		const foreign = await inject("GET", `/browse/${others}`, newcomerSession);
		expect(foreign.statusCode).not.toBe(302);
		expect(foreign.headers.location).toBeUndefined();
		const signedOut = await inject("GET", `/browse/${mine}`, null);
		expect(signedOut.headers.location).toMatch(/^\/login\.jsp\?returnTo=/);
		const agent = await inject("GET", `/browse/${mine}`, agentSession);
		expect(agent.headers.location).toBeUndefined();
	});

	test("a customer attaches a file to their own request and downloads it, but not on another's", async () => {
		const mine = (await createRequest(newcomerSession)).json().key as string;
		const others = (await createRequest(customerSession)).json().key as string;
		const upload = (key: string, session: string) => {
			const boundary = `----rvna${randomUUID()}`;
			return app.inject({
				method: "POST",
				url: `/api/issues/${key}/attachments`,
				cookies: { sid: session },
				headers: {
					"x-requested-with": "rvna",
					"content-type": `multipart/form-data; boundary=${boundary}`,
				},
				payload: Buffer.from(
					`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nprinter log\r\n--${boundary}--\r\n`,
				),
			});
		};

		const own = await upload(mine, newcomerSession);
		expect(own.statusCode).toBe(201);
		const attachmentId = own.json()[0].id as string;
		const download = await inject(
			"GET",
			`/api/attachments/${attachmentId}`,
			newcomerSession,
		);
		expect(download.statusCode).toBe(200);
		expect(download.body).toBe("printer log");
		const portal = await inject(
			"GET",
			`/api/servicedesk/portals/${deskId}/requests/${mine}`,
			newcomerSession,
		);
		expect(portal.json().attachments).toHaveLength(1);

		expect((await upload(others, newcomerSession)).statusCode).toBe(404);
		const theirs = await upload(others, customerSession);
		expect(theirs.statusCode).toBe(201);
		expect(
			(
				await inject(
					"GET",
					`/api/attachments/${theirs.json()[0].id}`,
					newcomerSession,
				)
			).statusCode,
		).toBe(404);
	});

	test("a participant downloads a request's attachments but cannot upload; the reporter cannot delete", async () => {
		const mine = (await createRequest(newcomerSession)).json().key as string;
		const boundary = `----rvna${randomUUID()}`;
		const upload = (session: string) =>
			app.inject({
				method: "POST",
				url: `/api/issues/${mine}/attachments`,
				cookies: { sid: session },
				headers: {
					"x-requested-with": "rvna",
					"content-type": `multipart/form-data; boundary=${boundary}`,
				},
				payload: Buffer.from(
					`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="b.txt"\r\nContent-Type: text/plain\r\n\r\nlog\r\n--${boundary}--\r\n`,
				),
			});
		const attached = await upload(newcomerSession);
		expect(attached.statusCode).toBe(201);
		const attachmentId = attached.json()[0].id as string;

		// A participant sees the request page, so the same check admits the download.
		// Upload stays with the reporter.
		const issue = await issueRow(mine);
		await pool.query(
			"insert into watchers (issue_id, user_id) values ($1, $2)",
			[issue.id, customerId],
		);
		expect((await upload(customerSession)).statusCode).toBe(404);
		expect(
			(await inject("GET", `/api/attachments/${attachmentId}`, customerSession))
				.statusCode,
		).toBe(200);

		// The reporter cannot delete: the exception covers upload and download only.
		const removed = await inject(
			"DELETE",
			`/api/attachments/${attachmentId}`,
			newcomerSession,
		);
		expect([403, 404]).toContain(removed.statusCode);
		expect(
			(await inject("GET", `/api/attachments/${attachmentId}`, newcomerSession))
				.statusCode,
		).toBe(200);
	});

	test("a customer who may create issues but not browse cannot clone their request", async () => {
		const mine = (await createRequest(newcomerSession)).json().key as string;
		const before = await pool.query<{ n: number }>(
			"select count(*)::int as n from issues where project_id = $1",
			[projectId],
		);
		const clone = () =>
			inject("POST", `/api/issues/${mine}/clone`, newcomerSession, {});
		expect((await clone()).statusCode).toBe(404);

		// Even with CREATE_ISSUES granted to everyone, a request that cannot be read cannot be copied.
		const grant = `${schemeSource}:anyone-create`;
		await pool.query(
			"insert into permission_grants (source_id, scheme_id, permission_key, holder_type, raw) select $1, id, 'CREATE_ISSUES', 'anyone', '{}'::jsonb from permission_schemes where source_id = $2",
			[grant, schemeSource],
		);
		try {
			expect((await clone()).statusCode).toBe(404);
		} finally {
			await pool.query("delete from permission_grants where source_id = $1", [
				grant,
			]);
		}
		const after = await pool.query<{ n: number }>(
			"select count(*)::int as n from issues where project_id = $1",
			[projectId],
		);
		expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
	});

	test("open access gives no queues, issue view or settings", async () => {
		const mine = await createRequest(newcomerSession);
		const key = mine.json().key as string;
		for (const url of [
			`/api/servicedesk/projects/${projectKey}/queues`,
			`/api/servicedesk/projects/${projectKey}/queues/${queueId}`,
			`/api/servicedesk/projects/${projectKey}/settings`,
			`/api/servicedesk/issues/${key}/sla`,
			`/api/servicedesk/issues/${key}/request`,
			`/api/issues/${key}`,
		]) {
			const response = await inject("GET", url, newcomerSession);
			expect([403, 404], url).toContain(response.statusCode);
		}
		const patch = await inject(
			"PATCH",
			`/api/servicedesk/projects/${projectKey}/settings`,
			newcomerSession,
			{ openAccess: false },
		);
		expect([403, 404]).toContain(patch.statusCode);
	});

	test("an administrator closes the desk and opens it again", async () => {
		const settings = `/api/servicedesk/projects/${projectKey}/settings`;
		expect((await inject("GET", settings, adminSession)).json()).toEqual({
			openAccess: true,
		});

		const closed = await inject("PATCH", settings, adminSession, {
			openAccess: false,
		});
		expect(closed.json()).toEqual({ openAccess: false });
		expect((await createRequest(newcomerSession)).statusCode).toBe(404);
		const audited = await pool.query(
			"select summary from audit_log where action = 'servicedesk.update' and entity_id = $1",
			[projectId],
		);
		expect(audited.rowCount).toBe(1);

		const reopened = await inject("PATCH", settings, adminSession, {
			openAccess: true,
		});
		expect(reopened.json()).toEqual({ openAccess: true });
		expect((await createRequest(newcomerSession)).statusCode).toBe(201);
		await pool.query(
			"delete from audit_log where action = 'servicedesk.update' and entity_id = $1",
			[projectId],
		);
	});
});

describe("portal access when the desk is closed", () => {
	const schemeSource = `${tag}:portal-scheme`;
	let schemeId: string;
	let outsiderSession: string;

	beforeAll(async () => {
		await pool.query(
			"update service_desks set open_access = false where id = $1",
			[deskId],
		);
		const outsider = await login(app, {
			sub: `${tag}-outsider`,
			username: `t-${run}-outsider`,
			name: "Portal Outsider",
			groups: [],
		});
		outsiderSession = outsider.sessionId as string;
		const [scheme] = await pool
			.query<{ id: string }>(
				"insert into permission_schemes (source_id, name, project_ids, raw) values ($1, $1, $2::jsonb, '{}'::jsonb) returning id",
				[schemeSource, JSON.stringify([projectId])],
			)
			.then((result) => result.rows);
		schemeId = scheme.id;
		await pool.query(
			"insert into permission_grants (source_id, scheme_id, permission_key, holder_type, raw) values ($1, $2, 'CREATE_ISSUES', 'sd.customer.portal.only', '{}'::jsonb)",
			[`${schemeSource}:create`, schemeId],
		);
		await pool.query(
			"insert into project_role_actors (source_id, project_id, role_id, role_name, actor_type, actor_parameter, raw) values ($1, $2, '10300', 'Service Desk Customers', 'user', $3, '{}'::jsonb)",
			[`${schemeSource}:customer`, projectId, `t-${run}-customer`],
		);
	});

	afterAll(async () => {
		await pool.query(
			"update service_desks set open_access = true where id = $1",
			[deskId],
		);
		await pool.query("delete from permission_schemes where source_id = $1", [
			schemeSource,
		]);
		await pool.query("delete from project_role_actors where source_id = $1", [
			`${schemeSource}:customer`,
		]);
	});

	function listed(session: string) {
		return inject("GET", "/api/servicedesk/portals", session).then((response) =>
			(response.json() as { id: string }[]).some((row) => row.id === deskId),
		);
	}

	test("only the desk's customers and holders of CREATE_ISSUES use the portal", async () => {
		expect(await listed(customerSession)).toBe(true);
		expect(await listed(adminSession)).toBe(true);
		expect(await listed(outsiderSession)).toBe(false);

		const portal = `/api/servicedesk/portals/${deskId}`;
		expect((await inject("GET", portal, customerSession)).statusCode).toBe(200);
		expect((await inject("GET", portal, outsiderSession)).statusCode).toBe(404);
		expect(
			(
				await inject(
					"GET",
					`${portal}/request-types/${requestTypeId}`,
					outsiderSession,
				)
			).statusCode,
		).toBe(404);
		expect((await createRequest(outsiderSession)).statusCode).toBe(404);
		expect((await createRequest(customerSession)).statusCode).toBe(201);
	});

	test("a user who may not use the portal gets a 404 from its pages", async () => {
		const outsider = await userFor(outsiderSession);
		await expect(
			loadPortalHome(
				event(outsider, `/servicedesk/customer/portal/${deskId}`, {
					id: deskId,
				}),
			),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			loadPortalCreate(
				event(
					outsider,
					`/servicedesk/customer/portal/${deskId}/create/${requestTypeId}`,
					{ id: deskId, requestTypeId },
				),
			),
		).rejects.toMatchObject({ status: 404 });
	});

	test("a scheme that gives CREATE_ISSUES to anyone keeps the portal open", async () => {
		await pool.query(
			"insert into permission_grants (source_id, scheme_id, permission_key, holder_type, raw) values ($1, $2, 'CREATE_ISSUES', 'anyone', '{}'::jsonb)",
			[`${schemeSource}:anyone`, schemeId],
		);
		expect(await listed(outsiderSession)).toBe(true);
		expect((await createRequest(outsiderSession)).statusCode).toBe(201);
	});
});

test("canViewRequest refuses a desk that does not own the issue", async () => {
	const admin = await userFor(adminSession);
	const otherDesk = {
		id: randomUUID(),
		projectId: randomUUID(),
		projectKey: "OTHER",
		projectName: "Other desk",
		portalName: "Other portal",
		description: null,
		announcement: null,
		openAccess: false,
		leadId: null,
	};
	const issue = {
		id: randomUUID(),
		projectId,
		requestTypeId,
		reporterId: null,
		creatorId: null,
	};
	expect(await canViewRequest(admin, otherDesk, issue)).toBe(false);
});

describe("review regressions", () => {
	test("the sprint lookup runs once per field and filters in SQL", async () => {
		const [rule] = await db
			.select()
			.from(automationRules)
			.where(eq(automationRules.deskId, deskId))
			.limit(1);
		if (!rule) throw new Error("fixture rule missing");
		const [duplicate] = await db
			.insert(automationRules)
			.values({
				sourceId: `${tag}:rule:duplicate`,
				deskId,
				name: `${tag} Rule duplicate`,
				enabled: true,
				trigger: rule.trigger,
				conditions: rule.conditions,
				actions: rule.actions,
				raw: {},
			})
			.returning();

		const querySpy = vi.spyOn(Pool.prototype, "query");
		const outcome = await applyCreateAutomation(seededIssueId);
		const queries = querySpy.mock.calls.map((call) =>
			typeof call[0] === "string"
				? call[0]
				: ((call[0] as { text?: string }).text ?? ""),
		);
		querySpy.mockRestore();
		const issueQueries = queries.filter((text) =>
			text.includes('from "issues"'),
		);

		expect(outcome.applied.length).toBeGreaterThanOrEqual(2);
		expect(issueQueries).toHaveLength(2);
		expect(
			issueQueries.some((text) => text.includes("jsonb_array_elements_text")),
		).toBe(true);

		await db
			.delete(automationRules)
			.where(eq(automationRules.id, duplicate.id));
	});

	test("a CURRENT reference for a non-sprint field is skipped", async () => {
		const fieldId = `${tag}:customfield:not-sprint`;
		const [rule] = await db
			.insert(automationRules)
			.values({
				sourceId: `${tag}:rule:not-sprint`,
				deskId,
				name: `${tag} Not a sprint`,
				enabled: true,
				trigger: {
					type: "jira.issue.event.trigger:created",
					value: { eventKey: "jira:issue_created" },
				},
				conditions: [],
				actions: [
					{
						type: "jira.issue.edit",
						value: {
							operations: [
								{
									type: "SET",
									fieldId,
									fieldType:
										"com.atlassian.jira.plugin.system.customfieldtypes:userpicker",
									value: { type: "REFERENCE", value: "CURRENT" },
								},
							],
						},
					},
				],
				raw: {},
			})
			.returning();

		const outcome = await applyCreateAutomation(seededIssueId);
		expect(outcome.skipped).toContain(`${rule.name}: ${fieldId}`);
		const [issue] = await db
			.select({ custom: issues.custom })
			.from(issues)
			.where(eq(issues.id, seededIssueId));
		expect((issue.custom as Record<string, unknown>)[fieldId]).toBeUndefined();

		await db.delete(automationRules).where(eq(automationRules.id, rule.id));
	});

	test("the portal validates number, url and user custom fields", async () => {
		const [source] = await db
			.select({ issueTypeId: requestTypes.issueTypeId })
			.from(requestTypes)
			.where(eq(requestTypes.id, requestTypeId));
		if (!source) throw new Error("fixture request type missing");
		const [requestType] = await db
			.insert(requestTypes)
			.values({
				sourceId: `${tag}:rt:validation`,
				deskId,
				issueTypeId: source.issueTypeId,
				name: `${tag} Validation`,
				sequence: 10,
			})
			.returning();
		const [numberField] = await db
			.insert(fields)
			.values({
				sourceId: `${tag}:customfield:number`,
				name: "Count",
				type: "number",
				customKey: "com.atlassian.jira.plugin.system.customfieldtypes:float",
			})
			.returning();
		const [urlField] = await db
			.insert(fields)
			.values({
				sourceId: `${tag}:customfield:url`,
				name: "Link",
				type: "string",
				customKey: "com.atlassian.jira.plugin.system.customfieldtypes:url",
			})
			.returning();
		const [userField] = await db
			.insert(fields)
			.values({
				sourceId: `${tag}:customfield:user`,
				name: "Owner",
				type: "user",
				customKey:
					"com.atlassian.jira.plugin.system.customfieldtypes:userpicker",
			})
			.returning();
		await db.insert(requestTypeFields).values([
			{
				requestTypeId: requestType.id,
				fieldId: "summary",
				label: "Summary",
				required: true,
				sequence: 0,
			},
			{
				requestTypeId: requestType.id,
				fieldId: numberField.sourceId,
				label: "Count",
				sequence: 1,
			},
			{
				requestTypeId: requestType.id,
				fieldId: urlField.sourceId,
				label: "Link",
				sequence: 2,
			},
			{
				requestTypeId: requestType.id,
				fieldId: userField.sourceId,
				label: "Owner",
				sequence: 3,
			},
		]);

		try {
			const badNumber = await inject(
				"POST",
				`/api/servicedesk/portals/${deskId}/requests`,
				customerSession,
				{
					requestTypeId: requestType.id,
					summary: "Bad number",
					fields: { [numberField.sourceId]: "abc" },
				},
			);
			expect(badNumber.statusCode).toBe(400);

			const badUrl = await inject(
				"POST",
				`/api/servicedesk/portals/${deskId}/requests`,
				customerSession,
				{
					requestTypeId: requestType.id,
					summary: "Bad url",
					fields: { [urlField.sourceId]: "javascript:alert(1)" },
				},
			);
			expect(badUrl.statusCode).toBe(400);

			const created = await inject(
				"POST",
				`/api/servicedesk/portals/${deskId}/requests`,
				customerSession,
				{
					requestTypeId: requestType.id,
					summary: "Valid user",
					fields: { [userField.sourceId]: customerId },
				},
			);
			expect(created.statusCode).toBe(201);
			const row = await issueRow(created.json().key);
			expect(row.custom[userField.sourceId]).toEqual({
				id: customerId,
				name: `t-${run}-customer`,
				displayName: "Portal Customer",
			});
		} finally {
			await db
				.delete(requestTypeFields)
				.where(eq(requestTypeFields.requestTypeId, requestType.id));
			await db
				.delete(fields)
				.where(inArray(fields.id, [numberField.id, urlField.id, userField.id]));
			await db.delete(requestTypes).where(eq(requestTypes.id, requestType.id));
		}
	});

	test("a cycle resolves the goal and calendar it was computed with", async () => {
		const created = await createRequest(customerSession, {
			summary: "SLA goal identity",
		});
		const key = created.json().key;
		const [issue] = await db
			.select({ id: issues.id })
			.from(issues)
			.where(eq(issues.key, key));
		if (!issue) throw new Error("created issue missing");

		const [secondCalendar] = await db
			.insert(slaCalendars)
			.values({
				sourceId: `${tag}:calendar:second`,
				name: `${tag} Second calendar`,
				timezone: "Europe/Berlin",
				workingHours: week,
				holidays: [],
			})
			.returning();
		const [secondGoal] = await db
			.insert(slaGoals)
			.values({
				sourceId: `${tag}:goal:second`,
				metricId: resolutionMetricId,
				jql: "",
				goalMinutes: 60,
				calendarId: secondCalendar.id,
				sequence: 1,
			})
			.returning();

		try {
			await db.delete(slaCycles).where(eq(slaCycles.issueId, issue.id));
			await db.insert(slaCycles).values({
				issueId: issue.id,
				metricId: resolutionMetricId,
				cycleNumber: 1,
				startedAt: new Date("2026-01-05T09:00:00Z"),
				stoppedAt: new Date("2026-01-05T10:00:00Z"),
				pausedIntervals: [],
				goalId: secondGoal.id,
				goalMinutes: 60,
				elapsedMinutes: 60,
				breached: false,
				computedAt: new Date("2026-01-05T10:00:00Z"),
			});

			const metrics = await issueSla(
				issue.id,
				new Date("2026-01-05T11:00:00Z"),
			);
			const metric = metrics.find((item) => item.id === resolutionMetricId);
			expect(metric?.calendar?.name).toBe(`${tag} Second calendar`);
		} finally {
			await db.delete(slaGoals).where(eq(slaGoals.id, secondGoal.id));
			await db
				.delete(slaCalendars)
				.where(eq(slaCalendars.id, secondCalendar.id));
		}
	});
});

describe("review follow-ups", () => {
	function sprint(id: number, name: string) {
		return `com.atlassian.greenhopper.service.sprint.Sprint@[activatedDate=2026-10-01T09:00:00.000Z,id=${id},name=${name},state=ACTIVE]`;
	}

	function createdRule(fieldId: string, name: string) {
		return {
			trigger: {
				type: "jira.issue.event.trigger:created",
				value: { eventKey: "jira:issue_created" },
			},
			conditions: [],
			actions: [
				{
					type: "jira.issue.edit",
					value: {
						operations: [
							{
								type: "SET",
								fieldId,
								fieldType: "com.pyxis.greenhopper.jira:gh-sprint",
								value: { type: "REFERENCE", value: "CURRENT" },
							},
						],
					},
				},
			],
			name,
			enabled: true,
			raw: {},
		};
	}

	test("a project with two desks resolves one desk deterministically", async () => {
		const duplicateId = "00000000-0000-4000-8000-000000000001";
		await pool.query(
			"insert into service_desks (id, source_id, project_id, portal_name) values ($1, $2, $3, $4)",
			[duplicateId, `${tag}:desk:duplicate`, projectId, "Duplicate portal"],
		);
		try {
			expect((await deskByProjectId(projectId))?.id).toBe(duplicateId);
		} finally {
			await pool.query("delete from service_desks where id = $1", [
				duplicateId,
			]);
		}
	});

	test("participation checks read watchers and commenters in one query", async () => {
		const watched = await createRequest(customerSession, {
			summary: "Participation watched",
		});
		const commented = await createRequest(customerSession, {
			summary: "Participation commented",
		});
		const [watchedIssue] = await db
			.select({ id: issues.id })
			.from(issues)
			.where(eq(issues.key, watched.json().key));
		const [commentedIssue] = await db
			.select({ id: issues.id })
			.from(issues)
			.where(eq(issues.key, commented.json().key));
		if (!watchedIssue || !commentedIssue) {
			throw new Error("created issue missing");
		}
		const watchSource = `${tag}:watch:participation`;
		const commentSource = `${tag}:comment:participation`;
		await db.insert(watchers).values({
			sourceId: watchSource,
			issueId: watchedIssue.id,
			userId: customerId,
		});
		await db.insert(comments).values({
			sourceId: commentSource,
			issueId: commentedIssue.id,
			authorId: customerId,
			bodyHtml: "<p>I am following this</p>",
			bodySource: "I am following this",
			created: new Date(),
			updated: new Date(),
		});
		try {
			const querySpy = vi.spyOn(Pool.prototype, "query");
			const commenter = await isParticipant(customerId, commentedIssue.id);
			const commenterQueries = querySpy.mock.calls.length;
			querySpy.mockClear();
			const ids = await participatingIssueIds(customerId);
			const listQueries = querySpy.mock.calls.length;
			querySpy.mockClear();
			const watcher = await isParticipant(customerId, watchedIssue.id);
			const watcherQueries = querySpy.mock.calls.length;
			querySpy.mockRestore();

			expect(commenter).toBe(true);
			expect(commenterQueries).toBe(1);
			expect(watcher).toBe(true);
			expect(watcherQueries).toBe(1);
			expect(listQueries).toBe(1);
			expect(ids).toContain(watchedIssue.id);
			expect(ids).toContain(commentedIssue.id);
			expect(new Set(ids).size).toBe(ids.length);
		} finally {
			await db.delete(watchers).where(eq(watchers.sourceId, watchSource));
			await db.delete(comments).where(eq(comments.sourceId, commentSource));
		}
	});
	test("a sprint name keeps brackets and comma-word sequences", async () => {
		const fieldId = `${tag}:customfield:sprint-name`;
		const raw = sprint(91, "Sprint [Q3], phase=2");
		await pool.query(
			"update issues set custom = custom || $1::jsonb where id = $2",
			[JSON.stringify({ [fieldId]: [raw] }), seededIssueId],
		);
		const [rule] = await db
			.insert(automationRules)
			.values({
				sourceId: `${tag}:rule:sprint-name`,
				deskId,
				...createdRule(fieldId, `${tag} Sprint name`),
			})
			.returning();
		try {
			const outcome = await applyCreateAutomation(seededIssueId);
			expect(outcome.applied).toContain(
				`${rule.name}: ${fieldId}=Sprint [Q3], phase=2`,
			);
		} finally {
			await db.delete(automationRules).where(eq(automationRules.id, rule.id));
			await pool.query("update issues set custom = custom - $1 where id = $2", [
				fieldId,
				seededIssueId,
			]);
		}
	});

	test("a broken automation rule does not fail request creation", async () => {
		const ruleId = randomUUID();
		await pool.query(
			`insert into automation_rules
			 (id, source_id, desk_id, name, enabled, trigger, conditions, actions, raw)
			 values ($1, $2, $3, $4, true, $5::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb)`,
			[
				ruleId,
				`${tag}:rule:broken`,
				deskId,
				`${tag} Broken rule`,
				JSON.stringify({
					type: "jira.issue.event.trigger:created",
					value: { eventKey: "jira:issue_created" },
				}),
			],
		);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const response = await createRequest(customerSession, {
				summary: "Automation failure",
			});
			expect(response.statusCode).toBe(201);
		} finally {
			errorSpy.mockRestore();
			await pool.query("delete from automation_rules where id = $1", [ruleId]);
		}
	});

	test("the rule query does not read the raw payload", async () => {
		const querySpy = vi.spyOn(Pool.prototype, "query");
		await applyCreateAutomation(seededIssueId);
		const queries = querySpy.mock.calls.map((call) =>
			typeof call[0] === "string"
				? call[0]
				: ((call[0] as { text?: string }).text ?? ""),
		);
		querySpy.mockRestore();
		const ruleQuery = queries.find((text) =>
			text.includes('from "automation_rules"'),
		);
		expect(ruleQuery).toBeDefined();
		expect(ruleQuery).not.toContain('"raw"');
		expect(ruleQuery).toContain('"trigger"');
	});

	test("an automation update keeps a concurrent custom-field write", async () => {
		const fieldId = `${tag}:customfield:sprint-race`;
		const concurrentKey = `${tag}:customfield:concurrent`;
		const raw = sprint(92, "Sprint race");
		const [seed] = await db
			.select({ typeId: issues.typeId, statusId: issues.statusId })
			.from(issues)
			.where(eq(issues.id, seededIssueId));
		if (!seed) throw new Error("fixture issue missing");
		const [source] = await db
			.insert(issues)
			.values({
				sourceId: `${tag}:issue:sprint-race`,
				projectId,
				number: 9000,
				key: `${projectKey}-9000`,
				typeId: seed.typeId,
				statusId: seed.statusId,
				summary: "Sprint race source",
				custom: { [fieldId]: [raw] },
			})
			.returning({ id: issues.id });
		const [rule] = await db
			.insert(automationRules)
			.values({
				sourceId: `${tag}:rule:sprint-race`,
				deskId,
				...createdRule(fieldId, `${tag} Sprint race`),
			})
			.returning();

		const originalUpdate = db.update;
		let injected = false;
		const wrap = (target: object): object =>
			new Proxy(target, {
				get(builder, property) {
					if (property === "then") {
						return (
							resolve: (value: unknown) => void,
							reject: (reason: unknown) => void,
						) => {
							void (async () => {
								if (!injected) {
									injected = true;
									await pool.query(
										"update issues set custom = custom || $1::jsonb where id = $2",
										[
											JSON.stringify({ [concurrentKey]: "kept" }),
											seededIssueId,
										],
									);
								}
								resolve(await (builder as PromiseLike<unknown>));
							})().catch(reject);
						};
					}
					const value = Reflect.get(builder, property);
					return typeof value === "function"
						? (...args: unknown[]) => wrap(value.apply(builder, args))
						: value;
				},
			});
		db.update = ((table: Parameters<typeof originalUpdate>[0]) =>
			wrap(originalUpdate(table))) as typeof db.update;
		try {
			await applyCreateAutomation(seededIssueId);
			const [row] = await db
				.select({ custom: issues.custom })
				.from(issues)
				.where(eq(issues.id, seededIssueId));
			expect((row.custom as Record<string, unknown>)[concurrentKey]).toBe(
				"kept",
			);
		} finally {
			db.update = originalUpdate;
			await pool.query("update issues set custom = custom - $1 where id = $2", [
				concurrentKey,
				seededIssueId,
			]);
			await db.delete(automationRules).where(eq(automationRules.id, rule.id));
			await db.delete(issues).where(eq(issues.id, source.id));
		}
	});

	test("an automation that changes nothing leaves the issue timestamp alone", async () => {
		const [before] = await db
			.select({ updated: issues.updated })
			.from(issues)
			.where(eq(issues.id, seededIssueId));
		const outcome = await applyCreateAutomation(seededIssueId);
		const [after] = await db
			.select({ updated: issues.updated })
			.from(issues)
			.where(eq(issues.id, seededIssueId));
		expect(outcome.applied.length).toBeGreaterThan(0);
		expect(after.updated).toEqual(before.updated);
	});
});
