import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchWorkflows } from "../src/importer/fetch.ts";
import { JiraClient } from "../src/importer/jira.ts";
import type { JiraWorkflowLayout } from "../src/importer/types.ts";

function layout(
	transitions: JiraWorkflowLayout["layout"]["transitions"],
): JiraWorkflowLayout {
	return { layout: { statuses: [], transitions } };
}

function transition(
	id: string,
	overrides: Partial<JiraWorkflowLayout["layout"]["transitions"][number]> = {},
): JiraWorkflowLayout["layout"]["transitions"][number] {
	return {
		id,
		name: `Transition ${id}`,
		sourceId: "S<1>",
		targetId: "S<2>",
		...overrides,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("workflow transition screens", () => {
	test("reads each distinct screen once and marks the resolution field", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const calls: string[] = [];
		const fetchImpl = (async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			const url = new URL(String(input));
			calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
			const path = url.pathname;
			if (path === "/rest/api/2/workflow") {
				return Response.json([
					{ name: "Workflow One" },
					{ name: "Workflow Two" },
				]);
			}
			if (path === "/rest/workflowDesigner/1.0/workflows") {
				const name = url.searchParams.get("name");
				if (name === "Workflow One") {
					return Response.json(
						layout([
							transition("shared", { screenId: 101 }),
							transition("no-resolution", { screenId: 102 }),
							transition("no-screen"),
							transition("missing-screen", { screenId: 103 }),
							transition("forbidden-screen", { screenId: 104 }),
						]),
					);
				}
				return Response.json(
					layout([transition("shared-again", { screenId: 101 })]),
				);
			}
			if (path === "/rest/api/2/screens/101/tabs") {
				return Response.json([{ id: "tab-a" }]);
			}
			if (path === "/rest/api/2/screens/101/tabs/tab-a/fields") {
				return Response.json([{ id: "assignee" }, { id: "resolution" }]);
			}
			if (path === "/rest/api/2/screens/102/tabs") {
				return Response.json([{ id: "tab-b" }]);
			}
			if (path === "/rest/api/2/screens/102/tabs/tab-b/fields") {
				return Response.json([{ id: "issuelinks" }]);
			}
			if (path === "/rest/api/2/screens/103/tabs") {
				return new Response("missing", { status: 404 });
			}
			if (path === "/rest/api/2/screens/104/tabs") {
				return Response.json([{ id: "tab-d" }]);
			}
			if (path === "/rest/api/2/screens/104/tabs/tab-d/fields") {
				return new Response("forbidden", { status: 403 });
			}
			return new Response("missing", { status: 404 });
		}) as typeof fetch;

		const client = new JiraClient({
			baseUrl: "https://jira.example.test",
			token: "fixture-token",
			fetchImpl,
		});
		const workflows = await fetchWorkflows(client, { privateApis: true });
		const flags = new Map(
			workflows.flatMap((workflow) =>
				workflow.layout.transitions.map(
					(item) => [item.id, item.hasResolutionField] as const,
				),
			),
		);

		expect(flags).toEqual(
			new Map([
				["shared", true],
				["no-resolution", false],
				["no-screen", false],
				["missing-screen", false],
				["forbidden-screen", false],
				["shared-again", true],
			]),
		);
		expect(
			calls.filter((call) => call === "GET /rest/api/2/screens/101/tabs"),
		).toHaveLength(1);
		expect(
			calls.filter(
				(call) => call === "GET /rest/api/2/screens/101/tabs/tab-a/fields",
			),
		).toHaveLength(1);
		expect(calls.every((call) => call.startsWith("GET "))).toBe(true);
		expect(warn).toHaveBeenCalledTimes(2);
		expect(warn.mock.calls[0]?.[0]).toContain("screen 103");
		expect(warn.mock.calls[1]?.[0]).toContain("screen 104");
	});
});
