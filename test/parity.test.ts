import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ConfluenceClient } from "../src/importer/confluence.ts";
import { JiraClient } from "../src/importer/jira.ts";
import {
	loadJiraSnapshot,
	loadTableSet,
	loadWikiSnapshot,
} from "../src/importer/parity/database.ts";
import { jiraChecks } from "../src/importer/parity/jira-checks.ts";
import {
	fetchWikiLive,
	spacePermissions,
} from "../src/importer/parity/live-confluence.ts";
import { fetchJiraLive } from "../src/importer/parity/live-jira.ts";
import { formatReport } from "../src/importer/parity/run.ts";
import type {
	JiraDatabaseSnapshot,
	JiraLiveSnapshot,
	ParityReport,
	TableSet,
	WikiDatabaseSnapshot,
	WikiLiveSnapshot,
} from "../src/importer/parity/types.ts";
import {
	buildOldUrlPaths,
	requestOldUrls,
} from "../src/importer/parity/urls.ts";
import { wikiChecks } from "../src/importer/parity/wiki-checks.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { boards, issueSprints, sprints } from "../src/lib/server/schema.ts";

const projectKey = "PARITYT";
const spaceKey = "PARITY";
const username = "parity_test_user";
const boardSourceId = "parity-test-board";
const sprintSourceId = "parity-test-sprint";
const rapidViewId = 987654;
const metadata = {
	issueType: "parity-test-issue-type",
	status: "parity-test-status",
	priority: "parity-test-priority",
	resolution: "parity-test-resolution",
	linkType: "parity-test-link-type",
	workflow: "parity-test-workflow",
};

let projectId = "";
let spaceId = "";
let pageId = "";

async function cleanup() {
	await db.delete(boards).where(eq(boards.sourceId, boardSourceId));
	await pool.query("delete from projects where key = $1", [projectKey]);
	await pool.query("delete from workflows where name = $1", [
		metadata.workflow,
	]);
	await pool.query("delete from spaces where key = $1", [spaceKey]);
	await pool.query("delete from users where username = $1", [username]);
	await pool.query("delete from issue_types where source_id = $1", [
		metadata.issueType,
	]);
	await pool.query("delete from statuses where source_id = $1", [
		metadata.status,
	]);
	await pool.query("delete from priorities where source_id = $1", [
		metadata.priority,
	]);
	await pool.query("delete from resolutions where source_id = $1", [
		metadata.resolution,
	]);
	await pool.query("delete from link_types where source_id = $1", [
		metadata.linkType,
	]);
}

beforeAll(async () => {
	await runMigrations();
	await cleanup();
	const user = await pool.query<{ id: string }>(
		`insert into users (source_key, username, display_name, active)
		 values ($1, $2, $3, true) returning id`,
		["parity-test-user", username, "Parity Test User"],
	);
	const issueType = await pool.query<{ id: string }>(
		`insert into issue_types (source_id, name) values ($1, $2) returning id`,
		[metadata.issueType, "Parity Type"],
	);
	const status = await pool.query<{ id: string }>(
		`insert into statuses (source_id, name, category) values ($1, $2, 'new') returning id`,
		[metadata.status, "Parity Status"],
	);
	const priority = await pool.query<{ id: string }>(
		`insert into priorities (source_id, name) values ($1, $2) returning id`,
		[metadata.priority, "Parity Priority"],
	);
	const resolution = await pool.query<{ id: string }>(
		`insert into resolutions (source_id, name) values ($1, $2) returning id`,
		[metadata.resolution, "Parity Resolution"],
	);
	await pool.query(
		`insert into link_types (source_id, name, inward, outward) values ($1, $2, $3, $4)`,
		[metadata.linkType, "Parity Link", "is linked by", "links"],
	);
	const project = await pool.query<{ id: string }>(
		`insert into projects (source_id, key, name, project_type)
		 values ($1, $2, $3, 'software') returning id`,
		["parity-test-project", projectKey, "Parity Project"],
	);
	projectId = project.rows[0]?.id ?? "";
	const workflow = await pool.query<{ id: string }>(
		`insert into workflows (source_id, name) values ($1, $2) returning id`,
		["parity-test-workflow", metadata.workflow],
	);
	await pool.query(
		`insert into workflow_statuses (source_id, workflow_id, status_id)
		 values ($1, $2, $3)`,
		["parity-test-workflow-status", workflow.rows[0]?.id, status.rows[0]?.id],
	);
	await pool.query(
		`insert into workflow_transitions
		 (source_id, workflow_id, name, from_status_id, to_status_id, asks_resolution, sequence)
		 values ($1, $2, 'Parity Resolve', $3, $3, true, 0),
		        ($4, $2, 'Parity Reopen', $3, $3, false, 1)`,
		[
			"parity-test-transition",
			workflow.rows[0]?.id,
			status.rows[0]?.id,
			"parity-test-transition-other",
		],
	);
	await pool.query(
		`insert into project_workflows (source_id, project_id, issue_type_id, workflow_id)
		 values ($1, $2, null, $3)`,
		["parity-test-project-workflow", projectId, workflow.rows[0]?.id],
	);
	const issue = await pool.query<{ id: string }>(
		`insert into issues (source_id, project_id, number, key, type_id, status_id, priority_id, resolution_id, assignee_id, summary, updated)
		 values ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
		[
			"parity-test-issue",
			projectId,
			`${projectKey}-1`,
			issueType.rows[0]?.id,
			status.rows[0]?.id,
			priority.rows[0]?.id,
			resolution.rows[0]?.id,
			user.rows[0]?.id,
			"Parity issue summary",
			"2026-01-02T03:04:05.000Z",
		],
	);
	const [board] = await db
		.insert(boards)
		.values({
			rapidViewId,
			sourceId: boardSourceId,
			name: "Parity Board",
			type: "scrum",
			filterJql: `project = ${projectKey}`,
			projectId,
		})
		.returning({ id: boards.id });
	const [sprint] = await db
		.insert(sprints)
		.values({
			sourceId: sprintSourceId,
			boardId: board?.id ?? "",
			name: "Parity Sprint",
			state: "active",
		})
		.returning({ id: sprints.id });
	await db.insert(issueSprints).values({
		issueId: issue.rows[0]?.id ?? "",
		sprintId: sprint?.id ?? "",
		isOpen: true,
	});
	await pool.query(
		`insert into attachments (source_id, issue_id, file_name, size, storage_path, sha256)
		 select $1, issue.id, $2, 0, $3, $4 from issues issue where issue.key = $5`,
		[
			"parity-test-attachment",
			"parity-test.txt",
			"parity-test/attachment",
			"0".repeat(64),
			`${projectKey}-1`,
		],
	);

	const space = await pool.query<{ id: string }>(
		`insert into spaces (source_id, key, name) values ($1, $2, $3) returning id`,
		["parity-test-space", spaceKey, "Parity Space"],
	);
	spaceId = space.rows[0]?.id ?? "";
	const page = await pool.query<{ id: string }>(
		`insert into pages (source_id, space_id, title, type, status, version_number, position)
		 values ($1, $2, $3, 'page', 'current', 1, 0) returning id`,
		["parity-test-page", spaceId, "Parity Page"],
	);
	pageId = page.rows[0]?.id ?? "";
	await pool.query(
		`insert into page_versions (source_id, page_id, number, title)
		 values ($1, $2, 1, $3)`,
		["parity-test-page@1", pageId, "Parity Page"],
	);
	await pool.query(
		`insert into page_comments (source_id, page_id, inline, body_storage)
		 values ($1, $2, false, $3), ($4, $2, true, $5)`,
		[
			"parity-test-comment-page",
			pageId,
			"Parity page comment body",
			"parity-test-comment-inline",
			"Parity inline comment body",
		],
	);
	await pool.query(
		`insert into page_attachments (source_id, page_id, file_name, size, version, storage_path, sha256)
		 values ($1, $2, $3, 0, 1, $4, $5)`,
		[
			"parity-test-page-attachment:1",
			pageId,
			"parity-test-page.txt",
			"parity-test/page-attachment",
			"0".repeat(64),
		],
	);
	await pool.query(
		`insert into page_labels (source_id, page_id, label)
		 values ($1, $2, $3)`,
		["parity-test-label", pageId, "parity"],
	);
	await pool.query(
		`insert into page_restrictions (source_id, page_id, operation, group_name)
		 values ($1, $2, 'read', $3)`,
		["parity-test-restriction", pageId, "parity-group"],
	);
	await pool.query(
		`insert into space_permissions (source_id, space_id, permission, anonymous)
		 values ($1, $2, 'read', true)`,
		["parity-test-permission", spaceId],
	);
});

afterAll(async () => {
	await cleanup();
});

function liveJiraFromDatabase(
	database: JiraDatabaseSnapshot,
): JiraLiveSnapshot {
	const statusesByIssueType = new Map<string, string[]>();
	for (const workflow of database.projectWorkflows) {
		statusesByIssueType.set(
			workflow.issueTypeSourceId ?? metadata.issueType,
			workflow.statuses,
		);
	}
	return {
		projects: database.projects.map((key) => ({
			key,
			issueTotal: [...database.issues.values()].filter(
				(item) => item.projectKey === key,
			).length,
			versions: database.versionsByProject.get(key) ?? [],
			components: database.componentsByProject.get(key) ?? [],
			statusesByIssueType,
		})),
		issues: new Map(
			[...database.issues.entries()].map(([key, issue]) => [key, { ...issue }]),
		),
		users: database.users,
		issueTypes: database.issueTypes,
		statuses: database.statuses,
		priorities: database.priorities,
		resolutions: database.resolutions,
		linkTypes: database.linkTypes,
		workflowResolutionTransitions: new Map(
			[...(database.workflowResolutionTransitions ?? new Map())].map(
				([name, transitions]) => [name, [...transitions]],
			),
		),
		serviceDesks: null,
		agile: database.agile
			? {
					boards: database.agile.boards.map((board) => ({
						id: board.id,
						sprints: board.sprints.map((sprint) => ({ ...sprint })),
					})),
				}
			: null,
		filters: database.filters
			? database.filters.map((filter) => ({ ...filter }))
			: null,
	};
}

function liveWikiFromDatabase(
	database: WikiDatabaseSnapshot,
): WikiLiveSnapshot {
	const pages = new Map(
		[...database.pages.entries()].map(([key, page]) => [
			key,
			{
				...page,
				created: null,
				labels: database.labels.get(key) ?? [],
				restrictions: database.restrictions.get(key) ?? [],
			},
		]),
	);
	const attachmentSample = [...database.attachments.values()]
		.flat()
		.map((attachment) => ({
			sourceId: attachment.sourceId,
			pageSourceId:
				[...database.attachments.entries()].find(([, list]) =>
					list.includes(attachment),
				)?.[0] ?? "",
			size: attachment.size,
			sha256: attachment.sha256,
		}));
	return {
		spaces: database.spaces,
		pages,
		versions: new Map(database.versions),
		comments: new Map(database.comments),
		attachments: new Map(database.attachments),
		attachmentSample,
		permissions: new Map(database.permissions),
		tree: new Map(database.tree),
		pageWatchers: new Map(database.pageWatchers),
		spaceWatchers: new Map(database.spaceWatchers),
		pageLikes: new Map(database.pageLikes),
	};
}

function allTables(): TableSet {
	return {
		has: () => true,
		columns: () => new Set(),
		hasColumns: () => true,
	};
}

describe("parity checks", () => {
	test("jira checks are OK on the seeded database and name a changed issue", async () => {
		const tables = await loadTableSet(pool);
		const database = await loadJiraSnapshot(pool, tables, {
			projectKeys: [projectKey],
		});
		const live = liveJiraFromDatabase(database);
		const result = jiraChecks(live, database);
		for (const check of result.checks) {
			if (check.status === "MISMATCH") {
				expect.fail(`${check.name} was not OK: ${check.details.join(",")}`);
			}
		}
		const agileBoard = database.agile?.boards.find(
			(board) => board.id === boardSourceId,
		);
		expect(agileBoard).toEqual({
			id: boardSourceId,
			sprints: [{ id: sprintSourceId, state: "active", issueCount: 1 }],
		});
		for (const name of [
			"jira.agile.boards",
			"jira.agile.sprints",
			"jira.agile.sprint_issues",
		]) {
			const agileCheck = result.checks.find((check) => check.name === name);
			expect(agileCheck?.status).toBe("OK");
			expect(agileCheck?.live).toBe(agileCheck?.database);
		}
		const filterCheck = result.checks.find(
			(check) => check.name === "jira.filters",
		);
		expect(filterCheck?.status).toBe("OK");
		expect(result.watermark).toBe("2026-01-02T03:04:05.000Z");
		expect(result.changedSinceImport).toEqual([]);

		const issue = live.issues.get(`${projectKey}-1`);
		if (!issue) throw new Error("seeded issue was not loaded");
		issue.comments = 1;
		issue.status = "changed-status";
		issue.updated = "2026-02-03T04:05:06.000Z";
		const changed = jiraChecks(live, database);
		const comments = changed.checks.find(
			(check) => check.name === "jira.issue.comments",
		);
		expect(comments?.status).toBe("MISMATCH");
		expect(comments?.details).toContain(`${projectKey}-1`);
		const status = changed.checks.find(
			(check) => check.name === "jira.issue.status",
		);
		expect(status?.details).toContain(`${projectKey}-1`);
		const updated = changed.checks.find(
			(check) => check.name === "jira.issue.updated",
		);
		expect(updated?.details).toContain(`${projectKey}-1`);
		expect(changed.changedSinceImport).toContain(`${projectKey}-1`);
	});

	test("attachment bytes above the integer range are reported as a number", async () => {
		const issue = await pool.query<{ id: string }>(
			"select id from issues where key = $1",
			[`${projectKey}-1`],
		);
		const issueId = issue.rows[0]?.id ?? "";
		await pool.query(
			`insert into attachments (source_id, issue_id, file_name, size, storage_path, sha256)
			 values ($1, $2, $3, $4, $5, $6), ($7, $2, $8, $9, $10, $11)`,
			[
				"parity-test-large-attachment",
				issueId,
				"large.bin",
				2_147_483_647,
				"parity-test/large",
				"1".repeat(64),
				"parity-test-small-attachment",
				"small.bin",
				1,
				"parity-test/small",
				"2".repeat(64),
			],
		);
		try {
			const tables = await loadTableSet(pool);
			const database = await loadJiraSnapshot(pool, tables, {
				projectKeys: [projectKey],
			});
			expect(database.issues.get(`${projectKey}-1`)?.attachmentBytes).toBe(
				2_147_483_648,
			);
		} finally {
			await pool.query("delete from attachments where source_id in ($1, $2)", [
				"parity-test-large-attachment",
				"parity-test-small-attachment",
			]);
		}
	});

	test("workflow resolution screens are compared per workflow", async () => {
		const tables = await loadTableSet(pool);
		const database = await loadJiraSnapshot(pool, tables, {
			projectKeys: [projectKey],
		});
		expect(
			database.workflowResolutionTransitions?.get(metadata.workflow),
		).toEqual(["parity-test-transition"]);
		const live = liveJiraFromDatabase(database);
		const status = (snapshot: typeof live) =>
			jiraChecks(snapshot, database).checks.find(
				(check) => check.name === "jira.workflow.resolution_screens",
			);
		expect(status(live)?.status).toBe("OK");
		expect(status(live)?.live).toBe(1);
		expect(status(live)?.database).toBe(1);

		live.workflowResolutionTransitions.set(metadata.workflow, [
			"parity-test-transition-other",
		]);
		const changed = status(live);
		expect(changed?.status).toBe("MISMATCH");
		expect(changed?.details).toContain(
			`${metadata.workflow}:parity-test-transition`,
		);
		expect(changed?.details).toContain(
			`${metadata.workflow}:parity-test-transition-other`,
		);
	});

	test("a private API part that was skipped is not a difference", async () => {
		const tables = await loadTableSet(pool);
		const database = await loadJiraSnapshot(pool, tables, {
			projectKeys: [projectKey],
		});
		const live = liveJiraFromDatabase(database);
		live.workflowResolutionSkipped = true;
		live.workflowResolutionTransitions = new Map();

		const check = jiraChecks(live, database).checks.find(
			(item) => item.name === "jira.workflow.resolution_screens",
		);
		expect(check?.status).toBe("SKIPPED");
		expect(check?.note).toContain("--private-apis");
	});

	test("a sprint shared with another board counts on both boards", async () => {
		const [owner] = await db
			.select({ id: boards.id })
			.from(boards)
			.where(eq(boards.sourceId, boardSourceId));
		const [sprint] = await db
			.select({ id: sprints.id })
			.from(sprints)
			.where(eq(sprints.sourceId, sprintSourceId));
		const second = await pool.query<{ id: string }>(
			`insert into boards (rapid_view_id, source_id, name, type, filter_jql)
			 values ($1, $2, 'Parity Board 2', 'scrum', 'project = X') returning id`,
			[rapidViewId + 1, `${boardSourceId}-2`],
		);
		try {
			expect(owner).toBeDefined();
			await pool.query(
				"insert into board_sprints (board_id, sprint_id) values ($1, $2)",
				[second.rows[0]?.id, sprint?.id],
			);
			const tables = await loadTableSet(pool);
			const database = await loadJiraSnapshot(pool, tables, {
				projectKeys: [projectKey],
			});
			const sprintsOf = (id: string) =>
				database.agile?.boards
					.find((board) => board.id === id)
					?.sprints.map((entry) => entry.id);
			expect(sprintsOf(boardSourceId)).toEqual([sprintSourceId]);
			expect(sprintsOf(`${boardSourceId}-2`)).toEqual([sprintSourceId]);
		} finally {
			await pool.query("delete from boards where source_id = $1", [
				`${boardSourceId}-2`,
			]);
		}
	});

	test("saved filters are compared by name and JQL", async () => {
		const owner = await pool.query<{ id: string }>(
			"select id from users where username = $1",
			[username],
		);
		await pool.query(
			"insert into filters (name, jql, owner_id, source_id) values ($1, $2, $3, $4)",
			[
				"Parity filter",
				"project = PARITYT",
				owner.rows[0]?.id ?? null,
				"parity-test-filter",
			],
		);
		try {
			const tables = await loadTableSet(pool);
			const database = await loadJiraSnapshot(pool, tables, {
				projectKeys: [projectKey],
			});
			const imported = database.filters?.find(
				(filter) => filter.id === "parity-test-filter",
			);
			expect(imported).toEqual({
				id: "parity-test-filter",
				name: "Parity filter",
				jql: "project = PARITYT",
			});
			const live = liveJiraFromDatabase(database);
			const status = (snapshot: typeof live) =>
				jiraChecks(snapshot, database).checks.find(
					(check) => check.name === "jira.filters",
				);
			expect(status(live)?.status).toBe("OK");

			const renamed = {
				...live,
				filters: live.filters?.map((filter) =>
					filter.id === "parity-test-filter"
						? { ...filter, name: "Renamed in Jira" }
						: filter,
				),
			} as typeof live;
			expect(status(renamed)?.status).toBe("MISMATCH");
			expect(status(renamed)?.details).toContain("parity-test-filter");

			const changed = {
				...live,
				filters: live.filters?.map((filter) =>
					filter.id === "parity-test-filter"
						? { ...filter, jql: "project = OTHER" }
						: filter,
				),
			} as typeof live;
			expect(status(changed)?.details).toContain("parity-test-filter");

			const deleted = {
				...live,
				filters: live.filters?.filter(
					(filter) => filter.id !== "parity-test-filter",
				),
			} as typeof live;
			expect(status(deleted)?.details).toContain("parity-test-filter");
		} finally {
			await pool.query("delete from filters where source_id = $1", [
				"parity-test-filter",
			]);
		}
	});

	test("wiki checks are OK on the seeded database and name a changed page", async () => {
		const tables = await loadTableSet(pool);
		const database = await loadWikiSnapshot(pool, tables, {
			spaceKeys: [spaceKey],
		});
		if (!database) throw new Error("seeded wiki was not loaded");
		const live = liveWikiFromDatabase(database);
		const checks = wikiChecks(live, database, allTables());
		for (const check of checks) {
			if (check.status === "MISMATCH") {
				expect.fail(`${check.name} was not OK: ${check.details.join(",")}`);
			}
		}

		live.versions.set("parity-test-page", 2);
		live.comments.set("parity-test-page", { page: 0, inline: 2 });
		const changed = wikiChecks(live, database, allTables());
		const versions = changed.find(
			(check) => check.name === "confluence.versions",
		);
		expect(versions?.status).toBe("MISMATCH");
		expect(versions?.details).toContain("parity-test-page");
		const comments = changed.find(
			(check) => check.name === "confluence.comments.inline",
		);
		expect(comments?.details).toContain("parity-test-page");
	});

	test("watcher and like parity counts imported rows only", async () => {
		const importedUser = await pool.query<{ id: string }>(
			"select id from users where username = $1",
			[username],
		);
		const importedUserId = importedUser.rows[0]?.id ?? "";
		const appUser = await pool.query<{ id: string }>(
			`insert into users (username, display_name) values ($1, $2) returning id`,
			["parity_test_app_user", "Parity App User"],
		);
		const appUserId = appUser.rows[0]?.id ?? "";
		try {
			await pool.query(
				`insert into page_watchers (page_id, user_id, source_id)
				 values ($1, $2, 'parity-test-page-watcher')`,
				[pageId, importedUserId],
			);
			await pool.query(
				`insert into page_watchers (page_id, user_id, source_id)
				 values ($1, $2, null)`,
				[pageId, appUserId],
			);
			await pool.query(
				`insert into space_watchers (space_id, user_id, source_id)
				 values ($1, $2, 'parity-test-space-watcher')`,
				[spaceId, importedUserId],
			);
			await pool.query(
				`insert into page_likes (page_id, user_id, source_id)
				 values ($1, $2, 'parity-test-page-like')`,
				[pageId, importedUserId],
			);
			const tables = await loadTableSet(pool);
			const database = await loadWikiSnapshot(pool, tables, {
				spaceKeys: [spaceKey],
			});
			if (!database) throw new Error("seeded wiki was not loaded");
			expect(database.pageWatchers.get("parity-test-page")).toBe(1);
			expect(database.spaceWatchers.get(spaceKey)).toBe(1);
			expect(database.pageLikes.get("parity-test-page")).toBe(1);
			const live = liveWikiFromDatabase(database);
			const checks = wikiChecks(live, database, allTables());
			for (const name of [
				"wiki.page_watchers",
				"wiki.space_watchers",
				"wiki.page_likes",
			]) {
				const check = checks.find((item) => item.name === name);
				expect(check?.status).toBe("OK");
				expect(check?.live).toBe(check?.database);
			}

			live.pageWatchers.set("parity-test-page", 2);
			live.spaceWatchers.set(spaceKey, 0);
			live.pageLikes.set("parity-test-page", 0);
			const changed = wikiChecks(live, database, allTables());
			expect(
				changed.find((item) => item.name === "wiki.page_watchers")?.status,
			).toBe("MISMATCH");
			expect(
				changed.find((item) => item.name === "wiki.space_watchers")?.details,
			).toContain(spaceKey);
			expect(
				changed.find((item) => item.name === "wiki.page_likes")?.details,
			).toContain("parity-test-page");

			live.watchersSkipped = true;
			live.pageLikesSkipped = true;
			const skipped = wikiChecks(live, database, allTables());
			for (const name of [
				"wiki.page_watchers",
				"wiki.space_watchers",
				"wiki.page_likes",
			]) {
				const check = skipped.find((item) => item.name === name);
				expect(check?.status).toBe("SKIPPED");
				expect(check?.note).toContain("--private-apis");
			}
		} finally {
			await pool.query(
				"delete from page_watchers where user_id = any($1::uuid[])",
				[[importedUserId, appUserId]],
			);
			await pool.query(
				"delete from space_watchers where user_id = any($1::uuid[])",
				[[importedUserId, appUserId]],
			);
			await pool.query(
				"delete from page_likes where user_id = any($1::uuid[])",
				[[importedUserId, appUserId]],
			);
			await pool.query("delete from users where id = $1", [appUserId]);
		}
	});

	test("space permission mapping skips comment and attachment rights", () => {
		const key = "PARITYPERM";
		const mapped = spacePermissions(
			[
				{
					operation: { targetType: "comment", operationKey: "delete" },
					subject: { type: "group", name: "comment-only" },
				},
				{
					operation: { targetType: "page", operationKey: "delete" },
					subject: { type: "group", name: "page-delete" },
				},
				{
					operation: { targetType: "space", operationKey: "read" },
					subject: { type: "group", name: "readers" },
				},
			],
			new Map(),
		);
		expect(mapped.sort()).toEqual([
			"delete:group:page-delete",
			"read:group:readers",
		]);

		const live: WikiLiveSnapshot = {
			spaces: [{ key, sourceId: "1", status: "current" }],
			pages: new Map(),
			versions: new Map(),
			comments: new Map(),
			attachments: new Map(),
			attachmentSample: [],
			permissions: new Map([[key, mapped]]),
			tree: new Map(),
			pageWatchers: new Map(),
			spaceWatchers: new Map(),
			pageLikes: new Map(),
		};
		const database: WikiDatabaseSnapshot = {
			spaces: [{ key, sourceId: "1", status: "current" }],
			pages: new Map(),
			versions: new Map(),
			comments: new Map(),
			attachments: new Map(),
			labels: new Map(),
			restrictions: new Map(),
			permissions: new Map([[key, [...mapped, "delete:group:comment-only"]]]),
			tree: new Map(),
			pageWatchers: new Map(),
			spaceWatchers: new Map(),
			pageLikes: new Map(),
		};
		const wrong = wikiChecks(live, database, allTables()).find(
			(check) => check.name === `confluence.space.${key}.permissions`,
		);
		expect(wrong?.status).toBe("MISMATCH");
		expect(wrong?.details).toContain("delete:group:comment-only");

		const right = wikiChecks(
			live,
			{ ...database, permissions: new Map([[key, mapped]]) },
			allTables(),
		).find((check) => check.name === `confluence.space.${key}.permissions`);
		expect(right?.status).toBe("OK");
	});

	test("table detection skips optional checks on a database without those tables", () => {
		const tables: TableSet = {
			has: (table) => table === "spaces" || table === "pages",
			columns: () => new Set(),
			hasColumns: () => false,
		};
		const database: WikiDatabaseSnapshot = {
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
		const live: WikiLiveSnapshot = {
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
		const checks = wikiChecks(live, database, tables);
		const skipped = checks.filter((check) => check.status === "SKIPPED");
		expect(skipped.map((check) => check.name)).toContain("confluence.versions");
		expect(skipped.map((check) => check.name)).toContain("confluence.comments");
		expect(skipped.map((check) => check.name)).toContain(
			"confluence.permissions",
		);
		for (const check of skipped) {
			expect(check.note).toBeTruthy();
		}
	});

	test("live fetches only issue GET requests", async () => {
		const calls: string[] = [];
		const jiraFetch = (async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			calls.push(init?.method ?? "GET");
			const url = new URL(String(input));
			const path = url.pathname;
			if (path === "/rest/api/2/project") {
				return new Response(JSON.stringify([{ id: "1", key: "P" }]));
			}
			if (path === "/rest/api/2/issuetype") {
				return new Response(JSON.stringify([{ id: "100" }]));
			}
			if (path === "/rest/api/2/status") {
				return new Response(JSON.stringify([{ id: "1" }]));
			}
			if (path === "/rest/api/2/priority") {
				return new Response(JSON.stringify([{ id: "2" }]));
			}
			if (path === "/rest/api/2/resolution") {
				return new Response(JSON.stringify([{ id: "3" }]));
			}
			if (path === "/rest/api/2/issueLinkType") {
				return new Response(JSON.stringify({ issueLinkTypes: [{ id: "4" }] }));
			}
			if (path === "/rest/api/2/workflow") {
				return new Response(JSON.stringify([{ name: "Parity Workflow" }]));
			}
			if (path === "/rest/workflowDesigner/1.0/workflows") {
				return new Response(
					JSON.stringify({
						layout: {
							statuses: [],
							transitions: [
								{
									id: "parity-transition",
									name: "Parity Transition",
									sourceId: "1",
									targetId: "1",
									screenId: 77,
								},
							],
						},
					}),
				);
			}
			if (path === "/rest/api/2/screens/77/tabs") {
				return new Response(JSON.stringify([{ id: 1 }]));
			}
			if (path === "/rest/api/2/screens/77/tabs/1/fields") {
				return new Response(JSON.stringify([{ id: "resolution" }]));
			}
			if (path === "/rest/api/2/user/search") {
				return new Response("[]");
			}
			if (path.endsWith("/statuses")) {
				return new Response(
					JSON.stringify([{ id: "100", statuses: [{ id: "1" }] }]),
				);
			}
			if (path.endsWith("/versions") || path.endsWith("/components")) {
				return new Response("[]");
			}
			if (path === "/rest/api/2/search") {
				const maxResults = url.searchParams.get("maxResults");
				return new Response(
					JSON.stringify(
						maxResults === "0" ? { total: 0 } : { total: 0, issues: [] },
					),
				);
			}
			if (path === "/rest/agile/1.0/board") {
				return new Response(JSON.stringify({ values: [], isLast: true }));
			}
			return new Response("{}", { status: 404 });
		}) as typeof fetch;
		const jiraClient = new JiraClient({
			baseUrl: "https://jira.example.test",
			token: "token",
			fetchImpl: jiraFetch,
		});
		const live = await fetchJiraLive(jiraClient, {
			privateApis: true,
			serviceDesks: false,
			agile: false,
			boardsOnly: true,
			filters: false,
		});
		expect(live.workflowResolutionSkipped).toBe(false);
		expect(live.workflowResolutionTransitions.get("Parity Workflow")).toEqual([
			"parity-transition",
		]);
		expect(calls.length).toBeGreaterThan(0);
		expect(new Set(calls)).toEqual(new Set(["GET"]));

		const confluenceFetch = (async (
			_input: string | URL | Request,
			init?: RequestInit,
		) => {
			calls.push(init?.method ?? "GET");
			return new Response(JSON.stringify({ results: [] }));
		}) as typeof fetch;
		const confluenceClient = new ConfluenceClient({
			baseUrl: "https://confluence.example.test",
			token: "token",
			fetchImpl: confluenceFetch,
		});
		await fetchWikiLive(confluenceClient, { privateApis: true });
		expect(new Set(calls)).toEqual(new Set(["GET"]));
	});

	test("old URL requests follow same-origin redirects and report status", async () => {
		const methods: string[] = [];
		const fetchImpl = (async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			methods.push(init?.method ?? "GET");
			const url = new URL(String(input));
			if (url.pathname === "/browse/A-1") {
				return new Response(null, {
					status: 302,
					headers: { location: "/browse/A-2" },
				});
			}
			if (url.pathname === "/browse/A-2") {
				return new Response("ok", { status: 200 });
			}
			return new Response("missing", { status: 404 });
		}) as typeof fetch;
		const result = await requestOldUrls(
			[
				{ path: "/browse/A-1", status: null, chain: [], ok: null },
				{ path: "/missing", status: null, chain: [], ok: null },
			],
			"https://app.example.test",
			"token",
			fetchImpl,
		);
		expect(result.requests).toBe(3);
		expect(result.urls[0]?.ok).toBe(true);
		expect(result.urls[0]?.chain).toEqual([302, 200]);
		expect(result.urls[1]?.ok).toBe(false);
		expect(result.urls[1]?.status).toBe(404);
		expect(new Set(methods)).toEqual(new Set(["GET"]));
	});

	test("old URL requests keep the app token on the app origin only", async () => {
		const seen: { url: string; authorization: string | null }[] = [];
		const fetchImpl = (async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			const url = new URL(String(input));
			seen.push({
				url: url.href,
				authorization: new Headers(init?.headers).get("authorization"),
			});
			return new Response("ok", { status: 200 });
		}) as typeof fetch;
		const result = await requestOldUrls(
			[
				{ path: "/browse/DEMO-1", status: null, chain: [], ok: null },
				{
					path: "https://evil.example/x",
					status: null,
					chain: [],
					ok: null,
				},
				{ path: "//evil.example/y", status: null, chain: [], ok: null },
			],
			"https://app.example.test",
			"app-token",
			fetchImpl,
		);
		expect(result.urls.every((url) => url.ok)).toBe(true);
		expect(seen[0]?.authorization).toBe("Bearer app-token");
		expect(seen.slice(1).map((request) => request.authorization)).toEqual([
			null,
			null,
		]);
	});

	test("old URL selection is deterministic and bounded", () => {
		const issues = new Map(
			Array.from({ length: 30 }, (_, index) => [
				`P-${index + 1}`,
				{
					key: `P-${index + 1}`,
					number: index + 1,
					projectKey: index < 15 ? "P" : "Q",
					status: "1",
					resolution: null,
					assignee: null,
					updated: null,
					comments: 0,
					worklogs: 0,
					attachments: 0,
					attachmentBytes: 0,
					links: 0,
					watchers: 0,
					subtasks: 0,
					history: 0,
				},
			]),
		);
		const pages = new Map(
			Array.from({ length: 30 }, (_, index) => [
				String(index + 1),
				{
					sourceId: String(index + 1),
					spaceKey: index < 15 ? "S" : "T",
					status: "current" as const,
					type: "page" as const,
					parentSourceId: null,
					position: index,
					title: `Page ${index + 1}`,
				},
			]),
		);
		const paths = buildOldUrlPaths(
			{
				projects: ["P", "Q"],
				issues,
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
			},
			{
				spaces: [],
				pages,
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
			},
			{ boards: [{ id: "1", sprints: [] }] },
		);
		expect(
			paths.filter((item) => item.path.startsWith("/browse/")),
		).toHaveLength(20);
		expect(
			paths.filter((item) => item.path.includes("rapidView")),
		).toHaveLength(1);
		expect(
			paths.filter((item) => item.path.startsWith("/pages/")),
		).toHaveLength(20);
		expect(paths.every((item) => !item.path.includes("Page 1"))).toBe(true);
	});

	test("the report never contains seeded titles or bodies", () => {
		const database: WikiDatabaseSnapshot = {
			spaces: [{ key: spaceKey, sourceId: "1", status: "current" }],
			pages: new Map([
				[
					"10",
					{
						sourceId: "10",
						spaceKey,
						status: "current",
						type: "page",
						parentSourceId: null,
						position: 0,
						title: "Secret Page Title",
					},
				],
			]),
			versions: new Map(),
			comments: new Map(),
			attachments: new Map(),
			labels: new Map(),
			restrictions: new Map(),
			permissions: new Map(),
			tree: new Map([["10", { parentSourceId: null, position: 0 }]]),
			pageWatchers: new Map(),
			spaceWatchers: new Map(),
			pageLikes: new Map(),
		};
		const oldUrls = buildOldUrlPaths(null, database, null);
		const report: ParityReport = {
			scope: "confluence",
			checks: [
				{
					name: "confluence.spaces",
					live: 1,
					database: 1,
					status: "OK",
					details: [],
				},
			],
			watermark: null,
			changedSinceImport: { count: 0, issues: [] },
			oldUrls,
			requests: { jira: 0, confluence: 0, app: 0 },
			wallClockSeconds: 0,
			notes: [],
			ok: true,
		};
		const text = formatReport(report);
		expect(text).not.toContain("Secret Page Title");
		expect(text).not.toContain("Parity page comment body");
		expect(text).toContain("/display/PARITY/");
		expect(JSON.stringify(report)).not.toContain("Secret Page Title");
	});
});
