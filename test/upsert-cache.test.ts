import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vitest";
import { type Executor, upsertRows } from "../src/importer/upsert.ts";
import { issueLabels } from "../src/lib/server/schema.ts";

function fakeExecutor(rows: Record<string, unknown>[]) {
	let selects = 0;
	const tx = {
		select() {
			return {
				from: async () => {
					selects++;
					return rows;
				},
			};
		},
		update() {
			return {
				set() {
					return { where: async () => undefined };
				},
			};
		},
		insert() {
			return {
				values(chunk: Record<string, unknown>[]) {
					return {
						returning: async () =>
							chunk.map((row, index) => ({ ...row, id: `inserted-${index}` })),
					};
				},
			};
		},
		delete() {
			return { where: async () => undefined };
		},
	};
	return {
		tx: tx as unknown as Executor,
		selects: () => selects,
	};
}

describe("upsert row loading", () => {
	test("loads a table once per transaction instead of once per call", async () => {
		const { tx, selects } = fakeExecutor([]);
		const options = { preserveNullKeys: [] };

		await upsertRows(
			tx,
			issueLabels,
			[{ sourceId: "jira:1:label:a", issueId: "issue-1", label: "a" }],
			(row) => `${row.issueId}:${row.label}`,
			options,
		);
		await upsertRows(
			tx,
			issueLabels,
			[{ sourceId: "jira:1:label:b", issueId: "issue-1", label: "b" }],
			(row) => `${row.issueId}:${row.label}`,
			options,
		);

		expect(selects()).toBe(1);
	});
});

const markerTable = pgTable("upsert_fixture", {
	id: uuid("id").primaryKey(),
	sourceId: text("source_id").notNull(),
	name: text("name"),
	marker: timestamp("marker", { withTimezone: true }),
});

const customTable = pgTable("upsert_custom_fixture", {
	id: uuid("id").primaryKey(),
	sourceId: text("source_id").notNull(),
	custom: jsonb("custom").notNull().default({}),
});

function trackingExecutor(
	rows: Record<string, unknown>[],
	returned?: (chunk: Record<string, unknown>[]) => Record<string, unknown>[],
	updateReturned: Record<string, unknown>[] = [{ id: "row-1" }],
) {
	const queries: unknown[] = [];
	const inserted: Record<string, unknown>[][] = [];
	const tx = {
		select() {
			return { from: async () => rows };
		},
		insert() {
			return {
				values(chunk: Record<string, unknown>[]) {
					inserted.push(chunk);
					return {
						returning: async () =>
							returned
								? returned(chunk)
								: chunk.map((row, index) => ({
										...row,
										id: `inserted-${index}`,
									})),
					};
				},
			};
		},
		delete() {
			return { where: async () => undefined };
		},
		execute: async (query: unknown) => {
			queries.push(query);
			return { rows: updateReturned };
		},
	};
	return {
		tx: tx as unknown as Executor,
		queries,
		inserted,
	};
}

describe("upsert local change markers", () => {
	test("keeps a row whose marker column has another name", async () => {
		const { tx, queries } = trackingExecutor([
			{
				id: "row-1",
				sourceId: "a",
				name: "remote",
				marker: new Date("2026-01-01T00:00:00Z"),
			},
		]);

		const result = await upsertRows(
			tx,
			markerTable,
			[{ sourceId: "a", name: "changed" }],
			(row) => String(row.sourceId),
			{ localChangeColumn: markerTable.marker },
		);

		expect(result.keptLocalIds).toEqual(["row-1"]);
		expect(result.counts).toEqual({ inserted: 0, updated: 0, unchanged: 0 });
		expect(queries).toHaveLength(0);
	});

	test("clears the configured marker in the cache after overwriting", async () => {
		const { tx } = trackingExecutor([
			{
				id: "row-1",
				sourceId: "a",
				name: "remote",
				marker: new Date("2026-01-01T00:00:00Z"),
			},
		]);
		const row = { sourceId: "a", name: "changed" };

		await upsertRows(
			tx,
			markerTable,
			[row],
			(value) => String(value.sourceId),
			{
				localChangeColumn: markerTable.marker,
				overwriteLocal: true,
			},
		);
		const second = await upsertRows(
			tx,
			markerTable,
			[row],
			(value) => String(value.sourceId),
			{ localChangeColumn: markerTable.marker },
		);

		expect(second.keptLocalIds).toEqual([]);
		expect(second.counts).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
	});

	test("updates a marked row even when its remote values did not change", async () => {
		const { tx, queries } = trackingExecutor([
			{
				id: "row-1",
				sourceId: "a",
				name: "same",
				marker: new Date("2026-01-01T00:00:00Z"),
			},
		]);

		const result = await upsertRows(
			tx,
			markerTable,
			[{ sourceId: "a", name: "same" }],
			(row) => String(row.sourceId),
			{ localChangeColumn: markerTable.marker, overwriteLocal: true },
		);

		expect(result.counts).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
		expect(queries).toHaveLength(1);
	});
});

describe("upsert insert results", () => {
	test("fails clearly when the insert returns fewer rows than values", async () => {
		const { tx } = trackingExecutor([], (chunk) =>
			chunk.slice(0, 1).map((row, index) => ({ ...row, id: `row-${index}` })),
		);

		await expect(
			upsertRows(
				tx,
				markerTable,
				[
					{ sourceId: "a", name: "A" },
					{ sourceId: "b", name: "B" },
				],
				(row) => String(row.sourceId),
			),
		).rejects.toThrow(/inserting 2 rows returned 1 rows/);
	});

	test("maps inserted rows back by their key, not their position", async () => {
		const { tx } = trackingExecutor([], (chunk) =>
			chunk.map((row, index) => ({ ...row, id: `row-${index}` })).reverse(),
		);

		const result = await upsertRows(
			tx,
			markerTable,
			[
				{ sourceId: "a", name: "A" },
				{ sourceId: "b", name: "B" },
			],
			(row) => String(row.sourceId),
		);

		expect(result.ids.get("a")).toBe("row-0");
		expect(result.ids.get("b")).toBe("row-1");
	});
});

describe("upsert custom values", () => {
	test("writes a change limited to elapsed and remaining time", async () => {
		const { tx, queries } = trackingExecutor([
			{
				id: "row-1",
				sourceId: "a",
				custom: {
					elapsedTime: { millis: 1 },
					remainingTime: { millis: 2 },
				},
			},
		]);

		const result = await upsertRows(
			tx,
			customTable,
			[
				{
					sourceId: "a",
					custom: {
						elapsedTime: { millis: 3 },
						remainingTime: { millis: 4 },
					},
				},
			],
			(row) => String(row.sourceId),
		);

		expect(result.counts).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
		expect(queries).toHaveLength(1);
	});
});

describe("upsert duplicate keys", () => {
	test("inserts a duplicated key once, keeping the last row", async () => {
		const { tx, inserted } = trackingExecutor([]);

		const result = await upsertRows(
			tx,
			markerTable,
			[
				{ sourceId: "a", name: "first" },
				{ sourceId: "a", name: "last" },
			],
			(row) => String(row.sourceId),
		);

		expect(inserted).toHaveLength(1);
		expect(inserted[0]).toHaveLength(1);
		expect(inserted[0]?.[0]?.name).toBe("last");
		expect(result.counts).toEqual({ inserted: 1, updated: 0, unchanged: 0 });
	});
});

describe("upsert update results", () => {
	test("does not count a row that the update did not return", async () => {
		const { tx, queries } = trackingExecutor(
			[{ id: "row-1", sourceId: "a", name: "remote" }],
			undefined,
			[],
		);
		const rows = [{ sourceId: "a", name: "changed" }];

		const first = await upsertRows(tx, markerTable, rows, (row) =>
			String(row.sourceId),
		);
		expect(first.counts).toEqual({ inserted: 0, updated: 0, unchanged: 0 });
		expect(first.ids.has("a")).toBe(false);
		expect(queries).toHaveLength(1);

		const second = await upsertRows(tx, markerTable, rows, (row) =>
			String(row.sourceId),
		);
		expect(second.counts).toEqual({ inserted: 1, updated: 0, unchanged: 0 });
	});
});

describe("upsert update batching", () => {
	test("updates several changed rows in one statement", async () => {
		const { tx, queries } = trackingExecutor(
			[
				{ id: "row-1", sourceId: "a", name: "a" },
				{ id: "row-2", sourceId: "b", name: "b" },
			],
			undefined,
			[{ id: "row-1" }, { id: "row-2" }],
		);

		const result = await upsertRows(
			tx,
			markerTable,
			[
				{ sourceId: "a", name: "A" },
				{ sourceId: "b", name: "B" },
			],
			(row) => String(row.sourceId),
		);

		expect(result.counts).toEqual({ inserted: 0, updated: 2, unchanged: 0 });
		expect(queries).toHaveLength(1);
	});
});
