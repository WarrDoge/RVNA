import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { saveProjectGitlabSettings } from "../src/lib/server/gitlab/project-settings.ts";
import {
	comments,
	issueHistory,
	issues,
	statuses,
	worklogs,
} from "../src/lib/server/schema.ts";
import { gitlabAutomationEvents } from "../src/lib/server/schema-gitlab.ts";
import {
	cleanupGitlabFixture,
	createGitlabFixture,
	deliverDirect,
	type GitlabFixture,
	linkFixtureRepository,
	mergeRequestPayload,
	pushPayload,
	uniqueTag,
} from "./gitlab-fixtures.ts";

const tag = uniqueTag();
let smart: GitlabFixture;
let triggers: GitlabFixture;
let smartRepositoryId: string;
let triggerRepositoryId: string;

function settingsFor(overrides: Record<string, unknown> = {}) {
	return {
		linkedRepositoryIds: [],
		defaultRepositoryId: null,
		smartCommitsEnabled: false,
		mergeRequestOpenedEnabled: false,
		mergeRequestOpenedTransitions: [],
		mergeRequestMergedEnabled: false,
		mergeRequestMergedTransitions: [],
		...overrides,
	};
}

async function issueState(issueId: string) {
	const [row] = await db
		.select({
			status: statuses.name,
			timeSpent: issues.timeSpent,
			resolutionId: issues.resolutionId,
		})
		.from(issues)
		.innerJoin(statuses, eq(statuses.id, issues.statusId))
		.where(eq(issues.id, issueId))
		.limit(1);
	return row;
}

beforeAll(async () => {
	await runMigrations();
	smart = await createGitlabFixture(`${tag}a`);
	triggers = await createGitlabFixture(`${tag}b`);
	smartRepositoryId = await linkFixtureRepository(smart);
	triggerRepositoryId = await linkFixtureRepository(triggers);
	await saveProjectGitlabSettings(
		smart.projectId,
		settingsFor({
			smartCommitsEnabled: true,
			linkedRepositoryIds: [smartRepositoryId],
		}),
	);
	await saveProjectGitlabSettings(
		triggers.projectId,
		settingsFor({
			linkedRepositoryIds: [triggerRepositoryId],
			mergeRequestOpenedEnabled: true,
			mergeRequestOpenedTransitions: ["No such transition", "Start progress"],
			mergeRequestMergedEnabled: true,
			mergeRequestMergedTransitions: ["Finish"],
		}),
	);
});

afterAll(async () => {
	await cleanupGitlabFixture(smart);
	await cleanupGitlabFixture(triggers);
	await pool.query(
		"delete from gitlab_deliveries where idempotency_key like $1",
		[`${tag}%`],
	);
	await pool.end();
});

describe("smart commits", () => {
	test("apply comments, time and transitions as the mapped user", async () => {
		const result = await deliverDirect(
			"Push Hook",
			pushPayload(smart, `${smart.issueKey}-smart`, [
				{
					sha: "e".repeat(40),
					title: `${smart.issueKey} work`,
					message: [
						`${smart.issueKey} #comment <script>alert("x")</script> deployed`,
						`${smart.issueKey} #time 1h 30m`,
						`${smart.issueKey} #Start progress`,
					].join("\n"),
				},
			]),
			`${tag}:smart`,
		);
		expect(result.status).toBe("processed");

		const [comment] = await db
			.select()
			.from(comments)
			.where(eq(comments.issueId, smart.issueId));
		expect(comment?.authorId).toBe(smart.userId);
		expect(comment?.bodySource).toContain("<script>");
		expect(comment?.bodyHtml ?? "").not.toContain("<script");
		expect(comment?.bodyHtml ?? "").toContain("&lt;script&gt;");

		const [worklog] = await db
			.select()
			.from(worklogs)
			.where(eq(worklogs.issueId, smart.issueId));
		expect(worklog?.seconds).toBe(5400);
		expect(worklog?.authorId).toBe(smart.userId);

		const state = await issueState(smart.issueId);
		expect(state?.status).toBe(`${smart.tag} In Progress`);
		expect(state?.timeSpent).toBe(5400);

		const history = await db
			.select()
			.from(issueHistory)
			.where(
				and(
					eq(issueHistory.issueId, smart.issueId),
					eq(issueHistory.via, "gitlab"),
				),
			);
		expect(history.length).toBeGreaterThanOrEqual(2);
		expect(history.every((entry) => entry.authorId === smart.userId)).toBe(
			true,
		);

		const events = await db
			.select()
			.from(gitlabAutomationEvents)
			.where(eq(gitlabAutomationEvents.issueId, smart.issueId));
		expect(events.filter((event) => event.status === "applied")).toHaveLength(
			3,
		);
		expect(
			events
				.filter((event) => event.status === "applied")
				.map((event) => event.kind)
				.sort(),
		).toEqual([
			"smart_commit_comment",
			"smart_commit_time",
			"smart_commit_transition",
		]);
	});

	test("two concurrent worklogs keep both increments", async () => {
		const fixture = await createGitlabFixture(`${tag}j`);
		const repositoryId = await linkFixtureRepository(fixture);
		await saveProjectGitlabSettings(
			fixture.projectId,
			settingsFor({
				smartCommitsEnabled: true,
				linkedRepositoryIds: [repositoryId],
			}),
		);

		const client = await pool.connect();
		try {
			await client.query("begin");
			await client.query("update issues set time_spent = 100 where id = $1", [
				fixture.issueId,
			]);
			const delivery = deliverDirect(
				"Push Hook",
				pushPayload(fixture, `${fixture.issueKey}-race`, [
					{
						sha: "9".repeat(40),
						title: `${fixture.issueKey} #time 1h`,
					},
				]),
				`${tag}:race`,
			);

			const deadline = Date.now() + 10_000;
			while (Date.now() < deadline) {
				const { rows } = await pool.query(
					"select 1 from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%issues%' and pid <> pg_backend_pid() limit 1",
				);
				if (rows.length > 0) break;
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			await client.query("commit");
			const result = await delivery;
			expect(result.status).toBe("processed");
		} finally {
			await client.query("rollback").catch(() => undefined);
			client.release();
		}

		const [row] = await db
			.select({ timeSpent: issues.timeSpent })
			.from(issues)
			.where(eq(issues.id, fixture.issueId));
		expect(row?.timeSpent).toBe(3700);

		await cleanupGitlabFixture(fixture);
	});

	test("records a reason when the author email matches no user", async () => {
		const before = await issueState(smart.issueId);
		await deliverDirect(
			"Push Hook",
			pushPayload(smart, `${smart.issueKey}-stranger`, [
				{
					sha: "f".repeat(40),
					title: `${smart.issueKey} #comment from a stranger`,
					email: "stranger@example.test",
				},
			]),
			`${tag}:stranger`,
		);

		const events = await db
			.select()
			.from(gitlabAutomationEvents)
			.where(eq(gitlabAutomationEvents.issueId, smart.issueId));
		const ignored = events.filter(
			(event) =>
				event.kind === "smart_commit_comment" && event.status === "ignored",
		);
		expect(ignored).toHaveLength(1);
		expect(ignored[0]?.reason).toContain("matches no active user");

		const after = await issueState(smart.issueId);
		expect(after?.status).toBe(before?.status);
	});

	test("ignores a command when the repository is not linked to the project", async () => {
		const unlinked = await createGitlabFixture(`${tag}f`);
		await saveProjectGitlabSettings(
			unlinked.projectId,
			settingsFor({ smartCommitsEnabled: true }),
		);

		await deliverDirect(
			"Push Hook",
			pushPayload(unlinked, `${unlinked.issueKey}-unlinked`, [
				{
					sha: "3".repeat(40),
					title: `${unlinked.issueKey} #comment from an unlinked repository`,
				},
			]),
			`${tag}:unlinked`,
		);

		expect((await issueState(unlinked.issueId))?.status).toBe(
			`${unlinked.tag} To Do`,
		);
		const commentsForIssue = await db
			.select()
			.from(comments)
			.where(eq(comments.issueId, unlinked.issueId));
		expect(commentsForIssue).toHaveLength(0);
		const events = await db
			.select()
			.from(gitlabAutomationEvents)
			.where(eq(gitlabAutomationEvents.issueId, unlinked.issueId));
		expect(events).toHaveLength(1);
		expect(events[0]?.status).toBe("ignored");
		expect(events[0]?.reason).toContain("not linked");

		await cleanupGitlabFixture(unlinked);
	});

	test("ignores commands when the author lacks the matching permission", async () => {
		const limited = await createGitlabFixture(`${tag}g`, { member: false });
		const repositoryId = await linkFixtureRepository(limited);
		await saveProjectGitlabSettings(
			limited.projectId,
			settingsFor({
				smartCommitsEnabled: true,
				linkedRepositoryIds: [repositoryId],
			}),
		);

		await deliverDirect(
			"Push Hook",
			pushPayload(limited, `${limited.issueKey}-limited`, [
				{
					sha: "4".repeat(40),
					title: [
						`${limited.issueKey} #comment no permission`,
						`${limited.issueKey} #time 30m`,
						`${limited.issueKey} #Start progress`,
					].join("\n"),
				},
			]),
			`${tag}:limited`,
		);

		expect((await issueState(limited.issueId))?.status).toBe(
			`${limited.tag} To Do`,
		);
		expect((await issueState(limited.issueId))?.timeSpent).toBeNull();
		const commentsForIssue = await db
			.select()
			.from(comments)
			.where(eq(comments.issueId, limited.issueId));
		expect(commentsForIssue).toHaveLength(0);
		const worklogsForIssue = await db
			.select()
			.from(worklogs)
			.where(eq(worklogs.issueId, limited.issueId));
		expect(worklogsForIssue).toHaveLength(0);
		const events = await db
			.select()
			.from(gitlabAutomationEvents)
			.where(eq(gitlabAutomationEvents.issueId, limited.issueId));
		expect(
			events
				.filter((event) => event.status === "ignored")
				.map((event) => event.reason ?? ""),
		).toEqual(
			expect.arrayContaining([
				expect.stringContaining("ADD_COMMENTS"),
				expect.stringContaining("WORK_ON_ISSUES"),
				expect.stringContaining("TRANSITION_ISSUES"),
			]),
		);

		await cleanupGitlabFixture(limited);
	});

	test("records a reason when a transition is not available", async () => {
		await deliverDirect(
			"Push Hook",
			pushPayload(smart, `${smart.issueKey}-unavailable`, [
				{
					sha: "1".repeat(40),
					title: `${smart.issueKey} #Start progress`,
				},
			]),
			`${tag}:unavailable`,
		);

		const events = await db
			.select()
			.from(gitlabAutomationEvents)
			.where(
				and(
					eq(gitlabAutomationEvents.issueId, smart.issueId),
					eq(gitlabAutomationEvents.kind, "smart_commit_transition"),
				),
			);
		const ignored = events.filter((event) => event.status === "ignored");
		expect(ignored).toHaveLength(1);
		expect(ignored[0]?.reason).toContain("not available");
	});
});

describe("merge request triggers", () => {
	test("transition on open and on merge, once", async () => {
		const branch = `${triggers.issueKey}-feature`;
		await deliverDirect(
			"Merge Request Hook",
			mergeRequestPayload(triggers, {
				iid: 3,
				title: `${triggers.issueKey} feature`,
				state: "opened",
				action: "open",
				sourceBranch: branch,
			}),
			`${tag}:trigger-open`,
		);

		expect((await issueState(triggers.issueId))?.status).toBe(
			`${triggers.tag} In Progress`,
		);

		await deliverDirect(
			"Merge Request Hook",
			mergeRequestPayload(triggers, {
				iid: 3,
				title: `${triggers.issueKey} feature`,
				state: "merged",
				action: "merge",
				sourceBranch: branch,
			}),
			`${tag}:trigger-merge`,
		);

		const merged = await issueState(triggers.issueId);
		expect(merged?.status).toBe(`${triggers.tag} Done`);
		expect(merged?.resolutionId).not.toBeNull();

		const before = await db
			.select()
			.from(issueHistory)
			.where(eq(issueHistory.issueId, triggers.issueId));

		await deliverDirect(
			"Merge Request Hook",
			mergeRequestPayload(triggers, {
				iid: 3,
				title: `${triggers.issueKey} feature`,
				state: "merged",
				action: "merge",
				sourceBranch: branch,
			}),
			`${tag}:trigger-merge-again`,
		);

		const after = await db
			.select()
			.from(issueHistory)
			.where(eq(issueHistory.issueId, triggers.issueId));
		expect(after).toHaveLength(before.length);

		const events = await db
			.select()
			.from(gitlabAutomationEvents)
			.where(eq(gitlabAutomationEvents.issueId, triggers.issueId));
		expect(
			events
				.filter((event) => event.status === "applied")
				.map((event) => event.kind)
				.sort(),
		).toEqual(["merge_request_merged", "merge_request_opened"]);
	});

	test("a retry applies the trigger to issues that were skipped", async () => {
		const fixture = await createGitlabFixture(`${tag}k`);
		const repositoryId = await linkFixtureRepository(fixture);
		await saveProjectGitlabSettings(
			fixture.projectId,
			settingsFor({
				linkedRepositoryIds: [repositoryId],
				mergeRequestMergedEnabled: true,
				mergeRequestMergedTransitions: ["Finish"],
			}),
		);

		const [first] = await db
			.select({ typeId: issues.typeId })
			.from(issues)
			.where(eq(issues.id, fixture.issueId));
		const statusRows = await db
			.select({ id: statuses.id, name: statuses.name })
			.from(statuses)
			.where(eq(statuses.sourceId, `${fixture.tag}:status:progress`));
		const doneRows = await db
			.select({ id: statuses.id })
			.from(statuses)
			.where(eq(statuses.sourceId, `${fixture.tag}:status:done`));
		const progressStatusId = statusRows[0]?.id;
		const doneStatusId = doneRows[0]?.id;
		if (!first || !progressStatusId || !doneStatusId) {
			throw new Error("fixture statuses missing");
		}

		const [second] = await db
			.insert(issues)
			.values({
				sourceId: `${fixture.tag}:issue:2`,
				projectId: fixture.projectId,
				number: 2,
				key: `${fixture.projectKey}-2`,
				typeId: first.typeId,
				statusId: doneStatusId,
				summary: "Second issue",
				created: new Date("2026-01-01T00:00:00Z"),
				updated: new Date("2026-01-01T00:00:00Z"),
			})
			.returning();
		await db
			.update(issues)
			.set({ statusId: progressStatusId })
			.where(eq(issues.id, fixture.issueId));

		const payload = mergeRequestPayload(fixture, {
			iid: 9,
			title: `${fixture.issueKey} ${second.key}`,
			state: "merged",
			action: "merge",
			sourceBranch: `${fixture.issueKey}-retry`,
		});
		await deliverDirect("Merge Request Hook", payload, `${tag}:partial-1`);

		await db
			.update(issues)
			.set({ statusId: progressStatusId })
			.where(eq(issues.id, second.id));
		await deliverDirect("Merge Request Hook", payload, `${tag}:partial-2`);

		const [after] = await db
			.select({ statusId: issues.statusId })
			.from(issues)
			.where(eq(issues.id, second.id));
		expect(after?.statusId).toBe(doneStatusId);

		await cleanupGitlabFixture(fixture);
	});

	test("records a reason when the acting user is unknown", async () => {
		const other = await createGitlabFixture(`${tag}c`);
		const repositoryId = await linkFixtureRepository(other);
		await saveProjectGitlabSettings(
			other.projectId,
			settingsFor({
				linkedRepositoryIds: [repositoryId],
				mergeRequestOpenedEnabled: true,
				mergeRequestOpenedTransitions: ["Start progress"],
			}),
		);

		await deliverDirect(
			"Merge Request Hook",
			mergeRequestPayload(other, {
				iid: 4,
				title: `${other.issueKey} feature`,
				state: "opened",
				action: "open",
				sourceBranch: `${other.issueKey}-feature`,
				email: "nobody@example.test",
			}),
			`${tag}:trigger-unknown`,
		);

		expect((await issueState(other.issueId))?.status).toBe(
			`${other.tag} To Do`,
		);
		const events = await db
			.select()
			.from(gitlabAutomationEvents)
			.where(eq(gitlabAutomationEvents.issueId, other.issueId));
		expect(events).toHaveLength(1);
		expect(events[0]?.status).toBe("ignored");
		expect(events[0]?.reason).toContain("matches no active user");

		await cleanupGitlabFixture(other);
	});

	test("records a reason when no configured trigger is available", async () => {
		const stuck = await createGitlabFixture(`${tag}e`);
		const repositoryId = await linkFixtureRepository(stuck);
		await saveProjectGitlabSettings(
			stuck.projectId,
			settingsFor({
				linkedRepositoryIds: [repositoryId],
				mergeRequestOpenedEnabled: true,
				mergeRequestOpenedTransitions: ["Finish"],
			}),
		);

		await deliverDirect(
			"Merge Request Hook",
			mergeRequestPayload(stuck, {
				iid: 6,
				title: `${stuck.issueKey} feature`,
				state: "opened",
				action: "open",
				sourceBranch: `${stuck.issueKey}-feature`,
			}),
			`${tag}:trigger-stuck`,
		);

		expect((await issueState(stuck.issueId))?.status).toBe(
			`${stuck.tag} To Do`,
		);
		const events = await db
			.select()
			.from(gitlabAutomationEvents)
			.where(eq(gitlabAutomationEvents.issueId, stuck.issueId));
		expect(events).toHaveLength(1);
		expect(events[0]?.status).toBe("ignored");
		expect(events[0]?.reason).toContain("none of");

		await cleanupGitlabFixture(stuck);
	});

	test("ignores a trigger when the repository is not linked", async () => {
		const unlinked = await createGitlabFixture(`${tag}h`);
		await saveProjectGitlabSettings(
			unlinked.projectId,
			settingsFor({
				mergeRequestOpenedEnabled: true,
				mergeRequestOpenedTransitions: ["Start progress"],
			}),
		);

		await deliverDirect(
			"Merge Request Hook",
			mergeRequestPayload(unlinked, {
				iid: 7,
				title: `${unlinked.issueKey} feature`,
				state: "opened",
				action: "open",
				sourceBranch: `${unlinked.issueKey}-feature`,
			}),
			`${tag}:trigger-unlinked`,
		);

		expect((await issueState(unlinked.issueId))?.status).toBe(
			`${unlinked.tag} To Do`,
		);
		const events = await db
			.select()
			.from(gitlabAutomationEvents)
			.where(eq(gitlabAutomationEvents.issueId, unlinked.issueId));
		expect(events).toHaveLength(1);
		expect(events[0]?.status).toBe("ignored");
		expect(events[0]?.reason).toContain("not linked");

		await cleanupGitlabFixture(unlinked);
	});

	test("ignores a trigger when the actor lacks TRANSITION_ISSUES", async () => {
		const limited = await createGitlabFixture(`${tag}i`, { member: false });
		const repositoryId = await linkFixtureRepository(limited);
		await saveProjectGitlabSettings(
			limited.projectId,
			settingsFor({
				linkedRepositoryIds: [repositoryId],
				mergeRequestOpenedEnabled: true,
				mergeRequestOpenedTransitions: ["Start progress"],
			}),
		);

		await deliverDirect(
			"Merge Request Hook",
			mergeRequestPayload(limited, {
				iid: 8,
				title: `${limited.issueKey} feature`,
				state: "opened",
				action: "open",
				sourceBranch: `${limited.issueKey}-feature`,
			}),
			`${tag}:trigger-limited`,
		);

		expect((await issueState(limited.issueId))?.status).toBe(
			`${limited.tag} To Do`,
		);
		const events = await db
			.select()
			.from(gitlabAutomationEvents)
			.where(eq(gitlabAutomationEvents.issueId, limited.issueId));
		expect(events).toHaveLength(1);
		expect(events[0]?.status).toBe("ignored");
		expect(events[0]?.reason).toContain("TRANSITION_ISSUES");

		await cleanupGitlabFixture(limited);
	});

	test("does nothing when the project switches are off", async () => {
		const off = await createGitlabFixture(`${tag}d`);
		await deliverDirect(
			"Push Hook",
			pushPayload(off, `${off.issueKey}-quiet`, [
				{
					sha: "2".repeat(40),
					title: `${off.issueKey} #comment should not appear`,
				},
			]),
			`${tag}:off-push`,
		);
		await deliverDirect(
			"Merge Request Hook",
			mergeRequestPayload(off, {
				iid: 5,
				title: `${off.issueKey} feature`,
				state: "opened",
				action: "open",
				sourceBranch: `${off.issueKey}-feature`,
			}),
			`${tag}:off-mr`,
		);

		const quietComments = await db
			.select()
			.from(comments)
			.where(eq(comments.issueId, off.issueId));
		expect(quietComments).toHaveLength(0);
		expect((await issueState(off.issueId))?.status).toBe(`${off.tag} To Do`);
		const events = await db
			.select()
			.from(gitlabAutomationEvents)
			.where(eq(gitlabAutomationEvents.issueId, off.issueId));
		expect(events).toHaveLength(0);

		await cleanupGitlabFixture(off);
	});
});

describe("schema", () => {
	test("repository links are indexed by repository", async () => {
		const result = await pool.query<{ indexname: string }>(
			"select indexname from pg_indexes where tablename = 'gitlab_project_repositories'",
		);
		expect(result.rows.map((row) => row.indexname)).toContain(
			"gitlab_project_repositories_repository_idx",
		);
	});

	test("deleting an issue keeps its automation audit trail", async () => {
		const fixture = await createGitlabFixture(`${tag}keep`, {
			key: `K${tag.slice(2, 7).toUpperCase()}`,
		});
		let eventId: string | undefined;
		try {
			const [event] = await db
				.insert(gitlabAutomationEvents)
				.values({
					issueId: fixture.issueId,
					kind: "smart_commit_comment",
					status: "applied",
					reason: null,
				})
				.returning();
			eventId = event.id;

			await db.delete(issues).where(eq(issues.id, fixture.issueId));

			const [row] = await db
				.select()
				.from(gitlabAutomationEvents)
				.where(eq(gitlabAutomationEvents.id, event.id));
			expect(row).toBeDefined();
			expect(row?.issueId).toBeNull();
		} finally {
			if (eventId) {
				await db
					.delete(gitlabAutomationEvents)
					.where(eq(gitlabAutomationEvents.id, eventId));
			}
			await cleanupGitlabFixture(fixture);
		}
	});
});
