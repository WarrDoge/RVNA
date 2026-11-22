import type pg from "pg";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type {
	CheckResult,
	JiraDatabaseSnapshot,
	JiraLiveSnapshot,
	RunParityOptions,
	TableSet,
	WikiDatabaseSnapshot,
	WikiLiveSnapshot,
} from "../src/importer/parity/types.ts";

vi.mock("../src/importer/jira.ts", () => ({
	JiraClient: class {},
}));
vi.mock("../src/importer/confluence.ts", () => ({
	ConfluenceClient: class {},
}));
vi.mock("../src/importer/parity/database.ts", () => ({
	loadTableSet: vi.fn(),
	loadJiraSnapshot: vi.fn(),
	loadWikiSnapshot: vi.fn(),
}));
vi.mock("../src/importer/parity/live-jira.ts", () => ({
	fetchJiraLive: vi.fn(),
}));
vi.mock("../src/importer/parity/live-confluence.ts", () => ({
	fetchWikiLive: vi.fn(),
}));
vi.mock("../src/importer/parity/jira-checks.ts", () => ({
	jiraChecks: vi.fn(),
}));
vi.mock("../src/importer/parity/wiki-checks.ts", () => ({
	wikiChecks: vi.fn(),
}));
vi.mock("../src/importer/parity/files.ts", () => ({
	loadAttachmentFiles: vi.fn(),
	fileChecks: vi.fn(),
}));
vi.mock("../src/importer/parity/urls.ts", () => ({
	buildOldUrlPaths: vi.fn(),
	requestOldUrls: vi.fn(),
}));

import {
	loadJiraSnapshot,
	loadTableSet,
	loadWikiSnapshot,
} from "../src/importer/parity/database.ts";
import {
	fileChecks,
	loadAttachmentFiles,
} from "../src/importer/parity/files.ts";
import { jiraChecks } from "../src/importer/parity/jira-checks.ts";
import { fetchWikiLive } from "../src/importer/parity/live-confluence.ts";
import { fetchJiraLive } from "../src/importer/parity/live-jira.ts";
import { runParity } from "../src/importer/parity/run.ts";
import {
	buildOldUrlPaths,
	requestOldUrls,
} from "../src/importer/parity/urls.ts";
import { wikiChecks } from "../src/importer/parity/wiki-checks.ts";

const loadTableSetMock = vi.mocked(loadTableSet);
const loadJiraSnapshotMock = vi.mocked(loadJiraSnapshot);
const loadWikiSnapshotMock = vi.mocked(loadWikiSnapshot);
const fetchJiraLiveMock = vi.mocked(fetchJiraLive);
const fetchWikiLiveMock = vi.mocked(fetchWikiLive);
const jiraChecksMock = vi.mocked(jiraChecks);
const wikiChecksMock = vi.mocked(wikiChecks);
const loadAttachmentFilesMock = vi.mocked(loadAttachmentFiles);
const fileChecksMock = vi.mocked(fileChecks);
const buildOldUrlPathsMock = vi.mocked(buildOldUrlPaths);
const requestOldUrlsMock = vi.mocked(requestOldUrls);

const tables: TableSet = {
	has: () => true,
	columns: () => new Set(),
	hasColumns: () => true,
};

const jiraDb: JiraDatabaseSnapshot = {
	projects: ["A"],
	issues: new Map(),
	users: [],
	issueTypes: [],
	statuses: [],
	priorities: [],
	resolutions: [],
	linkTypes: [],
	versionsByProject: new Map(),
	componentsByProject: new Map(),
	projectWorkflows: [],
	workflowResolutionTransitions: new Map(),
	serviceDesks: null,
	agile: null,
	filters: null,
};

const wikiDb: WikiDatabaseSnapshot = {
	spaces: [],
	pages: new Map(),
	versions: new Map(),
	comments: new Map(),
	attachments: new Map(),
	labels: new Map(),
	restrictions: new Map(),
	permissions: new Map(),
	tree: new Map(),
	pageWatchers: new Map(),
	spaceWatchers: new Map(),
	pageLikes: new Map(),
};

const liveJira: JiraLiveSnapshot = {
	projects: [],
	issues: new Map(),
	users: [],
	issueTypes: [],
	statuses: [],
	priorities: [],
	resolutions: [],
	linkTypes: [],
	workflowResolutionTransitions: new Map(),
	serviceDesks: null,
	agile: null,
	filters: null,
};

const liveWiki: WikiLiveSnapshot = {
	spaces: [],
	pages: new Map(),
	versions: new Map(),
	comments: new Map(),
	attachments: new Map(),
	attachmentSample: [],
	permissions: new Map(),
	tree: new Map(),
	pageWatchers: new Map(),
	spaceWatchers: new Map(),
	pageLikes: new Map(),
};

function ok(name: string): CheckResult {
	return { name, live: 1, database: 1, status: "OK", details: [] };
}

function options(overrides: Partial<RunParityOptions> = {}): RunParityOptions {
	return {
		scope: "all",
		skipHash: false,
		attachmentsDir: "/tmp",
		pool: {} as pg.Pool,
		jira: { baseUrl: "https://jira.example.test", token: "jira-secret" },
		confluence: {
			baseUrl: "https://confluence.example.test",
			token: "confluence-secret",
		},
		...overrides,
	};
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
	vi.resetAllMocks();
	loadTableSetMock.mockResolvedValue(tables);
	loadJiraSnapshotMock.mockResolvedValue(jiraDb);
	loadWikiSnapshotMock.mockResolvedValue(wikiDb);
	fetchJiraLiveMock.mockResolvedValue(liveJira);
	fetchWikiLiveMock.mockResolvedValue(liveWiki);
	jiraChecksMock.mockReturnValue({
		checks: [ok("jira.projects")],
		watermark: null,
		changedSinceImport: [],
	});
	wikiChecksMock.mockReturnValue([ok("confluence.spaces")]);
	loadAttachmentFilesMock.mockResolvedValue({ jira: [], wiki: [] });
	fileChecksMock.mockResolvedValue([ok("files.attachments")]);
	buildOldUrlPathsMock.mockReturnValue([]);
	requestOldUrlsMock.mockImplementation(async (urls) => ({
		urls,
		requests: 0,
	}));
});

describe("parity run", () => {
	test("database snapshots load concurrently", async () => {
		let active = 0;
		let maxActive = 0;
		const track = async <T>(value: T) => {
			active++;
			maxActive = Math.max(maxActive, active);
			await sleep(20);
			active--;
			return value;
		};
		loadJiraSnapshotMock.mockImplementation(() => track(jiraDb));
		loadWikiSnapshotMock.mockImplementation(() => track(wikiDb));

		const report = await runParity(options());

		expect(maxActive).toBe(2);
		expect(report.ok).toBe(true);
		expect(report.checks.map((check) => check.name)).toEqual([
			"jira.projects",
			"confluence.spaces",
			"files.attachments",
		]);
	});

	test("live Jira and Confluence fetches run concurrently", async () => {
		let active = 0;
		let maxActive = 0;
		const track = async <T>(value: T) => {
			active++;
			maxActive = Math.max(maxActive, active);
			await sleep(20);
			active--;
			return value;
		};
		fetchJiraLiveMock.mockImplementation(() => track(liveJira));
		fetchWikiLiveMock.mockImplementation(() => track(liveWiki));

		const report = await runParity(options());

		expect(maxActive).toBe(2);
		expect(report.checks).toHaveLength(3);
	});

	test("app credentials are validated before any work", async () => {
		loadTableSetMock.mockImplementation(() => {
			throw new Error("database was read");
		});

		await expect(
			runParity(options({ appUrl: "https://app.example.test" })),
		).rejects.toThrow("--app-url and --app-token must be provided together");
		expect(loadTableSetMock).not.toHaveBeenCalled();

		await expect(
			runParity(options({ appToken: "app-secret" })),
		).rejects.toThrow("--app-url and --app-token must be provided together");
		expect(loadTableSetMock).not.toHaveBeenCalled();
	});

	test("both app credentials are accepted and the token is used", async () => {
		requestOldUrlsMock.mockResolvedValue({ urls: [], requests: 1 });

		const report = await runParity(
			options({
				appUrl: "https://app.example.test",
				appToken: "app-secret",
			}),
		);

		expect(requestOldUrlsMock).toHaveBeenCalledWith(
			[],
			"https://app.example.test",
			"app-secret",
			expect.any(Function),
		);
		expect(report.requests.app).toBe(1);
	});

	test("the board note follows the live board list, not the URL text", async () => {
		fetchJiraLiveMock.mockResolvedValue({
			...liveJira,
			agile: { boards: [{ id: "1", sprints: [] }] },
		});
		buildOldUrlPathsMock.mockReturnValue([
			{ path: "/browse/A-1", status: null, chain: [], ok: null },
		]);

		const report = await runParity(options());

		expect(report.notes).not.toContain(
			"no agile boards were available for old board URLs",
		);
	});

	test("the board note is added when there are no live boards", async () => {
		fetchJiraLiveMock.mockResolvedValue({
			...liveJira,
			agile: { boards: [] },
		});
		buildOldUrlPathsMock.mockReturnValue([
			{
				path: "/secure/RapidBoard.jspa?rapidView=1",
				status: null,
				chain: [],
				ok: null,
			},
		]);

		const report = await runParity(options());

		expect(report.notes).toContain(
			"no agile boards were available for old board URLs",
		);
	});
});
