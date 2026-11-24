import { describe, expect, test, vi } from "vitest";
import { MAX_PAGES } from "../src/importer/client.ts";
import { JiraClient } from "../src/importer/jira.ts";
import { fetchJiraLive } from "../src/importer/parity/live-jira.ts";

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function client(fetchImpl: typeof fetch) {
	return new JiraClient({
		baseUrl: "https://jira.example.test",
		token: "token",
		fetchImpl,
		concurrency: 8,
	});
}

function standardJiraResponse(
	url: URL,
	projects: { id: string; key: string }[] = [{ id: "1", key: "P" }],
) {
	const path = url.pathname;
	if (path === "/rest/api/2/project") return json(projects);
	if (path === "/rest/api/2/issuetype") return json([]);
	if (path === "/rest/api/2/status") return json([]);
	if (path === "/rest/api/2/priority") return json([]);
	if (path === "/rest/api/2/resolution") return json([]);
	if (path === "/rest/api/2/issueLinkType") return json({ issueLinkTypes: [] });
	if (path === "/rest/api/2/user/search") return json([]);
	if (path === "/rest/api/2/workflow") return json([]);
	if (path === "/rest/api/2/project/P/statuses") {
		return json([{ id: "type-1", statuses: [] }]);
	}
	if (
		path === "/rest/api/2/project/P/versions" ||
		path === "/rest/api/2/project/P/components"
	) {
		return json([]);
	}
	return undefined;
}

function searchResponse(url: URL) {
	const maxResults = url.searchParams.get("maxResults");
	return json(maxResults === "0" ? { total: 0 } : { issues: [], total: 0 });
}

describe("parity live Jira", () => {
	test("a rejected sprint issue request keeps every sprint of the board", async () => {
		const sprintIssueRequests: string[] = [];
		const fetchImpl = (async (input: string | URL | Request) => {
			const url = new URL(String(input));
			const standard = standardJiraResponse(url);
			if (standard) return standard;
			const path = url.pathname;
			if (path === "/rest/api/2/project/P/statuses") {
				return json([{ id: "type-1", statuses: [] }]);
			}
			if (
				path === "/rest/api/2/project/P/versions" ||
				path === "/rest/api/2/project/P/components"
			) {
				return json([]);
			}
			if (path === "/rest/api/2/search") return searchResponse(url);
			if (path === "/rest/agile/1.0/board") {
				return json({ values: [{ id: 10 }], isLast: true });
			}
			if (path === "/rest/agile/1.0/board/10/sprint") {
				return json({
					values: [
						{ id: 1, state: "active" },
						{ id: 2, state: "closed" },
					],
					isLast: true,
				});
			}
			if (
				path.startsWith("/rest/agile/1.0/sprint/") &&
				path.endsWith("/issue")
			) {
				sprintIssueRequests.push(url.searchParams.get("maxResults") ?? "");
				return json({}, 400);
			}
			return json({}, 404);
		}) as typeof fetch;

		const live = await fetchJiraLive(client(fetchImpl), {
			privateApis: true,
			serviceDesks: false,
			agile: true,
			filters: false,
		});

		expect(live.agile).toEqual({
			boards: [
				{
					id: "10",
					sprints: [
						{ id: "1", state: "active", issueCount: 0 },
						{ id: "2", state: "closed", issueCount: 0 },
					],
				},
			],
		});
		expect(sprintIssueRequests).toEqual(["1", "1"]);
	});

	test("a board without a sprint endpoint keeps an empty sprint list", async () => {
		const fetchImpl = (async (input: string | URL | Request) => {
			const url = new URL(String(input));
			const standard = standardJiraResponse(url);
			if (standard) return standard;
			const path = url.pathname;
			if (path === "/rest/api/2/project/P/statuses") {
				return json([{ id: "type-1", statuses: [] }]);
			}
			if (
				path === "/rest/api/2/project/P/versions" ||
				path === "/rest/api/2/project/P/components"
			) {
				return json([]);
			}
			if (path === "/rest/api/2/search") return searchResponse(url);
			if (path === "/rest/agile/1.0/board") {
				return json({ values: [{ id: 10 }], isLast: true });
			}
			if (path === "/rest/agile/1.0/board/10/sprint") return json({}, 400);
			return json({}, 404);
		}) as typeof fetch;

		const live = await fetchJiraLive(client(fetchImpl), {
			privateApis: true,
			serviceDesks: false,
			agile: true,
			filters: false,
		});

		expect(live.agile).toEqual({
			boards: [{ id: "10", sprints: [] }],
		});
	});

	test("a paginated list that ignores the cursor stops after the first page", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		let listRequests = 0;
		const fetchImpl = (async (input: string | URL | Request) => {
			const url = new URL(String(input));
			const standard = standardJiraResponse(url);
			if (standard) return standard;
			const path = url.pathname;
			if (path === "/rest/api/2/search") return searchResponse(url);
			if (path === "/rest/servicedeskapi/servicedesk") {
				listRequests++;
				if (listRequests > 4) return json({}, 400);
				return json({
					values: [{ id: "1", projectKey: "P" }],
					start: 0,
					isLastPage: false,
				});
			}
			if (
				path === "/rest/servicedeskapi/servicedesk/1/requesttype" ||
				path === "/rest/servicedeskapi/servicedesk/1/queue"
			) {
				return json({ values: [], isLastPage: true });
			}
			if (path.includes("/sla/metrics")) return json({ timeMetrics: [] });
			return json({}, 404);
		}) as typeof fetch;

		try {
			const live = await fetchJiraLive(client(fetchImpl), {
				privateApis: true,
				serviceDesks: true,
				agile: false,
				filters: false,
			});

			expect(live.serviceDesks).toEqual([
				{
					sourceId: "1",
					projectKey: "P",
					requestTypes: [],
					queues: [],
					metrics: [],
				},
			]);
			expect(listRequests).toBe(2);
			expect(live.incomplete).toBe(true);
			expect(warn).toHaveBeenCalledWith(expect.stringContaining("pagination"));
		} finally {
			warn.mockRestore();
		}
	});

	test("lists that repeat the same page for ever end with an incomplete snapshot", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const requests = { users: 0, issues: 0, boards: 0, sprints: 0 };
		const fetchImpl = (async (input: string | URL | Request) => {
			const url = new URL(String(input));
			const path = url.pathname;
			if (path === "/rest/api/2/user/search") {
				requests.users++;
				return json(
					Array.from({ length: 100 }, (_, index) => ({
						key: `u${index}`,
						name: `user${index}`,
					})),
				);
			}
			const standard = standardJiraResponse(url);
			if (standard) return standard;
			if (path === "/rest/api/2/search") {
				if (url.searchParams.get("maxResults") === "0") {
					return json({ total: 0 });
				}
				requests.issues++;
				return json({
					issues: [{ key: "P-1", fields: {} }],
				});
			}
			if (path === "/rest/agile/1.0/board") {
				requests.boards++;
				return json({ values: [{ id: 10 }], isLast: false });
			}
			if (path === "/rest/agile/1.0/board/10/sprint") {
				requests.sprints++;
				return json({ values: [{ id: 1, state: "closed" }], isLast: false });
			}
			if (path === "/rest/agile/1.0/sprint/1/issue") return json({ total: 0 });
			return json({}, 404);
		}) as typeof fetch;

		try {
			const live = await fetchJiraLive(client(fetchImpl), {
				privateApis: true,
				serviceDesks: false,
				agile: true,
				filters: false,
			});

			expect(live.incomplete).toBe(true);
			expect(requests).toEqual({ users: 2, issues: 2, boards: 2, sprints: 2 });
		} finally {
			warn.mockRestore();
		}
	});

	test("a list with a fresh page every time stops at the page limit", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		let boardRequests = 0;
		const fetchImpl = (async (input: string | URL | Request) => {
			const url = new URL(String(input));
			const standard = standardJiraResponse(url);
			if (standard) return standard;
			const path = url.pathname;
			if (path === "/rest/api/2/search") return searchResponse(url);
			if (path === "/rest/agile/1.0/board") {
				boardRequests++;
				return json({
					values: [{ id: Number(url.searchParams.get("startAt")) + 1 }],
				});
			}
			return json({}, 404);
		}) as typeof fetch;

		try {
			const live = await fetchJiraLive(client(fetchImpl), {
				privateApis: true,
				serviceDesks: false,
				agile: false,
				boardsOnly: true,
				filters: false,
			});

			expect(live.incomplete).toBe(true);
			expect(boardRequests).toBe(MAX_PAGES + 1);
		} finally {
			warn.mockRestore();
		}
	}, 60_000);

	test("saved filters are fetched concurrently and a missing filter is tolerated", async () => {
		let active = 0;
		let maxActive = 0;
		const fetchImpl = (async (input: string | URL | Request) => {
			const url = new URL(String(input));
			const standard = standardJiraResponse(url);
			if (standard) return standard;
			const path = url.pathname;
			if (path === "/rest/api/2/search") return searchResponse(url);
			if (path.startsWith("/rest/api/2/filter/")) {
				const id = path.slice("/rest/api/2/filter/".length);
				if (id === "2") return json({}, 404);
				active++;
				maxActive = Math.max(maxActive, active);
				await sleep(20);
				active--;
				return json({ id, name: `Filter ${id}`, jql: `project = ${id}` });
			}
			return json({}, 404);
		}) as typeof fetch;

		const live = await fetchJiraLive(client(fetchImpl), {
			privateApis: true,
			serviceDesks: false,
			agile: false,
			filters: true,
			filterIds: ["1", "2", "3"],
		});

		expect(live.filters).toEqual([
			{ id: "1", name: "Filter 1", jql: "project = 1" },
			{ id: "3", name: "Filter 3", jql: "project = 3" },
		]);
		expect(maxActive).toBe(2);
	});

	test("projects are fetched concurrently", async () => {
		const activeProjects = new Map<string, number>();
		let maxActiveProjects = 0;
		const begin = (project: string) => {
			activeProjects.set(project, (activeProjects.get(project) ?? 0) + 1);
			maxActiveProjects = Math.max(maxActiveProjects, activeProjects.size);
		};
		const end = (project: string) => {
			const remaining = (activeProjects.get(project) ?? 1) - 1;
			if (remaining <= 0) activeProjects.delete(project);
			else activeProjects.set(project, remaining);
		};
		const projectResponse = async (project: string, body: unknown) => {
			begin(project);
			await sleep(30);
			end(project);
			return json(body);
		};
		const fetchImpl = (async (input: string | URL | Request) => {
			const url = new URL(String(input));
			const standard = standardJiraResponse(url, [
				{ id: "1", key: "A" },
				{ id: "2", key: "B" },
			]);
			if (standard) return standard;
			const path = url.pathname;
			const projectPath =
				/^\/rest\/api\/2\/project\/([^/]+)\/(statuses|versions|components)$/.exec(
					path,
				);
			if (projectPath) {
				const project = decodeURIComponent(projectPath[1] ?? "");
				if (projectPath[2] === "statuses") {
					return projectResponse(project, [{ id: "type-1", statuses: [] }]);
				}
				return projectResponse(project, []);
			}
			if (path === "/rest/api/2/search") {
				const jql = url.searchParams.get("jql") ?? "";
				const project = /project="([^"]+)"/.exec(jql)?.[1] ?? "A";
				return projectResponse(
					project,
					url.searchParams.get("maxResults") === "0"
						? { total: 0 }
						: { issues: [], total: 0 },
				);
			}
			return json({}, 404);
		}) as typeof fetch;

		const live = await fetchJiraLive(client(fetchImpl), {
			privateApis: true,
			serviceDesks: false,
			agile: false,
			filters: false,
		});

		expect(live.projects.map((project) => project.key)).toEqual(["A", "B"]);
		expect(maxActiveProjects).toBe(2);
	});

	test("the snapshot says which private parts were skipped", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const fetchImpl = (async (input: string | URL | Request) => {
			const url = new URL(String(input));
			const standard = standardJiraResponse(url);
			if (standard) return standard;
			const path = url.pathname;
			if (path === "/rest/api/2/search") return searchResponse(url);
			if (path === "/rest/servicedeskapi/servicedesk") {
				return json({ values: [], isLastPage: true });
			}
			return json({}, 404);
		}) as typeof fetch;

		try {
			const live = await fetchJiraLive(client(fetchImpl), {
				privateApis: false,
				serviceDesks: true,
				agile: false,
				filters: false,
			});

			expect(live.workflowResolutionSkipped).toBe(true);
			expect(live.workflowResolutionTransitions.size).toBe(0);
			expect(live.serviceDeskMetricsSkipped).toBe(true);
		} finally {
			warn.mockRestore();
		}
	});

	test("boards-only and full agile mode list the same boards", async () => {
		const fetchImpl = (async (input: string | URL | Request) => {
			const url = new URL(String(input));
			const standard = standardJiraResponse(url);
			if (standard) return standard;
			const path = url.pathname;
			if (path === "/rest/api/2/project/P/statuses") {
				return json([{ id: "type-1", statuses: [] }]);
			}
			if (
				path === "/rest/api/2/project/P/versions" ||
				path === "/rest/api/2/project/P/components"
			) {
				return json([]);
			}
			if (path === "/rest/api/2/search") return searchResponse(url);
			if (path === "/rest/agile/1.0/board") {
				return json({ values: [{ id: 10 }], isLast: true });
			}
			if (path === "/rest/agile/1.0/board/10/sprint") {
				return json({ values: [], isLast: true });
			}
			return json({}, 404);
		}) as typeof fetch;

		const boardsOnly = await fetchJiraLive(client(fetchImpl), {
			privateApis: true,
			serviceDesks: false,
			agile: false,
			boardsOnly: true,
			filters: false,
		});
		const full = await fetchJiraLive(client(fetchImpl), {
			privateApis: true,
			serviceDesks: false,
			agile: true,
			filters: false,
		});

		expect(boardsOnly.agile).toEqual({
			boards: [{ id: "10", sprints: [] }],
		});
		expect(full.agile?.boards.map((board) => board.id)).toEqual(["10"]);
	});
});
