import { describe, expect, test } from "vitest";
import { fetchDataset } from "../src/importer/fetch.ts";
import type { JiraClient } from "../src/importer/jira.ts";
import type { JiraFieldOption } from "../src/importer/types.ts";

function option(id: string, children?: JiraFieldOption[]): JiraFieldOption {
	return { id, value: id, children };
}

interface MockProject {
	key: string;
	issueTypes?: string[];
}

function createClient(options: {
	projects: MockProject[];
	createMeta?: (projectKey: string, issueTypeId: string) => unknown;
}) {
	const paths: string[] = [];
	const client = {
		async getJson(path: string) {
			paths.push(path);
			if (path === "/rest/api/2/user/search") return [];
			if (
				path === "/rest/api/2/issuetype" ||
				path === "/rest/api/2/priority" ||
				path === "/rest/api/2/resolution" ||
				path === "/rest/api/2/status" ||
				path === "/rest/api/2/field"
			) {
				return [];
			}
			if (path === "/rest/api/2/issueLinkType") {
				return { issueLinkTypes: [] };
			}
			if (path === "/rest/api/2/project") {
				return options.projects.map((project) => ({
					id: project.key,
					key: project.key,
					name: project.key,
					projectTypeKey: "software",
				}));
			}
			const project = options.projects.find(
				(candidate) => path === `/rest/api/2/project/${candidate.key}`,
			);
			if (project) {
				return {
					id: project.key,
					key: project.key,
					name: project.key,
					projectTypeKey: "software",
					issueTypes: (project.issueTypes ?? []).map((id) => ({
						id,
						name: `Type ${id}`,
					})),
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
				return { issues: [], total: 0 };
			}
			const meta = path.match(
				/^\/rest\/api\/2\/issue\/createmeta\/([^/]+)\/issuetypes\/([^/]+)$/,
			);
			if (meta) {
				return (
					options.createMeta?.(decodeURIComponent(meta[1]), meta[2]) ?? {
						values: [],
						isLast: true,
					}
				);
			}
			throw new Error(`unexpected request ${path}`);
		},
	};
	return { client: client as unknown as JiraClient, paths };
}

describe("Jira field options across projects", () => {
	test("merges grandchildren contributed by a later project", async () => {
		const { client } = createClient({
			projects: [
				{ key: "DEMO", issueTypes: ["1"] },
				{ key: "OPS", issueTypes: ["1"] },
			],
			createMeta(projectKey) {
				return {
					values: [
						{
							fieldId: "customfield_10001",
							allowedValues: [
								option("parent", [
									option(
										"child",
										projectKey === "OPS" ? [option("grandchild")] : undefined,
									),
								]),
							],
						},
					],
					isLast: true,
				};
			},
		});

		const dataset = await fetchDataset(client, {
			attachmentsDir: "/tmp",
			skipAttachments: true,
			privateApis: false,
		});

		expect(dataset.fieldOptions).toEqual([
			{
				fieldId: "customfield_10001",
				options: [option("parent", [option("child", [option("grandchild")])])],
			},
		]);
	});

	test("requests create-meta for separate projects concurrently", async () => {
		let started = 0;
		let release!: () => void;
		const bothStarted = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { client } = createClient({
			projects: [
				{ key: "DEMO", issueTypes: ["1"] },
				{ key: "OPS", issueTypes: ["1"] },
			],
			async createMeta(projectKey) {
				started++;
				if (started === 2) release();
				await Promise.race([
					bothStarted,
					new Promise((_, reject) =>
						setTimeout(
							() => reject(new Error("create-meta requests did not overlap")),
							2_000,
						),
					),
				]);
				return {
					values: [
						{
							fieldId:
								projectKey === "DEMO"
									? "customfield_10001"
									: "customfield_10002",
							allowedValues: [option(projectKey.toLowerCase())],
						},
					],
					isLast: true,
				};
			},
		});

		const dataset = await fetchDataset(client, {
			attachmentsDir: "/tmp",
			skipAttachments: true,
			privateApis: false,
		});

		expect(dataset.fieldOptions.map((field) => field.fieldId)).toEqual([
			"customfield_10001",
			"customfield_10002",
		]);
	});
});

describe("Jira project selection", () => {
	test("fetches details only for the requested projects", async () => {
		const { client, paths } = createClient({
			projects: [{ key: "DEMO" }, { key: "OPS" }],
		});

		const dataset = await fetchDataset(client, {
			attachmentsDir: "/tmp",
			skipAttachments: true,
			projectKeys: ["demo"],
			privateApis: false,
		});

		expect(dataset.projects.map((project) => project.project.key)).toEqual([
			"DEMO",
		]);
		expect(
			paths.filter((path) => path.startsWith("/rest/api/2/project/OPS")),
		).toEqual([]);
		expect(
			paths.filter((path) => path.startsWith("/rest/api/2/project/DEMO")),
		).toHaveLength(4);
	});

	test("still reports a project key the instance does not have", async () => {
		const { client } = createClient({ projects: [{ key: "DEMO" }] });

		await expect(
			fetchDataset(client, {
				attachmentsDir: "/tmp",
				skipAttachments: true,
				projectKeys: ["NOPE"],
				privateApis: false,
			}),
		).rejects.toThrow("Unknown project keys: NOPE");
	});
});
