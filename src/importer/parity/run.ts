import { performance } from "node:perf_hooks";
import { ConfluenceClient } from "../confluence.ts";
import { JiraClient } from "../jira.ts";
import { skipped } from "./checks.ts";
import {
	loadJiraSnapshot,
	loadTableSet,
	loadWikiSnapshot,
} from "./database.ts";
import { fileChecks, loadAttachmentFiles } from "./files.ts";
import { jiraChecks } from "./jira-checks.ts";
import { fetchWikiLive } from "./live-confluence.ts";
import { fetchJiraLive } from "./live-jira.ts";
import type {
	CheckResult,
	JiraDatabaseSnapshot,
	JiraLiveSnapshot,
	OldUrlResult,
	ParityReport,
	RunParityOptions,
	WikiLiveSnapshot,
} from "./types.ts";
import { buildOldUrlPaths, requestOldUrls } from "./urls.ts";
import { wikiChecks } from "./wiki-checks.ts";

const wikiCheckNames = [
	"confluence.spaces",
	"confluence.pages",
	"confluence.versions",
	"confluence.comments.page",
	"confluence.comments.inline",
	"confluence.attachments",
	"confluence.attachments.sample",
	"confluence.attachments.sample_bytes",
	"confluence.labels",
	"confluence.restrictions",
	"confluence.permissions",
	"confluence.page_tree",
	"wiki.page_watchers",
	"wiki.space_watchers",
	"wiki.page_likes",
];

function wikiSkippedChecks(): CheckResult[] {
	return wikiCheckNames.map((name) =>
		skipped(name, "wiki tables are not present"),
	);
}

function countingFetch(
	counter: { count: number },
	impl: typeof fetch,
): typeof fetch {
	return (async (input: string | URL | Request, init?: RequestInit) => {
		counter.count++;
		return impl(input, init);
	}) as typeof fetch;
}

function reportOk(
	checks: CheckResult[],
	oldUrls: OldUrlResult[],
	incomplete = false,
) {
	return (
		!incomplete &&
		checks.every((check) => check.status !== "MISMATCH") &&
		oldUrls.every((url) => url.ok !== false)
	);
}

export async function runParity(
	options: RunParityOptions,
): Promise<ParityReport> {
	if (Boolean(options.appUrl) !== Boolean(options.appToken)) {
		throw new Error("--app-url and --app-token must be provided together");
	}
	const started = performance.now();
	const jiraCounter = { count: 0 };
	const confluenceCounter = { count: 0 };
	const tables = await loadTableSet(options.pool);
	const [jiraDb, wikiDb] = await Promise.all([
		options.scope === "confluence"
			? null
			: loadJiraSnapshot(options.pool, tables),
		options.scope === "jira" ? null : loadWikiSnapshot(options.pool, tables),
	]);

	async function fetchLiveJira(
		database: JiraDatabaseSnapshot,
	): Promise<JiraLiveSnapshot> {
		if (!options.jira) {
			throw new Error("JIRA_URL and JIRA_PAT are required for the jira scope");
		}
		const client = new JiraClient({
			baseUrl: options.jira.baseUrl,
			token: options.jira.token,
			fetchImpl: countingFetch(jiraCounter, options.jira.fetchImpl ?? fetch),
		});
		return fetchJiraLive(client, {
			privateApis: options.privateApis,
			serviceDesks: database.serviceDesks !== null,
			agile: database.agile !== null,
			boardsOnly: database.agile === null,
			filters: database.filters !== null,
			filterIds: database.filters?.map((filter) => filter.id),
		});
	}

	async function fetchLiveWiki(): Promise<WikiLiveSnapshot> {
		if (!options.confluence) {
			throw new Error(
				"CONFLUENCE_URL and CONFLUENCE_PAT are required for the confluence scope",
			);
		}
		const client = new ConfluenceClient({
			baseUrl: options.confluence.baseUrl,
			token: options.confluence.token,
			fetchImpl: countingFetch(
				confluenceCounter,
				options.confluence.fetchImpl ?? fetch,
			),
		});
		return fetchWikiLive(client, {
			privateApis: options.privateApis,
		});
	}

	const [liveJira, liveWiki] = await Promise.all([
		jiraDb ? fetchLiveJira(jiraDb) : Promise.resolve(null),
		wikiDb ? fetchLiveWiki() : Promise.resolve(null),
	]);

	const checks: CheckResult[] = [];
	const notes: string[] = [];
	if (liveWiki?.socialShapeKeys && liveWiki.socialShapeKeys.size > 0) {
		notes.push(
			`confluence watchers/likes: unexpected response shape; keys: ${[
				...liveWiki.socialShapeKeys,
			]
				.sort()
				.join(", ")}`,
		);
	}
	const incomplete = liveJira?.incomplete === true;
	if (incomplete) {
		notes.push("jira live snapshot is incomplete: a paged list did not finish");
	}
	let watermark: string | null = null;
	let changedSinceImport: { count: number; issues: string[] } = {
		count: 0,
		issues: [],
	};
	if (jiraDb && liveJira) {
		const result = jiraChecks(liveJira, jiraDb);
		checks.push(...result.checks);
		watermark = result.watermark;
		changedSinceImport = {
			count: result.changedSinceImport.length,
			issues: result.changedSinceImport,
		};
	}
	if (wikiDb && liveWiki) {
		checks.push(...wikiChecks(liveWiki, wikiDb, tables));
	} else if (options.scope !== "jira") {
		checks.push(...wikiSkippedChecks());
	}

	const attachmentFiles = await loadAttachmentFiles(options.pool, tables);
	checks.push(
		...(await fileChecks(
			attachmentFiles,
			options.attachmentsDir,
			options.skipHash,
			options.scope,
		)),
	);

	let oldUrls = buildOldUrlPaths(jiraDb, wikiDb, liveJira?.agile ?? null);
	let appRequests = 0;
	if (options.appUrl && options.appToken) {
		const requested = await requestOldUrls(
			oldUrls,
			options.appUrl,
			options.appToken,
			options.appFetchImpl ?? fetch,
		);
		oldUrls = requested.urls;
		appRequests = requested.requests;
	} else {
		notes.push("old URLs were printed but not requested (no --app-url)");
	}
	if (jiraDb && (liveJira?.agile?.boards.length ?? 0) === 0) {
		notes.push("no agile boards were available for old board URLs");
	}

	return {
		scope: options.scope,
		checks,
		watermark,
		changedSinceImport,
		oldUrls,
		requests: {
			jira: jiraCounter.count,
			confluence: confluenceCounter.count,
			app: appRequests,
		},
		wallClockSeconds: (performance.now() - started) / 1000,
		notes,
		incomplete,
		ok: reportOk(checks, oldUrls, incomplete),
	};
}

function value(value: number | string | null) {
	return value === null ? "-" : String(value);
}

export function formatReport(report: ParityReport) {
	const lines: string[] = [`parity scope: ${report.scope}`];
	lines.push("check | live | database | status");
	for (const check of report.checks) {
		const status =
			check.status === "SKIPPED"
				? `SKIPPED (${check.note ?? "skipped"})`
				: check.status;
		lines.push(
			`${check.name} | ${value(check.live)} | ${value(check.database)} | ${status}`,
		);
		if (check.details.length > 0) {
			lines.push(`  ${check.details.join(", ")}`);
		}
		if (check.status !== "SKIPPED" && check.note) {
			lines.push(`  ${check.note}`);
		}
	}
	if (report.watermark) {
		lines.push(`import watermark (latest issue updated): ${report.watermark}`);
	} else {
		lines.push("import watermark (latest issue updated): not available");
	}
	lines.push(
		`changed since import: ${report.changedSinceImport.count}${
			report.changedSinceImport.issues.length > 0
				? ` (${report.changedSinceImport.issues.join(", ")})`
				: ""
		}`,
	);
	for (const note of report.notes) lines.push(`note: ${note}`);
	lines.push(
		report.oldUrls.some((url) => url.status !== null)
			? "old urls:"
			: "old urls (not requested):",
	);
	for (const url of report.oldUrls) {
		if (url.status === null) {
			lines.push(`  ${url.path}`);
		} else {
			const chain = url.chain.length > 1 ? ` (${url.chain.join(" -> ")})` : "";
			lines.push(
				`  ${url.path} | ${url.status}${chain} | ${url.ok ? "OK" : "FAIL"}${
					url.error ? ` (${url.error})` : ""
				}`,
			);
		}
	}
	lines.push(
		`requests: jira=${report.requests.jira} confluence=${report.requests.confluence} app=${report.requests.app}`,
	);
	lines.push(`wall clock: ${report.wallClockSeconds.toFixed(1)}s`);
	const mismatches = report.checks.filter(
		(check) => check.status === "MISMATCH",
	).length;
	const failedUrls = report.oldUrls.filter((url) => url.ok === false).length;
	lines.push(
		report.ok
			? "result: OK"
			: report.incomplete
				? `result: INCOMPLETE (${mismatches} check(s), ${failedUrls} URL(s))`
				: `result: MISMATCH (${mismatches} check(s), ${failedUrls} URL(s))`,
	);
	return lines.join("\n");
}

export interface ParityCommandOptions extends RunParityOptions {
	json: boolean;
}

export async function runParityCommand(options: ParityCommandOptions) {
	try {
		const report = await runParity(options);
		if (options.json) {
			console.log(JSON.stringify(report, null, 2));
		} else {
			console.log(formatReport(report));
		}
		process.exitCode = report.ok ? 0 : 1;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (options.json) {
			console.log(JSON.stringify({ ok: false, error: message }, null, 2));
		} else {
			console.error(`parity error: ${message}`);
		}
		process.exitCode = 2;
	}
}
