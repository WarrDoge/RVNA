import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { importJiraAgile } from "../src/importer/agile-remote.ts";
import { fetchDashboardDataset } from "../src/importer/dashboards.ts";
import { pool, runMigrations } from "../src/importer/db.ts";
import { fetchDataset, fetchWorkflows } from "../src/importer/fetch.ts";
import { importDataset } from "../src/importer/import.ts";
import type { JiraClient } from "../src/importer/jira.ts";
import { skipPrivateApi } from "../src/importer/private-apis.ts";
import {
	fetchAutomationRules,
	fetchServiceDesks,
	fetchSlaCalendars,
} from "../src/importer/servicedesk.ts";
import { fetchPageSocial } from "../src/importer/wiki-social.ts";

const privatePaths = [
	"/rest/greenhopper/1.0",
	"/rest/servicedesk/1",
	"/rest/workinghours/1",
	"/rest/cb-automation/latest",
	"/rest/dashboards/1.0",
	"/rest/workflowDesigner/1.0",
	"/json/listwatchers.action",
	"/rest/likes/1.0",
];

function privateRequested(paths: string[]) {
	return paths.filter((path) =>
		privatePaths.some((privatePath) => path.startsWith(privatePath)),
	);
}

beforeAll(async () => {
	await runMigrations();
});

afterAll(async () => {
	await pool.end();
});

test("private fetch helpers do nothing without the flag", async () => {
	const paths: string[] = [];
	const client = {
		async getJson(path: string) {
			paths.push(path);
			if (path === "/rest/servicedeskapi/servicedesk") {
				return {
					values: [{ id: "1", projectKey: "SD", projectName: "SD" }],
					isLastPage: true,
				};
			}
			if (path.startsWith("/rest/servicedeskapi/")) {
				return { values: [], isLastPage: true };
			}
			if (path === "/json/listwatchers.action") {
				return { pageWatchers: [], spaceWatchers: [] };
			}
			throw new Error(`unexpected request ${path}`);
		},
	};

	expect(await fetchWorkflows(client as never, {})).toEqual([]);
	expect(await fetchSlaCalendars(client as never, {})).toEqual([]);
	expect(await fetchAutomationRules(client as never, {})).toEqual([]);
	expect(await fetchDashboardDataset(client as never, {})).toEqual({
		owner: "",
		dashboards: [],
		filters: [],
		favouriteFilters: [],
		favouriteDashboards: [],
	});
	expect(await fetchServiceDesks(client as never, ["SD"], {})).toHaveLength(1);
	expect(await fetchPageSocial(client as never, "1", "current", {})).toEqual({
		watchers: [],
		spaceWatchers: [],
		likes: [],
		unexpectedKeys: [],
	});
	expect(await importJiraAgile(client as never)).toEqual({
		counts: {},
		boards: 0,
		sprints: { future: 0, active: 0, closed: 0 },
		issueSprints: 0,
		issues: 0,
	});
	expect(privateRequested(paths)).toEqual([]);
});

test("a full Jira fetch and import work without the private APIs", async () => {
	const run = randomUUID().slice(0, 8);
	const key = `NP${run.slice(0, 6).toUpperCase()}`;
	const paths: string[] = [];
	const empty = () => [];
	const client = {
		async getJson(path: string) {
			paths.push(path);
			if (path === "/rest/api/2/user/search") return empty();
			if (path === "/rest/api/2/issuetype") return empty();
			if (path === "/rest/api/2/priority") return empty();
			if (path === "/rest/api/2/resolution") return empty();
			if (path === "/rest/api/2/status") return empty();
			if (path === "/rest/api/2/field") return empty();
			if (path === "/rest/api/2/issueLinkType") {
				return { issueLinkTypes: [] };
			}
			if (path === "/rest/api/2/project") {
				return [
					{
						id: `source-${run}`,
						key,
						name: "No private APIs",
						projectTypeKey: "software",
					},
				];
			}
			if (path === `/rest/api/2/project/${key}`) {
				return {
					id: `source-${run}`,
					key,
					name: "No private APIs",
					projectTypeKey: "software",
				};
			}
			if (
				path.endsWith("/components") ||
				path.endsWith("/versions") ||
				path.endsWith("/statuses")
			) {
				return empty();
			}
			if (path === "/rest/api/2/search") {
				return { issues: [], total: 0 };
			}
			throw new Error(`unexpected request ${path}`);
		},
	};

	try {
		const dataset = await fetchDataset(client as unknown as JiraClient, {
			attachmentsDir: "/tmp",
			skipAttachments: true,
			privateApis: false,
		});
		expect(dataset.workflows).toEqual([]);
		expect(dataset.serviceDesks).toEqual([]);
		expect(dataset.slaCalendars).toEqual([]);
		expect(dataset.automationRules).toEqual([]);

		const result = await importDataset(dataset, {
			baseUrl: "https://jira.example.test",
			fullImport: true,
			privateApis: false,
		});
		expect(result.counts.projects?.inserted).toBe(1);
		expect(privateRequested(paths)).toEqual([]);
	} finally {
		await pool.query("delete from projects where key = $1", [key]);
	}
});

test("a skipped private API notice goes to stderr, not the JSON report on stdout", () => {
	const log = vi.spyOn(console, "log").mockImplementation(() => {});
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	try {
		expect(skipPrivateApi({}, `fixture part ${randomUUID()}`)).toBe(true);
		expect(log).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledTimes(1);
	} finally {
		log.mockRestore();
		warn.mockRestore();
	}
});
