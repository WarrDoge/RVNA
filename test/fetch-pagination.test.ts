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

function fakeClient(
	respond: (path: string, start: number) => unknown | undefined,
) {
	return {
		async getJson(
			path: string,
			params?: Record<string, string | number | boolean | undefined>,
		) {
			const response = respond(path, Number(params?.startAt ?? 0));
			if (response) return response;
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
}

const fetchOptions = {
	attachmentsDir: "/tmp",
	skipAttachments: true,
	privateApis: true,
};

describe("Jira pagination without a total", () => {
	test("reads every page of issues, comments, worklogs and history", async () => {
		const client = fakeClient((path, start) => {
			const response = paged(path, start);
			if (response && path === "/rest/api/2/search" && start === 0) {
				const issues = response.issues as ReturnType<typeof issue>[];
				if (issues[0]) {
					issues[0].fields.comment = { total: 1 };
					issues[0].fields.worklog = { total: 1 };
					issues[0].changelog = { total: 101, histories: [] };
				}
			}
			return response;
		});

		const dataset = await fetchDataset(client, fetchOptions);

		expect(dataset.issues).toHaveLength(51);
		const first = dataset.issues.find((data) => data.issue.key === "DEMO-1");
		expect(first?.comments).toHaveLength(101);
		expect(first?.worklogs).toHaveLength(101);
		expect(first?.histories).toHaveLength(101);
	});
});

describe("Jira pagination that never ends", () => {
	test.each([
		["users", "/rest/api/2/user/search"],
		["issues", "/rest/api/2/search"],
	])("a page of %s that repeats stops the fetch", async (_name, listPath) => {
		let requests = 0;
		const client = fakeClient((path) => {
			if (path !== listPath) return undefined;
			requests++;
			if (path === "/rest/api/2/user/search") {
				return Array.from({ length: 100 }, (_, index) => ({
					key: `u${index}`,
					name: `user${index}`,
				}));
			}
			return {
				issues: Array.from({ length: 50 }, (_, index) =>
					issue(`DEMO-${index + 1}`),
				),
				total: 1_000_000,
			};
		});

		await expect(fetchDataset(client, fetchOptions)).rejects.toThrow(
			/paging did not finish \(a page brought no new rows\)/,
		);
		expect(requests).toBe(2);
	});

	test.each([["comment"], ["worklog"], ["changelog"]])(
		"a repeating page of %s rows stops the fetch",
		async (suffix) => {
			let requests = 0;
			const client = fakeClient((path, start) => {
				if (path === "/rest/api/2/search") {
					const demo = issue("DEMO-1");
					demo.fields.comment = { total: 1 };
					demo.fields.worklog = { total: 1 };
					demo.changelog = { total: 101, histories: [] };
					return start === 0 ? { issues: [demo] } : { issues: [] };
				}
				const kind = path.split("/").pop();
				if (kind !== "comment" && kind !== "worklog" && kind !== "changelog") {
					return undefined;
				}
				const key = {
					comment: "comments",
					worklog: "worklogs",
					changelog: "histories",
				}[kind];
				if (kind !== suffix) return { [key]: [], total: 0 };
				requests++;
				return {
					[key]: Array.from({ length: 100 }, (_, index) => ({
						id: `r${index}`,
					})),
					total: 1_000_000,
				};
			});

			await expect(fetchDataset(client, fetchOptions)).rejects.toThrow(
				/DEMO-1: paging did not finish/,
			);
			expect(requests).toBe(2);
		},
	);
});
