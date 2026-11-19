import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runMigrations } from "../src/lib/server/db.ts";
import { injectAs, makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	type SeedResult,
} from "./fixtures/project.ts";
import { buildServer, cleanupTestData } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = newRun();
let app: TestApp;
let client: Client;
let agent: TestUser;
let customer: TestUser;
let seeded: SeedResult;

function mentionHtml(userId: string) {
	return `<p>See <a class="user-hover" data-user-id="${userId}">@someone</a></p>`;
}

async function notificationsFor(userId: string) {
	const result = await client.query<{
		payload: { commentHtml: string | null };
	}>(
		"select payload from notifications where user_id = $1 and issue_key = $2",
		[userId, seeded.issueKeys[0]],
	);
	return result.rows;
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	await app.ready();
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();

	agent = await makeUser(run, "agent");
	customer = await makeUser(run, "customer");
	seeded = await createProjectFixture(client, {
		run,
		key: fixtureKey(run),
		leadId: agent.id,
		admins: [agent.username],
		issues: [{ summary: "Printer is on fire", reporterId: customer.id }],
	});
	await client.query(
		"insert into service_desks (source_id, project_id, portal_name) values ($1, $2, 'Desk')",
		[`fixture:${run}:desk`, seeded.projectId],
	);
});

afterAll(async () => {
	await app.close();
	await client.query("delete from service_desks where source_id = $1", [
		`fixture:${run}:desk`,
	]);
	await dropProjectFixture(client, run);
	await cleanupTestData(run);
	await client.end();
});

describe("internal comments", () => {
	const url = () => `/api/issues/${seeded.issueKeys[0]}/comments`;

	test("a customer cannot write an internal comment", async () => {
		const response = await injectAs(app, customer.session, "POST", url(), {
			body: "<p>secret</p>",
			internal: true,
		});
		expect(response.statusCode).toBe(403);
	});

	test("a public agent comment notifies the reporter", async () => {
		const response = await injectAs(app, agent.session, "POST", url(), {
			body: "<p>public reply</p>",
		});
		expect(response.statusCode).toBe(201);
		const rows = await notificationsFor(customer.id);
		expect(rows.map((row) => row.payload.commentHtml)).toContain(
			"<p>public reply</p>",
		);
	});

	test("an internal comment is hidden from the customer and never reaches their bell or mail queue", async () => {
		const before = (await notificationsFor(customer.id)).length;
		const response = await injectAs(app, agent.session, "POST", url(), {
			body: `<p>internal note ${mentionHtml(customer.id)}</p>`,
			internal: true,
		});
		expect(response.statusCode).toBe(201);

		const rows = await notificationsFor(customer.id);
		expect(rows.length).toBe(before);
		expect(JSON.stringify(rows)).not.toContain("internal note");

		const bell = await injectAs(
			app,
			customer.session,
			"GET",
			"/api/notifications",
		);
		expect(JSON.stringify(bell.json())).not.toContain("internal note");

		const queued = await client.query(
			"select events::text as events from email_batches where user_id = $1",
			[customer.id],
		);
		expect(JSON.stringify(queued.rows)).not.toContain("internal note");

		const customerList = await injectAs(app, customer.session, "GET", url());
		expect(JSON.stringify(customerList.json())).not.toContain("internal note");
		const agentList = await injectAs(app, agent.session, "GET", url());
		expect(JSON.stringify(agentList.json())).toContain("internal note");
	});

	test("an edited internal comment stays hidden", async () => {
		const created = await injectAs(app, agent.session, "POST", url(), {
			body: "<p>first draft</p>",
			internal: true,
		});
		const before = (await notificationsFor(customer.id)).length;
		const edited = await injectAs(
			app,
			agent.session,
			"PATCH",
			`${url()}/${created.json().id}`,
			{ body: `<p>edited internal ${mentionHtml(customer.id)}</p>` },
		);
		expect(edited.statusCode).toBe(200);
		const rows = await notificationsFor(customer.id);
		expect(rows.length).toBe(before);
		expect(JSON.stringify(rows)).not.toContain("edited internal");
	});
	test("the dashboard activity stream hides internal comments from the customer", async () => {
		async function stream(session: string) {
			const dashboard = await injectAs(
				app,
				session,
				"POST",
				"/api/dashboards",
				{
					name: `Activity ${run}`,
				},
			);
			const gadget = await injectAs(
				app,
				session,
				"POST",
				`/api/dashboards/${dashboard.json().id}/gadgets`,
				{
					type: "activity-stream",
					config: { projects: [seeded.projectKey], days: 7, rows: 50 },
				},
			);
			const result = await injectAs(
				app,
				session,
				"GET",
				`/api/gadgets/${gadget.json().id}/data`,
			);
			expect(result.statusCode).toBe(200);
			const days = result.json().activity as {
				entries: { kind: string }[];
			}[];
			return days
				.flatMap((day) => day.entries)
				.filter((entry) => entry.kind === "comment").length;
		}

		// The agent wrote one public and two internal comments, and edited one.
		expect(await stream(agent.session)).toBe(3);
		expect(await stream(customer.session)).toBe(1);
	});
});
