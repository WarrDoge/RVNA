import { describe, expect, test } from "vitest";
import { fetchDataset } from "../src/importer/fetch.ts";
import type { JiraClient } from "../src/importer/jira.ts";

const issueCount = 130_000;

function issue(index: number) {
	return {
		id: String(index),
		key: `DEMO-${index + 1}`,
		fields: {
			summary: "Large project",
			comment: { total: 0 },
			worklog: { total: 0 },
			watches: { watchCount: 0 },
			attachment: [],
		},
		changelog: { total: 0, histories: [] },
	};
}

describe("a project larger than the engine's argument limit", () => {
	test("collects every issue without spreading the project into push", async () => {
		const issues = Array.from({ length: issueCount }, (_, index) =>
			issue(index),
		);
		const client = {
			async getJson(path: string, params?: Record<string, unknown>) {
				if (path === "/rest/api/2/user/search") return [];
				if (
					path === "/rest/api/2/issuetype" ||
					path === "/rest/api/2/priority" ||
					path === "/rest/api/2/resolution" ||
					path === "/rest/api/2/status" ||
					path === "/rest/api/2/field" ||
					path === "/rest/api/2/workflow"
				) {
					return [];
				}
				if (path === "/rest/api/2/issueLinkType") {
					return { issueLinkTypes: [] };
				}
				if (path === "/rest/api/2/project") {
					return [
						{
							id: "1",
							key: "DEMO",
							name: "Demo",
							projectTypeKey: "software",
						},
					];
				}
				if (path === "/rest/api/2/project/DEMO") {
					return {
						id: "1",
						key: "DEMO",
						name: "Demo",
						projectTypeKey: "software",
						issueTypes: [],
					};
				}
				if (
					path.endsWith("/components") ||
					path.endsWith("/versions") ||
					path.endsWith("/statuses")
				) {
					return [];
				}
				if (path === "/rest/api/2/search") {
					const start = Number(params?.startAt ?? 0);
					return {
						issues: issues.slice(start, start + 50),
						total: issueCount,
					};
				}
				throw new Error(`unexpected request ${path}`);
			},
		} as unknown as JiraClient;

		const dataset = await fetchDataset(client, {
			attachmentsDir: "/tmp",
			skipAttachments: true,
			privateApis: false,
		});

		expect(dataset.issues).toHaveLength(issueCount);
		expect(dataset.issues[0]?.issue.key).toBe("DEMO-1");
		expect(dataset.issues.at(-1)?.issue.key).toBe(`DEMO-${issueCount}`);
	}, 30_000);
});
