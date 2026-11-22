import { expect, test } from "vitest";
import { GetOnlyRequestError } from "../src/importer/client.ts";
import { fetchDashboardDataset } from "../src/importer/dashboards.ts";

test("dashboard details, filter pages and filter details are requested in parallel", async () => {
	const active = { dashboards: 0, views: 0, filters: 0 };
	const peak = { dashboards: 0, views: 0, filters: 0 };
	const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
	async function tracked<T>(kind: keyof typeof active, work: () => T) {
		active[kind]++;
		peak[kind] = Math.max(peak[kind], active[kind]);
		await tick();
		try {
			return work();
		} finally {
			active[kind]--;
		}
	}
	const client = {
		async getJson(path: string) {
			if (path === "/rest/api/2/myself") return { name: "importer" };
			if (path === "/rest/api/2/dashboard") {
				return {
					dashboards: [{ id: "1" }, { id: "2" }, { id: "3" }],
					total: 3,
				};
			}
			if (path.startsWith("/rest/dashboards/1.0/")) {
				return tracked("dashboards", () => ({
					id: path.split("/").at(-1),
					title: "Dashboard",
					layout: "AA",
					gadgets: [],
				}));
			}
			if (path === "/rest/api/2/filter/favourite") return [];
			if (path.startsWith("/rest/api/2/filter/")) {
				const id = path.split("/").at(-1);
				return tracked("filters", () => ({
					id,
					name: `Filter ${id}`,
					jql: "project = DEMO",
					owner: { name: "importer" },
				}));
			}
			throw new GetOnlyRequestError(404, path);
		},
		async request(_method: string, path: string) {
			if (path === "/secure/ManageFilters.jspa") {
				return tracked("views", () => ({
					async text() {
						return '<input data-id="entityId" value="20"/><input data-id="entityId" value="21"/>';
					},
				}));
			}
			throw new GetOnlyRequestError(404, path);
		},
	};

	const dataset = await fetchDashboardDataset(
		client as unknown as Parameters<typeof fetchDashboardDataset>[0],
		{ privateApis: true },
	);
	expect(dataset.dashboards.map((dashboard) => dashboard.id)).toEqual([
		"1",
		"2",
		"3",
	]);
	expect(dataset.filters.map((filter) => filter.id)).toEqual(["20", "21"]);
	expect(peak.dashboards).toBeGreaterThan(1);
	expect(peak.views).toBeGreaterThan(1);
	expect(peak.filters).toBeGreaterThan(1);
});

test("a dashboard the token cannot open does not abort the whole import", async () => {
	const client = {
		async getJson(path: string) {
			if (path === "/rest/api/2/myself") return { name: "importer" };
			if (path === "/rest/api/2/dashboard") {
				return {
					dashboards: [{ id: "1" }, { id: "2" }, { id: "3" }],
					total: 3,
				};
			}
			if (path === "/rest/dashboards/1.0/1") {
				return { id: "1", title: "One", layout: "AA", gadgets: [] };
			}
			if (path === "/rest/dashboards/1.0/2") {
				throw new GetOnlyRequestError(403, path);
			}
			if (path === "/rest/dashboards/1.0/3") {
				throw new GetOnlyRequestError(404, path);
			}
			if (path === "/rest/api/2/filter/favourite") return [];
			throw new GetOnlyRequestError(404, path);
		},
		async request() {
			return {
				async text() {
					return "";
				},
			};
		},
	};

	const dataset = await fetchDashboardDataset(
		client as unknown as Parameters<typeof fetchDashboardDataset>[0],
		{ privateApis: true },
	);
	expect(dataset.dashboards.map((dashboard) => dashboard.id)).toEqual(["1"]);
});

test("a dashboard that fails for another reason still aborts the import", async () => {
	const client = {
		async getJson(path: string) {
			if (path === "/rest/api/2/myself") return { name: "importer" };
			if (path === "/rest/api/2/dashboard") {
				return { dashboards: [{ id: "1" }], total: 1 };
			}
			if (path === "/rest/dashboards/1.0/1") {
				throw new GetOnlyRequestError(500, path);
			}
			if (path === "/rest/api/2/filter/favourite") return [];
			throw new GetOnlyRequestError(404, path);
		},
		async request() {
			return {
				async text() {
					return "";
				},
			};
		},
	};

	await expect(
		fetchDashboardDataset(
			client as unknown as Parameters<typeof fetchDashboardDataset>[0],
			{ privateApis: true },
		),
	).rejects.toThrow("500");
});

test("a filter request that fails with a non-object error keeps that error", async () => {
	const client = {
		async getJson(path: string) {
			if (path === "/rest/api/2/myself") return { name: "importer" };
			if (path === "/rest/api/2/dashboard") {
				return { dashboards: [], total: 0 };
			}
			if (path === "/rest/api/2/filter/favourite") return [{ id: "20" }];
			if (path === "/rest/api/2/filter/20") throw null;
			throw new GetOnlyRequestError(404, path);
		},
		async request() {
			return {
				async text() {
					return "";
				},
			};
		},
	};

	await expect(
		fetchDashboardDataset(
			client as unknown as Parameters<typeof fetchDashboardDataset>[0],
			{ privateApis: true },
		),
	).rejects.toBeNull();
});

test("a filter that Jira no longer has is skipped", async () => {
	const client = {
		async getJson(path: string) {
			if (path === "/rest/api/2/myself") return { name: "importer" };
			if (path === "/rest/api/2/dashboard") {
				return { dashboards: [], total: 0 };
			}
			if (path === "/rest/api/2/filter/favourite") {
				return [{ id: "20" }, { id: "21" }];
			}
			if (path === "/rest/api/2/filter/20") {
				return {
					id: "20",
					name: "Still there",
					jql: "project = DEMO",
					owner: { name: "importer" },
				};
			}
			if (path === "/rest/api/2/filter/21") {
				throw new GetOnlyRequestError(404, path);
			}
			throw new GetOnlyRequestError(404, path);
		},
		async request() {
			return {
				async text() {
					return "";
				},
			};
		},
	};

	const dataset = await fetchDashboardDataset(
		client as unknown as Parameters<typeof fetchDashboardDataset>[0],
		{ privateApis: true },
	);
	expect(dataset.filters.map((filter) => filter.id)).toEqual(["20"]);
});
