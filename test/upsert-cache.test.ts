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
