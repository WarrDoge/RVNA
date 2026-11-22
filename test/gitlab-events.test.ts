import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { issueDevelopment } from "../src/lib/server/gitlab/development.ts";
import { handleGitlabEvent } from "../src/lib/server/gitlab/events.ts";
import { gitlabMergeRequests } from "../src/lib/server/schema-gitlab.ts";
import {
	cleanupGitlabFixture,
	createGitlabFixture,
	deliverDirect,
	type GitlabFixture,
	linkFixtureRepository,
	mergeRequestPayload,
	pipelinePayload,
	uniqueTag,
} from "./gitlab-fixtures.ts";

const tag = uniqueTag();
let fixture: GitlabFixture;
let pipelineFixture: GitlabFixture;
let repositoryId: string;

beforeAll(async () => {
	await runMigrations();
	fixture = await createGitlabFixture(tag);
	pipelineFixture = await createGitlabFixture(uniqueTag());
	repositoryId = await linkFixtureRepository(fixture);
	await linkFixtureRepository(pipelineFixture);
});

afterAll(async () => {
	await cleanupGitlabFixture(fixture);
	await cleanupGitlabFixture(pipelineFixture);
	await pool.end();
});

async function mergeRequest(iid: number) {
	const [row] = await db
		.select()
		.from(gitlabMergeRequests)
		.where(
			and(
				eq(gitlabMergeRequests.repositoryId, repositoryId),
				eq(gitlabMergeRequests.iid, iid),
			),
		)
		.limit(1);
	return row;
}

async function countSelects<T>(run: () => Promise<T>) {
	const original = db.select;
	let count = 0;
	const counted = ((...args: Parameters<typeof original>) => {
		count += 1;
		return original(...args);
	}) as unknown as typeof original;
	(db as unknown as { select: typeof original }).select = counted;
	try {
		return { result: await run(), count };
	} finally {
		(db as unknown as { select: typeof original }).select = original;
	}
}

test("a payload approval count is not replaced by a partial reviewer list", async () => {
	await deliverDirect(
		"Merge Request Hook",
		mergeRequestPayload(fixture, {
			iid: 21,
			title: `${fixture.issueKey} approvals`,
			state: "opened",
			action: "open",
			sourceBranch: `${fixture.issueKey}-approvals`,
			approvals: 3,
			reviewerState: "unreviewed",
		}),
		`${tag}:approvals`,
	);
	expect((await mergeRequest(21))?.approvals).toBe(3);

	await deliverDirect(
		"Merge Request Hook",
		mergeRequestPayload(fixture, {
			iid: 22,
			title: `${fixture.issueKey} reviewer fallback`,
			state: "opened",
			action: "approved",
			sourceBranch: `${fixture.issueKey}-fallback`,
			reviewerState: "approved",
		}),
		`${tag}:reviewer-fallback`,
	);
	expect((await mergeRequest(22))?.approvals).toBe(1);
});

test("a pipeline delivery replaces the issues linked by an earlier ref", async () => {
	await deliverDirect(
		"Pipeline Hook",
		pipelinePayload(pipelineFixture, {
			id: 8101,
			ref: `${pipelineFixture.issueKey}-first`,
			sha: "b".repeat(40),
			status: "success",
		}),
		`${tag}:pipeline-first`,
	);
	expect(
		(await issueDevelopment(pipelineFixture.issueKey))?.latestPipeline,
	).toBeTruthy();

	await deliverDirect(
		"Pipeline Hook",
		pipelinePayload(pipelineFixture, {
			id: 8101,
			ref: "unrelated",
			sha: "c".repeat(40),
			status: "success",
		}),
		`${tag}:pipeline-second`,
	);
	expect(
		(await issueDevelopment(pipelineFixture.issueKey))?.latestPipeline,
	).toBeNull();
});

test("events without development data do not load project keys or issues", async () => {
	for (const [header, payload] of [
		["Tag Push Hook", { object_kind: "tag_push", ref: "refs/tags/v1" }],
		["Note Hook", { object_kind: "note" }],
		["Issue Hook", { object_kind: "issue" }],
	] as const) {
		const { result, count } = await countSelects(() =>
			handleGitlabEvent(header, payload, "unused-delivery"),
		);
		expect(result.status).toBe("ignored");
		expect(count).toBe(0);
	}
});
