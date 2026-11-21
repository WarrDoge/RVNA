import { randomUUID } from "node:crypto";
import { eq, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	issues,
	issueTypes,
	projects,
	statuses,
	users,
} from "../src/lib/server/schema.ts";
import { moveIssues } from "../src/lib/server/workflows.ts";

const run = randomUUID().slice(0, 8);
const key = `MV${run.slice(0, 4).toUpperCase()}`;

let authorId: string;
let projectId: string;
let typeId: string;
let fromStatusId: string;
let toStatusId: string;
let issueId: string;

beforeAll(async () => {
	await runMigrations();
	const [author] = await db
		.insert(users)
		.values({ username: `t-${run}-author`, displayName: "Move Author" })
		.returning();
	authorId = author.id;
	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `move-project-${run}`,
			key,
			name: `Move project ${run}`,
			projectType: "software",
		})
		.returning();
	projectId = project.id;
	const [type] = await db
		.insert(issueTypes)
		.values({ sourceId: `move-type-${run}`, name: `Move type ${run}` })
		.returning();
	typeId = type.id;
	const statusRows = await db
		.insert(statuses)
		.values([
			{ sourceId: `move-from-${run}`, name: "Open", category: "new" },
			{ sourceId: `move-to-${run}`, name: "Done", category: "done" },
		])
		.returning();
	fromStatusId = statusRows[0].id;
	toStatusId = statusRows[1].id;
	const [issue] = await db
		.insert(issues)
		.values({
			sourceId: `move-issue-${run}`,
			projectId,
			number: 1,
			key: `${key}-1`,
			typeId,
			statusId: fromStatusId,
			summary: `Move issue ${run}`,
		})
		.returning();
	issueId = issue.id;
});

afterAll(async () => {
	await db.delete(issues).where(eq(issues.id, issueId));
	await db.delete(projects).where(eq(projects.id, projectId));
	await db.delete(issueTypes).where(eq(issueTypes.id, typeId));
	await db.delete(statuses).where(eq(statuses.id, fromStatusId));
	await db.delete(statuses).where(eq(statuses.id, toStatusId));
	await db.delete(users).where(eq(users.id, authorId));
	await pool.end();
});

test("a move without a condition is refused instead of moving every issue", async () => {
	let message = "";
	try {
		await db.transaction(async (tx) => {
			await moveIssues(tx, authorId, undefined as unknown as SQL, {
				id: toStatusId,
				name: "Done",
				category: "done",
			});
			throw new Error("MASS_MUTATION");
		});
	} catch (error) {
		message = error instanceof Error ? error.message : String(error);
	}
	expect(message).toBe("moveIssues needs a condition");
	const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
	expect(row.statusId).toBe(fromStatusId);
});
