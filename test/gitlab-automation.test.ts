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
