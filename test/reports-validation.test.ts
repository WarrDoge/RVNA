import { eq } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { cumulativeFlowReport } from "../src/lib/server/reports/service.ts";
import { boards } from "../src/lib/server/schema.ts";
import { makeUser } from "./admin-helpers.ts";
import {
	createProjectFixture,
	dropProjectFixture,
	fixtureKey,
	fixtureRun,
} from "./fixtures/project.ts";

const run = fixtureRun();
const key = fixtureKey(run);
let appClient: Client;
let projectId: string;
let boardId: string;
let rapidViewId: number;
let user: CurrentUser;

beforeAll(async () => {
	await runMigrations();
	appClient = new Client({ connectionString: process.env.DATABASE_URL });
	await appClient.connect();
	const seeded = await createProjectFixture(appClient, {
		run,
		key,
		issues: [],
	});
	projectId = seeded.projectId;
	const account = await makeUser(run, "reports", { admin: true });
	user = {
		id: account.id,
		username: account.username,
		displayName: "Reports Validation",
		email: null,
		avatarUrl: null,
		groups: [],
		isAdmin: true,
		mustChangePassword: false,
		hasPassword: true,
	};
	rapidViewId = 1_000_000 + Math.floor(Math.random() * 1_000_000_000);
	const [board] = await db
		.insert(boards)
		.values({
			rapidViewId,
			name: `Validation board ${run}`,
			type: "kanban",
			filterJql: `project = ${key}`,
			projectId,
			ownerId: account.id,
		})
		.returning({ id: boards.id });
	boardId = board.id;
});

afterAll(async () => {
	if (boardId) await db.delete(boards).where(eq(boards.id, boardId));
	if (appClient) {
		await dropProjectFixture(appClient, run);
		await appClient.end();
	}
	await pool.query("delete from users where username ilike $1", [`t-${run}-%`]);
	await pool.end();
});

test("an invalid date is rejected before the board data is loaded", async () => {
	const querySpy = vi.spyOn(Client.prototype, "query");
	let queries: string[] = [];
	try {
		await expect(
			cumulativeFlowReport(user, rapidViewId, { from: "not-a-date" }),
		).rejects.toMatchObject({ status: 400, message: "Invalid date range" });
		queries = querySpy.mock.calls.map((call) =>
			typeof call[0] === "string"
				? call[0]
				: ((call[0] as { text?: string }).text ?? ""),
		);
	} finally {
		querySpy.mockRestore();
	}
	expect(queries.some((text) => text.includes('from "issues"'))).toBe(false);
});
