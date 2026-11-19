import { describe, expect, test } from "vitest";
import type { JiraClient } from "../src/importer/jira.ts";
import { fetchRequestSla } from "../src/importer/servicedesk.ts";
import type { JiraRequestSla } from "../src/importer/types.ts";

describe("request SLA pagination", () => {
	test("reads every page of SLA metrics", async () => {
		const pages: JiraRequestSla[] = [
			{
				values: [{ id: "1", name: "First" }],
				start: 0,
				limit: 1,
				isLastPage: false,
			},
			{
				values: [{ id: "2", name: "Second" }],
				start: 1,
				limit: 1,
				isLastPage: true,
			},
		];
		const calls: Record<string, string | number | boolean | undefined>[] = [];
		const client = {
			getJson: async (
				_path: string,
				params: Record<string, string | number | boolean | undefined>,
			) => {
				calls.push(params);
				return pages.shift();
			},
		} as unknown as JiraClient;

		const result = await fetchRequestSla(client, "ABC-1");

		expect(result.values?.map((value) => value.id)).toEqual(["1", "2"]);
		expect(calls).toEqual([
			{ start: 0, limit: 100 },
			{ start: 1, limit: 100 },
		]);
	});
});
