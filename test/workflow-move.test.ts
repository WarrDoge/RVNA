import { randomUUID } from "node:crypto";
import { eq, inArray, type SQL } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	issues,
	issueTypes,
	projects,
	resolutions,
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

test("a transition reads the issue row once before updating it", async () => {
	const [issue] = await db
		.insert(issues)
		.values({
			sourceId: `move-read-${run}`,
			projectId,
			number: 60,
			key: `${key}-60`,
			typeId,
			statusId: fromStatusId,
			summary: "Read once",
		})
		.returning();
	let selects = 0;
	try {
		const items = await db.transaction(async (tx) => {
			const counted = new Proxy(tx, {
				get(target, property) {
					if (property === "select") {
						return (...args: Parameters<typeof tx.select>) => {
							selects += 1;
							return target.select(...args);
						};
					}
					const value = Reflect.get(target, property);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
			return applyTransition(
				counted,
				{
					id: issue.id,
					statusId: fromStatusId,
					statusName: "Open",
					statusCategory: "new",
					resolutionId: null,
					resolutionName: null,
					resolved: null,
				},
				{
					id: randomUUID(),
					name: "Finish",
					to: { id: toStatusId, name: "Done", category: "done" },
				},
				authorId,
			);
		});
		expect(items).not.toBeNull();
		expect(selects).toBeLessThanOrEqual(3);

		const [after] = await db
			.select()
			.from(issues)
			.where(eq(issues.id, issue.id));
		expect(after.statusId).toBe(toStatusId);
		expect(after.resolutionId).not.toBeNull();
	} finally {
		await db.delete(issues).where(eq(issues.id, issue.id));
	}
});

test("concurrent transitions share one default resolution", async () => {
	const before = new Set(
		(await db.select({ id: resolutions.id }).from(resolutions)).map(
			(row) => row.id,
		),
	);
	const doneRows = await db
		.select({ id: resolutions.id, name: resolutions.name })
		.from(resolutions)
		.where(eq(resolutions.name, "Done"));
	const renamed = `Done ${randomUUID().slice(0, 8)}`;
	const ids: string[] = [];
	const client = pg.Client.prototype as {
		query: (...args: unknown[]) => unknown;
	};
	const original = client.query;
	try {
		for (const row of doneRows) {
			await db
				.update(resolutions)
				.set({ name: renamed })
				.where(eq(resolutions.id, row.id));
		}
		const rows = await db
			.insert(issues)
			.values([
				{
					sourceId: `move-done-a-${run}`,
					projectId,
					number: 70,
					key: `${key}-70`,
					typeId,
					statusId: fromStatusId,
					summary: "Done race A",
				},
				{
					sourceId: `move-done-b-${run}`,
					projectId,
					number: 71,
					key: `${key}-71`,
					typeId,
					statusId: fromStatusId,
					summary: "Done race B",
				},
			])
			.returning({ id: issues.id });
		ids.push(...rows.map((row) => row.id));

		let arrivals = 0;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		client.query = async function (
			this: unknown,
			query: { text?: string } | string,
			...rest: unknown[]
		) {
			const text = typeof query === "string" ? query : (query.text ?? "");
			if (
				text.includes('from "resolutions"') &&
				text.includes('"resolutions"."name"')
			) {
				arrivals += 1;
				if (arrivals >= 2) release();
				await gate;
			}
			return original.apply(this, [query, ...rest]);
		} as unknown as typeof client.query;

		const transition = {
			id: randomUUID(),
			name: "Finish",
			to: { id: toStatusId, name: "Done", category: "done" as const },
		};
		const results = await Promise.all(
			ids.map((id) =>
				db.transaction((tx) =>
					applyTransition(
						tx,
						{
							id,
							statusId: fromStatusId,
							statusName: "Open",
							statusCategory: "new",
							resolutionId: null,
							resolutionName: null,
							resolved: null,
						},
						transition,
						authorId,
					),
				),
			),
		);
		expect(results.every((items) => items !== null)).toBe(true);

		const after = await db
			.select({ resolutionId: issues.resolutionId })
			.from(issues)
			.where(inArray(issues.id, ids));
		expect(after[0]?.resolutionId).not.toBeNull();
		expect(after[1]?.resolutionId).toBe(after[0]?.resolutionId);
	} finally {
		client.query = original;
		if (ids.length > 0) {
			await db.delete(issues).where(inArray(issues.id, ids));
		}
		const added = (await db.select({ id: resolutions.id }).from(resolutions))
			.map((row) => row.id)
			.filter((id) => !before.has(id));
		if (added.length > 0) {
			await db.delete(resolutions).where(inArray(resolutions.id, added));
		}
		for (const row of doneRows) {
			await db
				.update(resolutions)
				.set({ name: row.name })
				.where(eq(resolutions.id, row.id));
		}
	}
});
