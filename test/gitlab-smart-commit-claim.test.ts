import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { saveProjectGitlabSettings } from "../src/lib/server/gitlab/project-settings.ts";
import {
	cleanupGitlabFixture,
	createGitlabFixture,
	deliverDirect,
	type GitlabFixture,
	linkFixtureRepository,
	pushPayload,
	uniqueTag,
} from "./gitlab-fixtures.ts";

vi.mock("../src/lib/server/gitlab/automation.ts", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("../src/lib/server/gitlab/automation.ts")
		>();
	return {
		...actual,
		applySmartCommits: async (input: { issues: { id: string }[] }) => {
			const { db } = await import("../src/lib/server/db.ts");
			const { gitlabCommitIssues } = await import(
				"../src/lib/server/schema-gitlab.ts"
			);
			const { inArray } = await import("drizzle-orm");
			const rows = await db
				.select()
				.from(gitlabCommitIssues)
				.where(
					inArray(
						gitlabCommitIssues.issueId,
						input.issues.map((issue) => issue.id),
					),
				);
			if (rows.some((row) => !row.smartCommitsApplied)) {
				throw new Error("smart commits were applied before being claimed");
			}
		},
	};
});

const tag = uniqueTag();
let fixture: GitlabFixture;

beforeAll(async () => {
	await runMigrations();
	fixture = await createGitlabFixture(tag);
	const repositoryId = await linkFixtureRepository(fixture);
	await saveProjectGitlabSettings(fixture.projectId, {
		linkedRepositoryIds: [repositoryId],
		defaultRepositoryId: null,
		smartCommitsEnabled: true,
		mergeRequestOpenedEnabled: false,
		mergeRequestOpenedTransitions: [],
		mergeRequestMergedEnabled: false,
		mergeRequestMergedTransitions: [],
	});
});

afterAll(async () => {
	await cleanupGitlabFixture(fixture);
	await pool.query(
		"delete from gitlab_deliveries where idempotency_key like $1",
		[`${tag}%`],
	);
	await pool.end();
});

test("a commit is claimed before its smart commits run", async () => {
	const result = await deliverDirect(
		"Push Hook",
		pushPayload(fixture, `${fixture.issueKey}-claim`, [
			{
				sha: "d".repeat(40),
				title: `${fixture.issueKey} #comment claimed first`,
			},
		]),
		`${tag}:claim`,
	);
	expect(result.status).toBe("processed");
});
