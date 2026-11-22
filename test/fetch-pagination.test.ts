import { describe, expect, test } from "vitest";
import { fetchDataset } from "../src/importer/fetch.ts";
import type { JiraClient } from "../src/importer/jira.ts";

function issue(key: string) {
	return {
		id: key,
		key,
		fields: {
			comment: { total: 0 },
			worklog: { total: 0 },
			watches: { watchCount: 0 },
			attachment: [],
		},
		changelog: { total: 0, histories: [] },
	};
}

function paged(path: string, start: number) {
	if (path === "/rest/api/2/search") {
		const all = Array.from({ length: 51 }, (_, index) =>
			issue(`DEMO-${index + 1}`),
		);
		return { issues: all.slice(start, start + 50) };
	}
	if (path.endsWith("/comment")) {
		return {
			comments:
				start === 0
					? Array.from({ length: 100 }, (_, index) => ({ id: `c${index}` }))
					: start === 100
						? [{ id: "c100" }]
						: [],
		};
	}
	if (path.endsWith("/worklog")) {
		return {
			worklogs:
				start === 0
					? Array.from({ length: 100 }, (_, index) => ({ id: `w${index}` }))
					: start === 100
						? [{ id: "w100" }]
						: [],
		};
	}
	if (path.endsWith("/changelog")) {
		return {
			histories:
				start === 0
					? Array.from({ length: 100 }, (_, index) => ({ id: `h${index}` }))
					: start === 100
						? [{ id: "h100" }]
						: [],
		};
	}
	return undefined;
}

describe("Jira pagination without a total", () => {
	test("reads every page of issues, comments, worklogs and history", async () => {
		const client = {
			async getJson(
				path: string,
				params?: Record<string, string | number | boolean | undefined>,
			) {
				const start = Number(params?.startAt ?? 0);
				const pagedResponse = paged(path, start);
				if (pagedResponse) {
					if (path === "/rest/api/2/search" && start === 0) {
						const issues = pagedResponse.issues as ReturnType<typeof issue>[];
						if (issues[0]) {
							issues[0].fields.comment = { total: 1 };
							issues[0].fields.worklog = { total: 1 };
							issues[0].changelog = { total: 101, histories: [] };
						}
					}
					return pagedResponse;
				}
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
				if (path === "/rest/api/2/issueLinkType") return { issueLinkTypes: [] };
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
				if (path.endsWith("/components") || path.endsWith("/versions")) {
					return [];
				}
				if (path.endsWith("/statuses")) return [];
				throw new Error(`unexpected ${path}`);
			},
		} as unknown as JiraClient;

		const dataset = await fetchDataset(client, {
			attachmentsDir: "/tmp",
			skipAttachments: true,
			privateApis: true,
		});

		expect(dataset.issues).toHaveLength(51);
		const first = dataset.issues.find((data) => data.issue.key === "DEMO-1");
		expect(first?.comments).toHaveLength(101);
		expect(first?.worklogs).toHaveLength(101);
		expect(first?.histories).toHaveLength(101);
	});
});
