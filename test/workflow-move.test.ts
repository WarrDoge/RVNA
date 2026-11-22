import { randomUUID } from "node:crypto";
import { eq, inArray, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	issues,
	issueTypes,
	projects,
	statuses,
	users,
} from "../src/lib/server/schema.ts";
import { applyTransition } from "../src/lib/server/transitions.ts";
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

test("an unknown resolution is refused on a non-done transition that asks for one", async () => {
	const [target] = await db
		.insert(statuses)
		.values({
			sourceId: `move-progress-${run}`,
			name: "In Progress",
			category: "indeterminate",
		})
		.returning();
	try {
		const [row] = await db.select().from(issues).where(eq(issues.id, issueId));
		const result = await db.transaction((tx) =>
			applyTransition(
				tx,
				{
					id: row.id,
					statusId: row.statusId,
					statusName: "Open",
					statusCategory: "new",
					resolutionId: null,
					resolutionName: null,
					resolved: null,
				},
				{
					id: randomUUID(),
					name: "Start progress",
					asksResolution: true,
					to: {
						id: target.id,
						name: "In Progress",
						category: "indeterminate",
					},
				},
				authorId,
				randomUUID(),
			),
		);
		expect(result).toBeNull();
		const [after] = await db
			.select()
			.from(issues)
			.where(eq(issues.id, issueId));
		expect(after.statusId).toBe(fromStatusId);
		expect(after.resolutionId).toBeNull();
	} finally {
		await db.delete(statuses).where(eq(statuses.id, target.id));
	}
});

test("moving many issues uses one update and two history inserts", async () => {
	const rows = await db
		.insert(issues)
		.values(
			Array.from({ length: 12 }, (_, index) => ({
				sourceId: `move-bulk-${run}-${index}`,
				projectId,
				number: index + 2,
				key: `${key}-${index + 2}`,
				typeId,
				statusId: fromStatusId,
				summary: `Bulk move ${index}`,
			})),
		)
		.returning({ id: issues.id });
	const ids = rows.map((row) => row.id);
	const counts = { update: 0, insert: 0 };
	try {
		await db.transaction(async (tx) => {
			const counted = new Proxy(tx, {
				get(target, property) {
					if (property === "update") {
						return (...args: Parameters<typeof tx.update>) => {
							counts.update += 1;
							return target.update(...args);
						};
					}
					if (property === "insert") {
						return (...args: Parameters<typeof tx.insert>) => {
							counts.insert += 1;
							return target.insert(...args);
						};
					}
					const value = Reflect.get(target, property);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
			await moveIssues(counted, authorId, inArray(issues.id, ids), {
				id: toStatusId,
				name: "Done",
				category: "done",
			});
		});
		expect(counts.update).toBeLessThanOrEqual(4);
		expect(counts.insert).toBeLessThanOrEqual(2);

		const moved = await db
			.select({ statusId: issues.statusId })
			.from(issues)
			.where(inArray(issues.id, ids));
		expect(moved.every((row) => row.statusId === toStatusId)).toBe(true);
	} finally {
		await db.delete(issues).where(inArray(issues.id, ids));
	}
});
