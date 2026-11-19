import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, type Page, test } from "./fixtures.ts";

test.use({ timezoneId: "Pacific/Auckland", locale: "de-DE" });

const run = randomUUID().slice(0, 8);
const projectKey = `DT${run.slice(0, 4).toUpperCase()}`;
const projectName = `Dates e2e ${run}`;
const issueSummary = `Dates e2e issue ${run}`;
const issueTypeName = `Dates e2e Task ${run}`;
const priorityName = `Dates e2e Medium ${run}`;
const statusName = `Dates e2e To Do ${run}`;
const workflowName = `Dates e2e Workflow ${run}`;
const spaceKey = `DTW${run.slice(0, 4).toUpperCase()}`;
const spaceName = `Dates e2e space ${run}`;
const pageTitle = `Dates e2e page ${run}`;
const commentBody = `Dates e2e comment ${run}`;
const adminUsername = `dates-e2e-${run}`;
const adminPassword = `Dates-e2e-${run}-password`;
const portalProjectKey = `DTP${run.slice(0, 4).toUpperCase()}`;
const portalProjectName = `Dates e2e desk ${run}`;
const portalName = `Dates e2e portal ${run}`;
const portalIssueKey = `${portalProjectKey}-1`;
const timeZone = "Pacific/Auckland";
const locale = "de-DE";

let client: Client;
let projectId: string | null = null;
let issueTypeId: string | null = null;
let priorityId: string | null = null;
let statusId: string | null = null;
let workflowId: string | null = null;
let portalProjectId: string | null = null;
let portalDeskId: string | null = null;
let portalCreated: string | null = null;
let adminUserId: string | null = null;

function watchConsole(page: Page) {
	const problems: string[] = [];
	page.on("console", (message) => {
		if (
			message.type() === "error" ||
			(message.type() === "warning" && /hydrat/i.test(message.text()))
		) {
			problems.push(message.text());
		}
	});
	page.on("pageerror", (error) => problems.push(error.message));
	return problems;
}

function absoluteDate(value: string, zone = timeZone) {
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: zone,
	}).format(new Date(value));
}

function calendarDateTime(value: string) {
	return new Intl.DateTimeFormat(locale, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		timeZone,
	}).format(new Date(value));
}

function shortDate(value: string) {
	const parts = new Intl.DateTimeFormat("en-US", {
		day: "2-digit",
		month: "short",
		year: "2-digit",
		timeZone,
	}).formatToParts(new Date(value));
	const part = (type: string) =>
		parts.find((item) => item.type === type)?.value ?? "";
	return `${part("day")}/${part("month")}/${part("year")}`;
}

function relativeText(value: string, zone: string) {
	const time = new Intl.DateTimeFormat(locale, {
		hour: "numeric",
		minute: "2-digit",
		timeZone: zone,
	}).format(new Date(value));
	return `2 days ago ${time}`;
}

function rowAround(html: string, marker: string) {
	let index = html.indexOf(marker);
	while (index !== -1) {
		const start = html.lastIndexOf("<tr", index);
		const end = html.indexOf("</tr>", index);
		if (start !== -1 && end !== -1 && start < index && index < end) {
			return html.slice(start, end);
		}
		index = html.indexOf(marker, index + 1);
	}
	throw new Error(`The response has no table row for ${marker}`);
}

function commentAround(html: string, marker: string) {
	const index = html.indexOf(marker);
	if (index === -1) throw new Error(`The response does not contain ${marker}`);
	const start = html.lastIndexOf('<div class="wiki-comment"', index);
	if (start === -1) throw new Error("The response has no comment markup");
	return html.slice(start, index);
}

test.beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	const issueType = await client.query<{ id: string }>(
		`insert into issue_types (source_id, name, icon_url)
		 values ($1, $2, 'builtin:task') returning id`,
		[`e2e:${run}:issue-type`, issueTypeName],
	);
	issueTypeId = issueType.rows[0]?.id ?? null;

	const priority = await client.query<{ id: string }>(
		`insert into priorities (source_id, name, sequence)
		 values ($1, $2, 2) returning id`,
		[`e2e:${run}:priority`, priorityName],
	);
	priorityId = priority.rows[0]?.id ?? null;

	const status = await client.query<{ id: string }>(
		`insert into statuses (source_id, name, category)
		 values ($1, $2, 'new') returning id`,
		[`e2e:${run}:status`, statusName],
	);
	statusId = status.rows[0]?.id ?? null;

	const workflow = await client.query<{ id: string }>(
		"insert into workflows (source_id, name) values ($1, $2) returning id",
		[`e2e:${run}:workflow`, workflowName],
	);
	workflowId = workflow.rows[0]?.id ?? null;
	if (!workflowId || !statusId) throw new Error("Workflow was not created");
	await client.query(
		`insert into workflow_statuses (source_id, workflow_id, status_id)
		 values ($1, $2, $3)`,
		[`e2e:${run}:workflow-status`, workflowId, statusId],
	);

	const project = await client.query<{ id: string }>(
		`insert into projects
		 (source_id, key, name, project_type, last_issue_number)
		 values ($1, $2, $3, 'software', 0) returning id`,
		[`e2e:${run}:project`, projectKey, projectName],
	);
	projectId = project.rows[0]?.id ?? null;
	if (!projectId || !issueTypeId) throw new Error("Project was not created");
	await client.query(
		`insert into project_issue_types (source_id, project_id, issue_type_id)
		 values ($1, $2, $3)`,
		[`e2e:${run}:project-type`, projectId, issueTypeId],
	);
	await client.query(
		`insert into project_workflows
		 (source_id, project_id, issue_type_id, workflow_id)
		 values ($1, $2, $3, $4)`,
		[`e2e:${run}:project-workflow`, projectId, issueTypeId, workflowId],
	);

	const portalProject = await client.query<{ id: string }>(
		`insert into projects
		 (source_id, key, name, project_type, last_issue_number)
		 values ($1, $2, $3, 'service_desk', 1) returning id`,
		[`e2e:${run}:portal-project`, portalProjectKey, portalProjectName],
	);
	portalProjectId = portalProject.rows[0]?.id ?? null;
	if (!portalProjectId || !issueTypeId || !statusId || !workflowId) {
		throw new Error("Portal project was not created");
	}
	await client.query(
		`insert into project_issue_types (source_id, project_id, issue_type_id)
		 values ($1, $2, $3)`,
		[`e2e:${run}:portal-project-type`, portalProjectId, issueTypeId],
	);
	await client.query(
		`insert into project_workflows
		 (source_id, project_id, issue_type_id, workflow_id)
		 values ($1, $2, $3, $4)`,
		[
			`e2e:${run}:portal-project-workflow`,
			portalProjectId,
			issueTypeId,
			workflowId,
		],
	);
	const desk = await client.query<{ id: string }>(
		`insert into service_desks
		 (source_id, project_id, portal_name, description, open_access)
		 values ($1, $2, $3, $4, true) returning id`,
		[`e2e:${run}:desk`, portalProjectId, portalName, "Dates end-to-end portal"],
	);
	portalDeskId = desk.rows[0]?.id ?? null;
	if (!portalDeskId) throw new Error("Portal was not created");
	const portalRequestType = await client.query<{ id: string }>(
		`insert into request_types (source_id, desk_id, issue_type_id, name, sequence)
		 values ($1, $2, $3, $4, 0) returning id`,
		[
			`e2e:${run}:portal-request-type`,
			portalDeskId,
			issueTypeId,
			`Dates e2e request type ${run}`,
		],
	);
	const portalRequestTypeId = portalRequestType.rows[0]?.id;
	if (!portalRequestTypeId)
		throw new Error("Portal request type was not created");
	const portalIssue = await client.query<{ created: Date }>(
		`insert into issues
		 (source_id, project_id, number, key, type_id, status_id, request_type_id,
		  summary, created, updated)
		 values ($1, $2, 1, $3, $4, $5, $6, $7, now() - interval '2 days',
		  now() - interval '2 days')
		 returning created`,
		[
			`e2e:${run}:portal-issue`,
			portalProjectId,
			portalIssueKey,
			issueTypeId,
			statusId,
			portalRequestTypeId,
			`Dates e2e portal request ${run}`,
		],
	);
	portalCreated = portalIssue.rows[0]?.created.toISOString() ?? null;
	if (!portalCreated) throw new Error("Portal issue was not created");
});

test.afterAll(async () => {
	if (projectId) {
		await client.query("delete from issues where project_id = $1", [projectId]);
		await client.query("delete from projects where id = $1", [projectId]);
	}
	if (portalProjectId) {
		await client.query("delete from issues where project_id = $1", [
			portalProjectId,
		]);
		await client.query("delete from projects where id = $1", [portalProjectId]);
	}
	if (workflowId) {
		await client.query("delete from workflows where id = $1", [workflowId]);
	}
	if (issueTypeId) {
		await client.query("delete from issue_types where id = $1", [issueTypeId]);
	}
	if (priorityId) {
		await client.query("delete from priorities where id = $1", [priorityId]);
	}
	if (statusId) {
		await client.query("delete from statuses where id = $1", [statusId]);
	}
	await client.query("delete from spaces where key = $1", [spaceKey]);
	if (adminUserId) {
		await client.query("delete from audit_log where entity_id = $1", [
			adminUserId,
		]);
	}
	await client.query("delete from users where username = $1", [adminUsername]);
	await client.end();
});

test("dates render in the browser's zone and locale on the server too", async ({
	page,
	request,
}) => {
	test.setTimeout(90_000);
	const problems = watchConsole(page);
	const baseURL = test.info().project.use.baseURL as string;
	let dataRequests = 0;
	page.on("request", (request) => {
		if (request.url().includes("__data.json")) dataRequests += 1;
	});

	// Sign in through the API so the browser context has a session but no date cookies yet.
	await request.get("/auth/login?returnTo=/");
	const cookies = (await request.storageState()).cookies;
	const sid = cookies.find((cookie) => cookie.name === "sid");
	expect(sid).toBeTruthy();
	await page.context().addCookies([
		{
			name: "sid",
			value: sid?.value ?? "",
			url: baseURL,
			httpOnly: true,
			sameSite: "Lax",
		},
	]);

	const headers = {
		"x-requested-with": "rvna",
		origin: baseURL,
	};
	const createdIssue = await request.post("/api/issues", {
		headers,
		data: {
			project: projectKey,
			type: issueTypeId,
			summary: issueSummary,
		},
	});
	expect(createdIssue.status()).toBe(201);
	const issue = (await createdIssue.json()) as {
		key: string;
		created: string;
	};

	const createdUser = await request.post("/api/admin/users", {
		headers,
		data: {
			username: adminUsername,
			displayName: "Dates e2e user",
			password: adminPassword,
			mustChangePassword: false,
		},
	});
	expect(createdUser.status()).toBe(201);
	const user = (await createdUser.json()) as { user: { id: string } };
	adminUserId = user.user.id;

	const audit = await client.query<{ created_at: Date }>(
		`select created_at from audit_log
		 where entity_id = $1 and action = 'user.create'
		 order by created_at desc limit 1`,
		[user.user.id],
	);
	const auditCreated = audit.rows[0]?.created_at.toISOString();
	if (!auditCreated) throw new Error("The audit entry was not written");

	const createdSpace = await request.post("/api/wiki/spaces", {
		headers,
		data: { key: spaceKey, name: spaceName },
	});
	expect(createdSpace.status()).toBe(201);

	const createdPage = await request.post("/api/wiki/pages", {
		headers,
		data: {
			spaceKey,
			title: pageTitle,
			bodyDoc: { type: "doc", content: [{ type: "paragraph" }] },
		},
	});
	expect(createdPage.status()).toBe(201);
	const wikiPage = (await createdPage.json()) as { id: string };

	const createdComment = await request.post(
		`/api/wiki/pages/${wikiPage.id}/comments`,
		{
			headers,
			data: { bodyHtml: `<p>${commentBody}</p>` },
		},
	);
	expect(createdComment.status()).toBe(201);
	const comment = (await createdComment.json()) as { created: string };

	// First visit without tz/locale cookies: this response is Helsinki, then the shell
	// stores the browser's values and refreshes the page once.
	const issueList = `/projects/${projectKey}/issues`;
	const firstResponse = await page.goto(issueList);
	expect(firstResponse?.status()).toBe(200);
	const firstHtml = await firstResponse?.text();
	if (!firstHtml) throw new Error("The first issue list response was empty");
	const firstRow = rowAround(firstHtml, issue.key);
	const serverFallbackZone = process.env.APP_TIME_ZONE ?? "Europe/Helsinki";
	expect(firstRow).toContain(absoluteDate(issue.created, serverFallbackZone));
	expect(firstRow).not.toContain(absoluteDate(issue.created));

	const issueRow = page.locator("tbody tr", { hasText: issue.key });
	const createdCell = issueRow.locator("td").nth(8);
	await expect(createdCell).toHaveText(shortDate(issue.created));
	await expect(createdCell).toHaveAttribute(
		"title",
		absoluteDate(issue.created),
	);
	const browserCookies = await page.context().cookies();
	expect(
		decodeURIComponent(
			browserCookies.find((cookie) => cookie.name === "tz")?.value ?? "",
		),
	).toBe(timeZone);
	expect(
		decodeURIComponent(
			browserCookies.find((cookie) => cookie.name === "locale")?.value ?? "",
		),
	).toBe(locale);
	expect(dataRequests).toBe(1);

	const secondResponse = await page.request.get(issueList, {
		headers: { Accept: "text/html" },
	});
	expect(secondResponse.status()).toBe(200);
	const secondHtml = await secondResponse.text();
	const secondRow = rowAround(secondHtml, issue.key);
	expect(secondRow).toContain(absoluteDate(issue.created));
	expect(secondRow).toContain(`>${shortDate(issue.created)}</td>`);

	// The audit log renders an absolute date and a relative date for the entry the API wrote.
	const auditUrl = "/secure/admin/ViewAuditLog.jspa";
	await page.goto(auditUrl);
	const auditRow = page.locator("tbody tr", { hasText: adminUsername });
	await expect(auditRow.locator("td").nth(1).locator("div").first()).toHaveText(
		absoluteDate(auditCreated),
	);
	const auditHtml = await (
		await page.request.get(auditUrl, { headers: { Accept: "text/html" } })
	).text();
	expect(rowAround(auditHtml, adminUsername)).toContain(
		`<div>${absoluteDate(auditCreated)}</div>`,
	);

	// The wiki comment shows a date and time in the same zone and locale.
	const wikiUrl = `/pages/viewpage.action?pageId=${wikiPage.id}`;
	await page.goto(wikiUrl);
	const wikiComment = page.locator(".wiki-comment", { hasText: commentBody });
	await expect(
		wikiComment.locator(".wiki-comment-head span").nth(1),
	).toHaveText(calendarDateTime(comment.created));
	const wikiHtml = await (
		await page.request.get(wikiUrl, { headers: { Accept: "text/html" } })
	).text();
	expect(commentAround(wikiHtml, commentBody)).toContain(
		`<span>${calendarDateTime(comment.created)}</span>`,
	);

	expect(problems).toEqual([]);
});

test("the customer portal renders the request date in the browser's zone after one refresh", async ({
	page,
	request,
}) => {
	test.setTimeout(60_000);
	const problems = watchConsole(page);
	const baseURL = test.info().project.use.baseURL as string;
	if (!portalDeskId || !portalCreated) {
		throw new Error("The portal fixture was not created");
	}

	await request.get("/auth/login?returnTo=/");
	const cookies = (await request.storageState()).cookies;
	const sid = cookies.find((cookie) => cookie.name === "sid");
	expect(sid).toBeTruthy();
	await page.context().addCookies([
		{
			name: "sid",
			value: sid?.value ?? "",
			url: baseURL,
			httpOnly: true,
			sameSite: "Lax",
		},
	]);

	let dataRequests = 0;
	page.on("request", (request) => {
		if (request.url().includes("__data.json")) dataRequests += 1;
	});

	const portalUrl = `/servicedesk/customer/portal/${portalDeskId}/${portalIssueKey}`;
	const firstResponse = await page.goto(portalUrl);
	expect(firstResponse?.status()).toBe(200);
	const firstHtml = await firstResponse?.text();
	if (!firstHtml) throw new Error("The first portal response was empty");

	const fallbackZone = process.env.APP_TIME_ZONE ?? "Europe/Helsinki";
	const fallbackText = relativeText(portalCreated, fallbackZone);
	const browserText = relativeText(portalCreated, timeZone);
	expect(firstHtml).toContain(fallbackText);
	expect(firstHtml).not.toContain(browserText);

	const created = page.locator(".details span[title]").first();
	await expect(created).toHaveText(browserText);
	await expect(created).toHaveAttribute("title", absoluteDate(portalCreated));

	const browserCookies = await page.context().cookies();
	expect(
		decodeURIComponent(
			browserCookies.find((cookie) => cookie.name === "tz")?.value ?? "",
		),
	).toBe(timeZone);
	expect(
		decodeURIComponent(
			browserCookies.find((cookie) => cookie.name === "locale")?.value ?? "",
		),
	).toBe(locale);
	expect(dataRequests).toBe(1);
	expect(problems).toEqual([]);
});
