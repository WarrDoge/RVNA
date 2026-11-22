import { parseArgs } from "node:util";
import { importAgileLocal } from "./agile.ts";
import {
	importConfluenceAvatars,
	importJiraAvatars,
	printAvatarCounts,
} from "./avatars.ts";
import { ConfluenceClient } from "./confluence.ts";
import { importConfluenceGroups } from "./confluence-groups.ts";
import { fetchDashboardDataset } from "./dashboards.ts";
import {
	importDashboardDataset,
	summarizeFilterShares,
} from "./dashboards-import.ts";
import { db, pool, runMigrations } from "./db.ts";
import { importerEnv, requiredEnv } from "./env.ts";
import { fetchDataset } from "./fetch.ts";
import { importDataset, loadAttachmentIndex } from "./import.ts";
import { JiraClient } from "./jira.ts";
import { loadTableSet } from "./parity/database.ts";
import { runParityCommand } from "./parity/run.ts";
import { importPermissions } from "./permissions.ts";
import { skipPrivateApi } from "./private-apis.ts";
import { formatLocalChanges, mergeCounts, printCounts } from "./upsert.ts";
import { fetchWikiDataset } from "./wiki-fetch.ts";
import { importWikiDataset, loadWikiAttachmentIndex } from "./wiki-import.ts";

const usage =
	"Usage: npm run import -- jira [--project KEY]... [--skip-attachments] [--skip-avatars] [--overwrite-local] [--private-apis] | jira-avatars | jira-agile [--overwrite-local] [--private-apis] | jira-dashboards [--private-apis] | jira-permissions [--project KEY]... | jira-agile-local | confluence [--space KEY]... [--skip-attachments] [--skip-avatars] [--overwrite-local] [--private-apis] | confluence-groups | confluence-avatars | parity [jira|confluence|all] [--json] [--skip-hash] [--private-apis] [--app-url URL --app-token TOKEN]";

let parityCommand = false;

function rejectOptions(values: object, allowed: readonly string[]) {
	if (
		Object.entries(values).some(
			([name, value]) => value !== undefined && !allowed.includes(name),
		)
	) {
		throw new Error(usage);
	}
}

function parseCli(argv: string[]) {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			project: { type: "string", multiple: true },
			space: { type: "string", multiple: true },
			"skip-attachments": { type: "boolean" },
			json: { type: "boolean" },
			"skip-hash": { type: "boolean" },
			"app-url": { type: "string" },
			"app-token": { type: "string" },
			"skip-avatars": { type: "boolean" },
			"overwrite-local": { type: "boolean" },
			"private-apis": { type: "boolean" },
		},
	});

	const command = positionals[0];
	parityCommand = command === "parity";
	if (positionals.length < 1 || positionals.length > 2) throw new Error(usage);

	if (command === "parity") {
		const scope = positionals[1] ?? "all";
		if (scope !== "jira" && scope !== "confluence" && scope !== "all") {
			throw new Error(usage);
		}
		rejectOptions(values, [
			"json",
			"skip-hash",
			"private-apis",
			"app-url",
			"app-token",
		]);
		return {
			command,
			scope,
			json: values.json ?? false,
			skipHash: values["skip-hash"] ?? false,
			privateApis: values["private-apis"] ?? false,
			appUrl: values["app-url"],
			appToken: values["app-token"],
		} as const;
	}

	if (positionals.length !== 1) throw new Error(usage);

	if (command === "jira") {
		rejectOptions(values, [
			"project",
			"skip-attachments",
			"skip-avatars",
			"overwrite-local",
			"private-apis",
		]);
		return {
			command,
			projectKeys: values.project,
			spaceKeys: undefined,
			skipAttachments: values["skip-attachments"] ?? false,
			skipAvatars: values["skip-avatars"] ?? false,
			overwriteLocal: values["overwrite-local"] ?? false,
			privateApis: values["private-apis"] ?? false,
		} as const;
	}

	if (command === "jira-avatars") {
		rejectOptions(values, []);
		return {
			command,
			projectKeys: undefined,
			spaceKeys: undefined,
			skipAttachments: false,
			skipAvatars: false,
			privateApis: false,
		} as const;
	}

	if (command === "jira-agile") {
		rejectOptions(values, ["overwrite-local", "private-apis"]);
		return {
			command,
			projectKeys: undefined,
			spaceKeys: undefined,
			skipAttachments: false,
			overwriteLocal: values["overwrite-local"] ?? false,
			privateApis: values["private-apis"] ?? false,
		} as const;
	}

	if (command === "jira-agile-local") {
		rejectOptions(values, []);
		return {
			command,
			projectKeys: undefined,
			spaceKeys: undefined,
			skipAttachments: false,
			privateApis: false,
		} as const;
	}

	if (command === "jira-dashboards") {
		rejectOptions(values, ["private-apis"]);
		return {
			command,
			projectKeys: undefined,
			spaceKeys: undefined,
			skipAttachments: true,
			privateApis: values["private-apis"] ?? false,
		} as const;
	}

	if (command === "jira-permissions") {
		rejectOptions(values, ["project"]);
		return {
			command,
			projectKeys: values.project,
			spaceKeys: undefined,
			skipAttachments: true,
			privateApis: false,
		} as const;
	}

	if (command === "confluence") {
		rejectOptions(values, [
			"space",
			"skip-attachments",
			"skip-avatars",
			"overwrite-local",
			"private-apis",
		]);
		return {
			command,
			projectKeys: undefined,
			spaceKeys: values.space,
			skipAttachments: values["skip-attachments"] ?? false,
			skipAvatars: values["skip-avatars"] ?? false,
			overwriteLocal: values["overwrite-local"] ?? false,
			privateApis: values["private-apis"] ?? false,
		} as const;
	}

	if (command === "confluence-groups") {
		rejectOptions(values, []);
		return {
			command,
			projectKeys: undefined,
			spaceKeys: undefined,
			skipAttachments: true,
			privateApis: false,
		} as const;
	}

	if (command === "confluence-avatars") {
		rejectOptions(values, []);
		return {
			command,
			projectKeys: undefined,
			spaceKeys: undefined,
			skipAttachments: false,
			skipAvatars: false,
			privateApis: false,
		} as const;
	}

	throw new Error(usage);
}

async function importJira(options: {
	projectKeys?: string[];
	skipAttachments: boolean;
	skipAvatars: boolean;
	overwriteLocal: boolean;
	privateApis: boolean;
}) {
	const client = new JiraClient({
		baseUrl: requiredEnv("JIRA_URL"),
		token: requiredEnv("JIRA_PAT"),
	});
	const dataset = await fetchDataset(client, {
		attachmentsDir: importerEnv.ATTACHMENTS_DIR,
		skipAttachments: options.skipAttachments,
		projectKeys: options.projectKeys,
		privateApis: options.privateApis,
		existingAttachments: options.skipAttachments
			? undefined
			: await loadAttachmentIndex(),
	});
	const fullImport = !options.projectKeys || options.projectKeys.length === 0;
	const result = await importDataset(dataset, {
		baseUrl: requiredEnv("JIRA_URL"),
		fullImport,
		skipAttachments: options.skipAttachments,
		overwriteLocal: options.overwriteLocal,
		privateApis: options.privateApis,
	});
	const permissionResult = await importPermissions(client, {
		projectKeys: dataset.projects.map((project) => project.project.key),
		fullImport,
	});
	for (const [table, tableCounts] of Object.entries(permissionResult.counts)) {
		mergeCounts(result.counts, table, tableCounts);
	}
	for (const line of permissionResult.report) console.log(line);

	console.log(
		`jira import: ${dataset.issues.length} issues from ${dataset.projects.length} projects`,
	);
	if (dataset.serviceDesks?.length) {
		const desks = dataset.serviceDesks;
		console.log(
			`service desks: ${desks.length} desks, ${desks.reduce((total, desk) => total + desk.requestTypes.length, 0)} request types, ${desks.reduce((total, desk) => total + desk.queues.length, 0)} queues, ${desks.reduce((total, desk) => total + desk.metrics.length, 0)} SLA metrics, ${dataset.slaCalendars?.length ?? 0} calendars, ${dataset.automationRules?.length ?? 0} automation rules`,
		);
	}
	printCounts(result.counts);
	console.log(formatLocalChanges(result.localChanges, options.overwriteLocal));
	console.log(
		`workflow matches: matched=${result.workflowMatches.matched} ambiguous=${result.workflowMatches.ambiguous} unmatched=${result.workflowMatches.unmatched}`,
	);
	if (result.linksSkipped > 0) {
		console.log(`links skipped: ${result.linksSkipped}`);
	}
	for (const [table, count] of Object.entries(permissionResult.removed)) {
		if (count > 0) console.log(`${table} removed: ${count}`);
	}

	await printAgileImport(client, options.overwriteLocal, options.privateApis);

	if (!options.skipAvatars) {
		const avatars = await importJiraAvatars(client, {
			baseUrl: requiredEnv("JIRA_URL"),
			avatarsDir: importerEnv.AVATARS_DIR,
		});
		console.log("jira avatars:");
		printAvatarCounts(avatars);
	}
}

async function importJiraAvatarsOnly() {
	const client = new JiraClient({
		baseUrl: requiredEnv("JIRA_URL"),
		token: requiredEnv("JIRA_PAT"),
	});
	const counts = await importJiraAvatars(client, {
		baseUrl: requiredEnv("JIRA_URL"),
		avatarsDir: importerEnv.AVATARS_DIR,
	});
	console.log("jira avatars:");
	printAvatarCounts(counts);
}

async function importDashboards(privateApis: boolean) {
	if (skipPrivateApi({ privateApis }, "dashboards")) return;
	const client = new JiraClient({
		baseUrl: requiredEnv("JIRA_URL"),
		token: requiredEnv("JIRA_PAT"),
	});
	const dataset = await fetchDashboardDataset(client, { privateApis });
	const result = await importDashboardDataset(dataset);

	console.log(
		`dashboards: ${dataset.dashboards.length} dashboards, ${dataset.dashboards.reduce((total, dashboard) => total + dashboard.gadgets.length, 0)} gadgets, ${dataset.filters.length} saved filters`,
	);
	printCounts(result);
	const shares = summarizeFilterShares(dataset.filters);
	console.log(
		`filter shares: ${shares.filters} filters: ${shares.everyone} with everyone, ${shares.project} project, ${shares.projectRole} project role (shared with the project), ${shares.group} group, ${shares.ownerOnly} owner only, ${shares.ignored} share entries without an equivalent; dashboards import private to their owner except the System Dashboard`,
	);
}

async function importJiraPermissions(options: { projectKeys?: string[] }) {
	const client = new JiraClient({
		baseUrl: requiredEnv("JIRA_URL"),
		token: requiredEnv("JIRA_PAT"),
	});
	const projectRows = await pool.query<{ key: string }>(
		"select key from projects order by key",
	);
	const projectKeys =
		options.projectKeys && options.projectKeys.length > 0
			? options.projectKeys
			: projectRows.rows.map((row) => row.key);
	if (projectKeys.length === 0) {
		throw new Error("No projects have been imported yet");
	}
	const result = await importPermissions(client, {
		projectKeys,
		fullImport: !options.projectKeys || options.projectKeys.length === 0,
	});
	console.log(
		`jira permissions import: ${projectKeys.length} projects, ${result.report.join("; ")}`,
	);
	printCounts(result.counts);
	for (const [table, count] of Object.entries(result.removed)) {
		if (count > 0) console.log(`${table} removed: ${count}`);
	}
}

async function importConfluenceGroupsAndReport(client: ConfluenceClient) {
	const result = await importConfluenceGroups(client);
	console.log(
		`confluence groups: ${result.referenced} referenced by space permissions or page restrictions, ${result.missingInConfluence} missing in Confluence, ${result.memberships} memberships added, ${result.removed} removed, ${result.membersWithoutUser} members without a local user`,
	);
}

async function importConfluenceGroupsOnly() {
	await importConfluenceGroupsAndReport(
		new ConfluenceClient({
			baseUrl: requiredEnv("CONFLUENCE_URL"),
			token: requiredEnv("CONFLUENCE_PAT"),
		}),
	);
}

async function importConfluence(options: {
	spaceKeys?: string[];
	skipAttachments: boolean;
	skipAvatars: boolean;
	overwriteLocal: boolean;
	privateApis: boolean;
}) {
	const baseUrl = requiredEnv("CONFLUENCE_URL");
	const client = new ConfluenceClient({
		baseUrl,
		token: requiredEnv("CONFLUENCE_PAT"),
	});
	const dataset = await fetchWikiDataset(client, {
		attachmentsDir: importerEnv.ATTACHMENTS_DIR,
		skipAttachments: options.skipAttachments,
		spaceKeys: options.spaceKeys,
		privateApis: options.privateApis,
		existingAttachments: options.skipAttachments
			? undefined
			: await loadWikiAttachmentIndex(),
	});
	const pages = dataset.spaces.reduce(
		(total, space) => total + space.pages.length,
		0,
	);
	const result = await importWikiDataset(dataset, {
		baseUrl,
		releaseSpaces: true,
		overwriteLocal: options.overwriteLocal,
		privateApis: options.privateApis,
	});
	await importConfluenceGroupsAndReport(client);

	console.log(
		`confluence import: ${pages} content items from ${dataset.spaces.length} spaces`,
	);
	const skippedPermissions = [...dataset.skippedPermissions.entries()].sort(
		([left], [right]) => left.localeCompare(right),
	);
	const skippedTotal = skippedPermissions.reduce(
		(total, [, count]) => total + count,
		0,
	);
	console.log(
		`confluence space permissions skipped: ${skippedTotal}${
			skippedPermissions.length > 0
				? ` (${skippedPermissions.map(([key, count]) => `${key}=${count}`).join(", ")})`
				: ""
		}`,
	);
	printCounts(result.counts);
	console.log(formatLocalChanges(result.localChanges, options.overwriteLocal));
	console.log(
		`confluence watchers/likes: unknown users page=${result.social.unknownPageWatchers} space=${result.social.unknownSpaceWatchers} likes=${result.social.unknownLikes}`,
	);
	const macros = [...dataset.macros.entries()].sort(
		(left, right) => right[1].size - left[1].size,
	);
	console.log("macros:");
	for (const [name, macroPages] of macros) {
		console.log(`  ${name}: ${macroPages.size}`);
	}

	if (!options.skipAvatars) {
		const avatars = await importConfluenceAvatars(client, {
			baseUrl,
			avatarsDir: importerEnv.AVATARS_DIR,
		});
		console.log("confluence avatars:");
		printAvatarCounts(avatars);
	}
}

async function importConfluenceAvatarsOnly() {
	const baseUrl = requiredEnv("CONFLUENCE_URL");
	const client = new ConfluenceClient({
		baseUrl,
		token: requiredEnv("CONFLUENCE_PAT"),
	});
	const counts = await importConfluenceAvatars(client, {
		baseUrl,
		avatarsDir: importerEnv.AVATARS_DIR,
	});
	console.log("confluence avatars:");
	printAvatarCounts(counts);
}

async function printAgileImport(
	client: JiraClient,
	overwriteLocal = false,
	privateApis = false,
) {
	const { importJiraAgile } = await import("./agile-remote.ts");
	const result = await importJiraAgile(client, undefined, {
		overwriteLocal,
		privateApis,
	});
	console.log(
		`jira agile import: ${result.boards} boards, ${result.sprints.active} active + ${result.sprints.closed} closed + ${result.sprints.future} future sprints, ${result.issueSprints} issue-sprint rows for ${result.issues} issues`,
	);
	printCounts(result.counts);
}

async function importAgileRemote(overwriteLocal = false, privateApis = false) {
	const client = new JiraClient({
		baseUrl: requiredEnv("JIRA_URL"),
		token: requiredEnv("JIRA_PAT"),
	});
	await printAgileImport(client, overwriteLocal, privateApis);
}

async function importAgile() {
	const counts = await importAgileLocal(db);
	console.log(
		`jira agile import: ${counts.boards} boards, ${counts.sprints.active} active + ${counts.sprints.closed} closed + ${counts.sprints.future} future sprints, ${counts.issueSprints} issue-sprint rows for ${counts.issues} issues`,
	);
}

async function main() {
	const options = parseCli(process.argv.slice(2));

	if (options.command === "parity") {
		const tables = await loadTableSet(pool);
		const required =
			options.scope === "jira"
				? ["projects"]
				: options.scope === "confluence"
					? ["spaces"]
					: ["projects", "spaces"];
		const missing = required.filter((table) => !tables.has(table));
		if (missing.length > 0) {
			throw new Error(
				`database schema is missing tables (${missing.join(", ")}); run the import or the migrations first`,
			);
		}
		await runParityCommand({
			scope: options.scope,
			json: options.json,
			skipHash: options.skipHash,
			privateApis: options.privateApis,
			appUrl: options.appUrl,
			appToken: options.appToken,
			attachmentsDir: importerEnv.ATTACHMENTS_DIR,
			pool,
			jira:
				options.scope === "confluence"
					? undefined
					: {
							baseUrl: requiredEnv("JIRA_URL"),
							token: requiredEnv("JIRA_PAT"),
						},
			confluence:
				options.scope === "jira"
					? undefined
					: {
							baseUrl: requiredEnv("CONFLUENCE_URL"),
							token: requiredEnv("CONFLUENCE_PAT"),
						},
		});
		return;
	}

	const started = performance.now();
	await runMigrations();

	if (options.command === "jira") {
		await importJira(options);
	} else if (options.command === "jira-avatars") {
		await importJiraAvatarsOnly();
	} else if (options.command === "jira-agile") {
		await importAgileRemote(options.overwriteLocal, options.privateApis);
	} else if (options.command === "jira-dashboards") {
		await importDashboards(options.privateApis);
	} else if (options.command === "jira-permissions") {
		await importJiraPermissions(options);
	} else if (options.command === "confluence") {
		await importConfluence(options);
	} else if (options.command === "confluence-groups") {
		await importConfluenceGroupsOnly();
	} else if (options.command === "confluence-avatars") {
		await importConfluenceAvatarsOnly();
	} else if (options.command === "jira-agile-local") {
		await importAgile();
	} else {
		throw new Error(usage);
	}

	console.log(
		`wall clock: ${((performance.now() - started) / 1000).toFixed(1)}s`,
	);
}

try {
	await main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	if (process.argv.includes("--json")) {
		console.log(JSON.stringify({ ok: false, error: message }, null, 2));
	} else {
		console.error(message);
	}
	process.exitCode = parityCommand ? 2 : 1;
} finally {
	await pool.end();
}
