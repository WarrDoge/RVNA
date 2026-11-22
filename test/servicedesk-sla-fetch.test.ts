import { describe, expect, test } from "vitest";
import type { JiraClient } from "../src/importer/jira.ts";
import {
	fetchRequestSla,
	fetchServiceDesks,
} from "../src/importer/servicedesk.ts";
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

	test("stops when the reported total is reached", async () => {
		let calls = 0;
		const client = {
			getJson: async () => {
				calls++;
				if (calls > 3) throw new Error("paging did not stop");
				return {
					values: [{ id: "1", name: "First" }],
					size: 1,
					start: 0,
					limit: 1,
					isLastPage: false,
				};
			},
		} as unknown as JiraClient;

		const result = await fetchRequestSla(client, "ABC-1");

		expect(result.values?.map((value) => value.id)).toEqual(["1"]);
		expect(calls).toBe(1);
	});
});

test("a relative portal link is resolved instead of aborting the desk fetch", async () => {
	const client = {
		getJson: async (path: string) => {
			if (path === "/rest/servicedeskapi/servicedesk") {
				return {
					values: [
						{
							id: "1",
							projectId: "10",
							projectName: "Demo",
							projectKey: "DEMO",
							_links: { portal: "/servicedesk/customer/portal/12" },
						},
					],
					isLastPage: true,
				};
			}
			if (
				path.endsWith("/requesttypegroup") ||
				path.endsWith("/requesttype") ||
				path.endsWith("/queue")
			) {
				return { values: [], isLastPage: true };
			}
			if (path.includes("/sla/metrics")) return {};
			if (path.includes("/settings/requestsecurity")) {
				return { serviceDeskOpenAccess: true };
			}
			if (path === "/rest/servicedeskapi/portals/12") {
				return { id: 12, name: "Demo Portal" };
			}
			throw new Error(`unexpected ${path}`);
		},
	} as unknown as JiraClient;

	const desks = await fetchServiceDesks(client, ["DEMO"], {
		privateApis: true,
	});

	expect(desks[0]?.portal?.name).toBe("Demo Portal");
});

test("a forbidden SLA metrics call does not abort the desk import", async () => {
	const client = {
		getJson: async (
			path: string,
			_params?: Record<string, string | number | boolean | undefined>,
		) => {
			if (path === "/rest/servicedeskapi/servicedesk") {
				return {
					values: [{ id: "1", projectKey: "DEMO", projectName: "Demo" }],
					isLastPage: true,
				};
			}
			if (path.endsWith("/requesttypegroup")) {
				return { values: [], isLastPage: true };
			}
			if (path.endsWith("/requesttype")) {
				return { values: [], isLastPage: true };
			}
			if (path.endsWith("/queue")) {
				return { values: [], isLastPage: true };
			}
			if (path.includes("/sla/metrics")) {
				throw Object.assign(new Error("forbidden"), { status: 403 });
			}
			if (path.includes("/settings/requestsecurity")) {
				return { serviceDeskOpenAccess: true };
			}
			throw new Error(`unexpected ${path}`);
		},
	} as unknown as JiraClient;

	const desks = await fetchServiceDesks(client, ["DEMO"], {
		privateApis: true,
	});
	expect(desks).toHaveLength(1);
	expect(desks[0]?.metrics).toEqual([]);
	expect(desks[0]?.openAccess).toBe(true);
});
