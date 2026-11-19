import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/importer/db.ts";
import { importDataset } from "../src/importer/import.ts";
import {
	loadTableSet,
	loadWikiSnapshot,
} from "../src/importer/parity/database.ts";
import { wikiChecks } from "../src/importer/parity/wiki-checks.ts";
import { formatLocalChanges, upsertRows } from "../src/importer/upsert.ts";
import { importWikiDataset } from "../src/importer/wiki-import.ts";
import { issues } from "../src/lib/server/schema.ts";
import {
	fixtureBaseUrl,
	fixtureDataset,
	fixtureProjectKey,
} from "./fixtures/jira.ts";
import { wikiFixture } from "./fixtures/wiki.ts";

const baseUrl = "https://confluence.example.test";

async function cleanup() {
	await pool.query("delete from spaces where key = any($1::text[])", [
		["FIX", "~alice"],
	]);
	await pool.query("delete from projects where key = $1", [fixtureProjectKey]);
	await pool.query("delete from workflows where name = $1", [
		"Fixture Workflow",
	]);
	await pool.query("delete from issue_types where source_id like 'fixture-%'");
	await pool.query("delete from statuses where source_id like 'fixture-%'");
	await pool.query("delete from priorities where source_id like 'fixture-%'");
	await pool.query("delete from resolutions where source_id like 'fixture-%'");
	await pool.query("delete from link_types where source_id like 'fixture-%'");
	await pool.query(
		"delete from fields where source_id like 'customfield_99%' or source_id like 'customfield_2000%'",
	);
	await pool.query("delete from users where username like 'fixture_%'");
}

async function page(sourceId: string) {
	const {
		rows: [row],
	} = await pool.query<{ id: string; title: string }>(
		"select id, title from pages where source_id = $1",
		[sourceId],
	);
	if (!row) throw new Error(`page ${sourceId} missing`);
	return row;
}

async function issue(key: string) {
	const {
		rows: [row],
	} = await pool.query<{
		id: string;
		source_id: string;
		summary: string;
		status_id: string;
		locally_changed_at: string | null;
	}>(
		"select id, source_id, summary, status_id, locally_changed_at from issues where key = $1",
		[key],
	);
	if (!row) throw new Error(`issue ${key} missing`);
	return row;
}

async function importWiki(overwriteLocal = false) {
	return importWikiDataset(wikiFixture(), { baseUrl, overwriteLocal });
}

async function importJira(overwriteLocal = false) {
	return importDataset(fixtureDataset(), {
		baseUrl: fixtureBaseUrl,
		fullImport: true,
		overwriteLocal,
	});
}

beforeAll(async () => {
	await runMigrations();
	await cleanup();
	await importWiki();
	await importJira();
});

afterAll(async () => {
	await cleanup();
	await pool.end();
});

describe("local changes survive an import", () => {
	test("a body_doc-only conversion is not a local change", async () => {
		const child = await page("101");
		await pool.query(
			'update pages set body_doc = \'{"type":"doc"}\'::jsonb where id = $1',
			[child.id],
		);
		const { rows } = await pool.query<{ locally_changed_at: string | null }>(
			"select locally_changed_at from pages where id = $1",
			[child.id],
		);
		expect(rows[0]?.locally_changed_at).toBeNull();
	});

	test("a page with a local version keeps its content and is listed", async () => {
		const home = await page("100");
		await pool.query(
			`insert into page_versions (source_id, page_id, number, title, body_html)
			 values ($1, $2, 3, 'Local title', '<p>local</p>')`,
			[`fat:${randomUUID()}`, home.id],
		);
		await pool.query(
			"update pages set title = 'Local title', version_number = 3, body_html = '<p>local</p>' where id = $1",
			[home.id],
		);

		const dataset = wikiFixture();
		const fixtureHome = dataset.spaces[0]?.pages.find(
			(candidate) => candidate.sourceId === "100",
		);
		if (!fixtureHome) throw new Error("fixture home missing");
		fixtureHome.title = "Remote title";
		fixtureHome.versionNumber = 2;
		fixtureHome.storage = "<p>remote</p>";
		fixtureHome.view = "<p>remote</p>";

		const result = await importWikiDataset(dataset, { baseUrl });
		const kept = await page("100");
		expect(kept.title).toBe("Local title");
		expect(kept.id).toBe(home.id);
		const { rows } = await pool.query<{ body_html: string }>(
			"select body_html from pages where id = $1",
			[home.id],
		);
		expect(rows[0]?.body_html).toBe("<p>local</p>");
		expect(result.localChanges.pages).toContain(home.id);
		expect(formatLocalChanges(result.localChanges, false)).toContain(
			`pages 1 (ids ${home.id})`,
		);
	});

	test("a page edited before the marker existed is recognised by its local version", async () => {
		const child = await page("102");
		await pool.query(
			`insert into page_versions (source_id, page_id, number, title, body_html)
			 values ($1, $2, 9, 'Old local edit', '<p>old local</p>')`,
			[`fat:${randomUUID()}`, child.id],
		);
		await pool.query(
			"update pages set title = 'Old local edit', version_number = 9 where id = $1",
			[child.id],
		);
		// A database from before the migration holds no marks.
		await pool.query(
			"update pages set locally_changed_at = 'epoch' where id = $1",
			[child.id],
		);
		const {
			rows: [before],
		} = await pool.query<{ locally_changed_at: string | null }>(
			"select locally_changed_at from pages where id = $1",
			[child.id],
		);
		expect(before?.locally_changed_at).toBeNull();

		const dataset = wikiFixture();
		const remote = dataset.spaces[0]?.pages.find(
			(candidate) => candidate.sourceId === "102",
		);
		if (!remote) throw new Error("fixture page missing");
		remote.title = "Remote title again";
		const result = await importWikiDataset(dataset, { baseUrl });

		expect((await page("102")).title).toBe("Old local edit");
		expect(result.localChanges.pages).toContain(child.id);
		await importWikiDataset(dataset, { baseUrl, overwriteLocal: true });
	});

	test("--overwrite-local resets a locally changed page", async () => {
		const home = await page("100");
		const dataset = wikiFixture();
		const fixtureHome = dataset.spaces[0]?.pages.find(
			(candidate) => candidate.sourceId === "100",
		);
		if (!fixtureHome) throw new Error("fixture home missing");
		fixtureHome.title = "Remote title";
		fixtureHome.versionNumber = 2;
		fixtureHome.storage = "<p>remote</p>";
		fixtureHome.view = "<p>remote</p>";

		const result = await importWikiDataset(dataset, {
			baseUrl,
			overwriteLocal: true,
		});
		const reset = await page("100");
		expect(reset.title).toBe("Remote title");
		expect(result.localChanges.pages ?? []).toHaveLength(0);
		const {
			rows: [row],
		} = await pool.query<{ locally_changed_at: string | null }>(
			"select locally_changed_at from pages where id = $1",
			[home.id],
		);
		expect(row?.locally_changed_at).toBeNull();
		const { rows } = await pool.query<{ source_id: string }>(
			"select source_id from page_versions where page_id = $1 and number = 3",
			[home.id],
		);
		expect(rows[0]?.source_id.startsWith("fat:")).toBe(true);
	});

	test("a locally changed issue, its comment and status are kept", async () => {
		const first = await issue("FIXT-1");
		const {
			rows: [done],
		} = await pool.query<{ id: string }>(
			"select id from statuses where source_id = 'fixture-status-done'",
		);
		if (!done) throw new Error("done status missing");
		await pool.query(
			"update issues set summary = 'Local summary', status_id = $1 where id = $2",
			[done.id, first.id],
		);
		await pool.query(
			`insert into comments (source_id, issue_id, body_html, created, updated, internal)
			 values ($1, $2, '<p>local comment</p>', now(), now(), false)`,
			[`local:${randomUUID()}`, first.id],
		);
		await pool.query(
			"update comments set body_html = '<p>local edit</p>' where source_id = 'fixture-comment-1'",
		);

		const dataset = fixtureDataset();
		const remote = dataset.issues[0];
		const remoteComment = remote?.comments[0];
		if (!remote || !remoteComment) throw new Error("fixture issue missing");
		remote.issue.fields.summary = "Remote summary";
		remote.issue.fields.status = {
			...remote.issue.fields.status,
			id: "fixture-status-done",
			name: "Fixture Done",
			statusCategory: { key: "done" },
		};
		remoteComment.renderedBody = "<p>remote comment</p>";

		const result = await importJira();
		const kept = await issue("FIXT-1");
		expect(kept.summary).toBe("Local summary");
		expect(kept.status_id).toBe(done.id);
		expect(result.localChanges.issues).toContain(first.id);
		expect(formatLocalChanges(result.localChanges, false)).toContain(
			`issues 1 (ids ${first.id})`,
		);
		const { rows } = await pool.query<{ body_html: string }>(
			"select body_html from comments where issue_id = $1 and source_id = 'fixture-comment-1'",
			[first.id],
		);
		expect(rows[0]?.body_html).toBe("<p>local edit</p>");
		const { rows: localRows } = await pool.query<{ body_html: string }>(
			"select body_html from comments where issue_id = $1 and source_id like 'local:%'",
			[first.id],
		);
		expect(localRows.map((row) => row.body_html)).toEqual([
			"<p>local comment</p>",
		]);
	});

	test("--overwrite-local resets an issue and keeps locally created rows", async () => {
		const first = await issue("FIXT-1");
		const dataset = fixtureDataset();
		const remote = dataset.issues[0];
		if (!remote) throw new Error("fixture issue missing");
		remote.issue.fields.summary = "Remote summary";
		const result = await importJira(true);
		const reset = await issue("FIXT-1");
		expect(reset.summary).toBe("Remote summary");
		expect(reset.locally_changed_at).toBeNull();
		expect(result.localChanges.issues ?? []).toHaveLength(0);
		const { rows } = await pool.query<{ body_html: string }>(
			"select body_html from comments where issue_id = $1 and source_id like 'local:%'",
			[first.id],
		);
		expect(rows.map((row) => row.body_html)).toEqual(["<p>local comment</p>"]);
	});

	test("a locally changed issue keeps its epic link and parent", async () => {
		await importJira(true);
		await pool.query("update issues set epic_id = null where key = 'FIXT-1'");
		await pool.query("update issues set parent_id = null where key = 'FIXT-3'");

		const result = await importJira();

		const { rows } = await pool.query<{
			key: string;
			epic_id: string | null;
			parent_id: string | null;
			locally_changed_at: string | null;
		}>(
			"select key, epic_id, parent_id, locally_changed_at from issues where key in ('FIXT-1', 'FIXT-3') order by key",
		);
		expect(rows[0]?.epic_id).toBeNull();
		expect(rows[1]?.parent_id).toBeNull();
		expect(rows[0]?.locally_changed_at).not.toBeNull();
		expect(rows[1]?.locally_changed_at).not.toBeNull();
		expect(result.localChanges.issues).toHaveLength(2);
		await importJira(true);
	});

	test("an imported link removed in RVNA does not come back", async () => {
		await importJira(true);
		await pool.query(
			"delete from issue_links where source_id = 'fixture-link-1'",
		);

		await importJira();

		const { rows } = await pool.query(
			"select 1 from issue_links where source_id = 'fixture-link-1'",
		);
		expect(rows).toHaveLength(0);
		await importJira(true);
		const { rows: back } = await pool.query(
			"select 1 from issue_links where source_id = 'fixture-link-1'",
		);
		expect(back).toHaveLength(1);
	});

	test("a bumped update time alone is no local change, a field edit is", async () => {
		await importJira(true);
		const marked = async () =>
			(
				await pool.query<{ locally_changed_at: string | null }>(
					"select locally_changed_at from issues where key = 'FIXT-2'",
				)
			).rows[0]?.locally_changed_at;

		await pool.query("update issues set updated = now() where key = 'FIXT-2'");
		expect(await marked()).toBeNull();

		await pool.query(
			"update issues set summary = 'Edited here' where key = 'FIXT-2'",
		);
		expect(await marked()).not.toBeNull();
		await importJira(true);
		expect(await marked()).toBeNull();
	});

	test("locally created pages, issues and comments survive", async () => {
		const space = (
			await pool.query<{ id: string }>(
				"select id from spaces where key = 'FIX'",
			)
		).rows[0];
		if (!space) throw new Error("space missing");
		const localPageId = randomUUID();
		await pool.query(
			`insert into pages (id, source_id, space_id, title, body_html)
			 values ($1, $2, $3, 'Local page', '<p>local page</p>')`,
			[localPageId, `fat:${randomUUID()}`, space.id],
		);
		const project = (
			await pool.query<{ id: string }>(
				"select id from projects where key = $1",
				[fixtureProjectKey],
			)
		).rows[0];
		const type = (
			await pool.query<{ id: string }>(
				"select id from issue_types where source_id = 'fixture-type-task'",
			)
		).rows[0];
		const status = (
			await pool.query<{ id: string }>(
				"select id from statuses where source_id = 'fixture-status-todo'",
			)
		).rows[0];
		if (!project || !type || !status)
			throw new Error("fixture metadata missing");
		const localIssueId = randomUUID();
		await pool.query(
			`insert into issues (id, source_id, project_id, number, key, type_id, status_id, summary)
			 values ($1, $2, $3, 99, 'FIXT-99', $4, $5, 'Local issue')`,
			[localIssueId, `local:${randomUUID()}`, project.id, type.id, status.id],
		);
		await pool.query(
			`insert into comments (source_id, issue_id, body_html, created, updated, internal)
			 values ($1, $2, '<p>local only</p>', now(), now(), false)`,
			[`local:${randomUUID()}`, localIssueId],
		);

		await importWiki();
		await importJira();

		const localPage = await pool.query<{ title: string }>(
			"select title from pages where id = $1",
			[localPageId],
		);
		expect(localPage.rows[0]?.title).toBe("Local page");
		const localIssue = await pool.query<{ summary: string }>(
			"select summary from issues where id = $1",
			[localIssueId],
		);
		expect(localIssue.rows[0]?.summary).toBe("Local issue");
		const localComment = await pool.query<{ body_html: string }>(
			"select body_html from comments where issue_id = $1",
			[localIssueId],
		);
		expect(localComment.rows[0]?.body_html).toBe("<p>local only</p>");
	});

	test("parity counts only imported versions and reports kept local changes", async () => {
		const home = await page("100");
		const tables = await loadTableSet(pool);
		const snapshot = await loadWikiSnapshot(pool, tables);
		if (!snapshot) throw new Error("wiki snapshot missing");
		expect(snapshot.localPages?.has("100")).toBe(true);
		const { rows } = await pool.query<{ count: number }>(
			"select count(*)::int as count from page_versions where page_id = $1 and source_id not like 'fat:%'",
			[home.id],
		);
		expect(snapshot.versions.get("100")).toBe(rows[0]?.count);
		const live = {
			spaces: snapshot.spaces,
			pages: new Map(
				[...snapshot.pages].map(([sourceId, value]) => [
					sourceId,
					{
						...value,
						created: null,
						labels: snapshot.labels.get(sourceId) ?? [],
						restrictions: snapshot.restrictions.get(sourceId) ?? [],
					},
				]),
			),
			versions: new Map(snapshot.versions),
			comments: new Map(snapshot.comments),
			attachments: new Map(snapshot.attachments),
			attachmentSample: [],
			permissions: new Map(snapshot.permissions),
			tree: new Map(snapshot.tree),
			pageWatchers: new Map(snapshot.pageWatchers),
			spaceWatchers: new Map(snapshot.spaceWatchers),
			pageLikes: new Map(snapshot.pageLikes),
		};
		const checks = wikiChecks(live, snapshot, tables);
		for (const check of checks) {
			if (check.status === "MISMATCH") {
				expect.fail(`${check.name} was not OK: ${check.details.join(",")}`);
			}
		}
		const localCheck = checks.find(
			(check: { name: string }) => check.name === "confluence.local_changes",
		);
		expect(localCheck?.status).toBe("OK");
		expect(localCheck?.note).toMatch(/local changes kept: [1-9]/);
	});

	test("an import racing a local edit keeps the edit", async () => {
		const first = await issue("FIXT-1");
		await pool.query(
			"update issues set locally_changed_at = null where id = $1",
			[first.id],
		);
		await db.transaction(async (tx) => {
			await upsertRows(
				tx,
				issues,
				[{ sourceId: first.source_id, summary: first.summary }],
				(row) => String(row.sourceId),
				{ localChangeColumn: issues.locallyChangedAt },
			);
			await pool.query(
				"update issues set summary = 'Race local', locally_changed_at = now() where id = $1",
				[first.id],
			);
			const result = await upsertRows(
				tx,
				issues,
				[{ sourceId: first.source_id, summary: "Race remote" }],
				(row) => String(row.sourceId),
				{ localChangeColumn: issues.locallyChangedAt },
			);
			expect(result.keptLocalIds).toEqual([first.id]);
		});
		const kept = await issue("FIXT-1");
		expect(kept.summary).toBe("Race local");
	});
});
