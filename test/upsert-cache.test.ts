import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
							chunk.map((_row, index) => ({ id: `inserted-${index}` })),
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

function trackingExecutor(
	rows: Record<string, unknown>[],
	returned?: (chunk: Record<string, unknown>[]) => Record<string, unknown>[],
) {
	const updates: Record<string, unknown>[] = [];
	const inserted: Record<string, unknown>[][] = [];
	const tx = {
		select() {
			return { from: async () => rows };
		},
		update() {
			return {
				set(values: Record<string, unknown>) {
					updates.push(values);
					return {
						where: () => ({
							returning: async () => [{ id: "row-1" }],
						}),
					};
				},
			};
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
	};
	return {
		tx: tx as unknown as Executor,
		updates,
		inserted,
	};
}

describe("upsert local change markers", () => {
	test("keeps a row whose marker column has another name", async () => {
		const { tx, updates } = trackingExecutor([
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
		expect(updates).toHaveLength(0);
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
});
