import type pg from "pg";

export type ParityScope = "jira" | "confluence" | "all";

export type CheckStatus = "OK" | "MISMATCH" | "SKIPPED";

export interface CheckResult {
	name: string;
	live: number | string | null;
	database: number | string | null;
	status: CheckStatus;
	details: string[];
	note?: string;
}

export interface JiraUserRef {
	key: string | null;
	username: string;
	active: boolean;
}

export interface JiraIssueData {
	key: string;
	number: number;
	projectKey: string;
	status: string;
	resolution: string | null;
	assignee: string | null;
	updated: string | null;
	comments: number;
	worklogs: number;
	attachments: number;
	attachmentBytes: number;
	links: number;
	watchers: number;
	subtasks: number;
	history: number;
}

export interface JiraProjectData {
	key: string;
	issueTotal: number;
	versions: string[];
	components: string[];
	statusesByIssueType: Map<string, string[]>;
}

export interface JiraServiceDeskData {
	sourceId: string;
	projectKey: string;
	requestTypes: string[];
	queues: { id: string; jql: string; issueCount: number | null }[];
	metrics: string[];
}

export interface JiraSprintData {
	id: string;
	state: string;
	issueCount: number;
}

export interface JiraBoardData {
	id: string;
	sprints: JiraSprintData[];
}

export interface JiraAgileData {
	boards: JiraBoardData[];
}

export interface JiraFilterData {
	id: string;
	name: string;
	jql: string;
}

export interface JiraLiveSnapshot {
	projects: JiraProjectData[];
	issues: Map<string, JiraIssueData>;
	users: JiraUserRef[];
	issueTypes: string[];
	statuses: string[];
	priorities: string[];
	resolutions: string[];
	linkTypes: string[];
	workflowResolutionTransitions: Map<string, string[]>;
	workflowResolutionSkipped?: boolean;
	serviceDesks: JiraServiceDeskData[] | null;
	serviceDeskMetricsSkipped?: boolean;
	agile: JiraAgileData | null;
	filters: JiraFilterData[] | null;
}

export interface JiraProjectWorkflowData {
	projectKey: string;
	issueTypeSourceId: string | null;
	statuses: string[];
}

export interface JiraDatabaseSnapshot {
	projects: string[];
	/** Issues whose current state was changed in the application. */
	localIssues?: Set<string>;
	issues: Map<string, JiraIssueData>;
	users: JiraUserRef[];
	issueTypes: string[];
	statuses: string[];
	priorities: string[];
	resolutions: string[];
	linkTypes: string[];
	versionsByProject: Map<string, string[]>;
	componentsByProject: Map<string, string[]>;
	projectWorkflows: JiraProjectWorkflowData[];
	workflowResolutionTransitions: Map<string, string[]> | null;
	serviceDesks: JiraServiceDeskData[] | null;
	agile: JiraAgileData | null;
	filters: JiraFilterData[] | null;
}

export interface WikiPageData {
	sourceId: string;
	spaceKey: string;
	status: "current" | "draft" | "trashed";
	type: "page" | "blogpost";
	parentSourceId: string | null;
	position: number;
	title: string;
}

export interface WikiPageTreeData {
	parentSourceId: string | null;
	position: number;
}

export interface WikiAttachmentData {
	sourceId: string;
	size: number;
	sha256: string;
}

export interface WikiAttachmentSample {
	sourceId: string;
	pageSourceId: string;
	size: number;
	sha256: string;
}

export interface WikiLivePageData extends WikiPageData {
	created: string | null;
	labels: string[];
	restrictions: string[];
}

export interface WikiLiveSnapshot {
	spaces: { key: string; sourceId: string; status: string }[];
	pages: Map<string, WikiLivePageData>;
	versions: Map<string, number>;
	comments: Map<string, { page: number; inline: number }>;
	attachments: Map<string, WikiAttachmentData[]>;
	attachmentSample: WikiAttachmentSample[];
	permissions: Map<string, string[]>;
	tree: Map<string, WikiPageTreeData>;
	pageWatchers: Map<string, number>;
	spaceWatchers: Map<string, number>;
	watchersSkipped?: boolean;
	pageLikes: Map<string, number>;
	pageLikesSkipped?: boolean;
	/** Top-level keys of watcher/like responses that did not have the expected shape. */
	socialShapeKeys?: Set<string>;
}

export interface WikiDatabaseSnapshot {
	spaces: { key: string; sourceId: string; status: string }[];
	/** Pages whose current state was changed in the application. */
	localPages?: Set<string>;
	pages: Map<string, WikiPageData>;
	versions: Map<string, number>;
	comments: Map<string, { page: number; inline: number }>;
	attachments: Map<string, WikiAttachmentData[]>;
	labels: Map<string, string[]>;
	restrictions: Map<string, string[]>;
	permissions: Map<string, string[]>;
	tree: Map<string, WikiPageTreeData>;
	pageWatchers: Map<string, number>;
	spaceWatchers: Map<string, number>;
	pageLikes: Map<string, number>;
}

export interface TableSet {
	has(table: string): boolean;
	columns(table: string): Set<string> | undefined;
	hasColumns(table: string, columns: string[]): boolean;
}

export interface ParityDatabase {
	tables: TableSet;
	jira: JiraDatabaseSnapshot | null;
	wiki: WikiDatabaseSnapshot | null;
}

export interface OldUrlResult {
	path: string;
	status: number | null;
	chain: number[];
	ok: boolean | null;
	error?: string;
}

export interface ParityReport {
	scope: ParityScope;
	checks: CheckResult[];
	watermark: string | null;
	changedSinceImport: { count: number; issues: string[] };
	oldUrls: OldUrlResult[];
	requests: { jira: number; confluence: number; app: number };
	wallClockSeconds: number;
	notes: string[];
	ok: boolean;
}

export interface RunParityOptions {
	scope: ParityScope;
	skipHash: boolean;
	privateApis?: boolean;
	attachmentsDir: string;
	pool: pg.Pool;
	appUrl?: string;
	appToken?: string;
	appFetchImpl?: typeof fetch;
	jira?: { baseUrl: string; token: string; fetchImpl?: typeof fetch };
	confluence?: {
		baseUrl: string;
		token: string;
		fetchImpl?: typeof fetch;
	};
}
