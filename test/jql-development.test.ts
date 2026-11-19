import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { issues, issueTypes, statuses } from "../src/lib/server/schema.ts";
import {
	gitlabBranches,
	gitlabBranchIssues,
	gitlabMergeRequestIssues,
	gitlabMergeRequests,
	gitlabRepositories,
} from "../src/lib/server/schema-gitlab.ts";
import { searchIssues } from "../src/lib/server/search/service.ts";
import { JqlError } from "../src/lib/shared/jql/index.ts";
import {
	cleanupGitlabFixture,
	createGitlabFixture,
	type GitlabFixture,
	uniqueTag,
} from "./gitlab-fixtures.ts";

const tag = uniqueTag();
let fixture: GitlabFixture;
let otherIssueKey: string;
let emptyIssueKey: string;

async function keys(jql: string) {
	const result = await searchIssues(
		{ jql, startAt: 0, maxResults: 100 },
		{ id: randomUUID(), username: `${tag}-admin`, isAdmin: true },
		{ now: new Date("2026-06-01T00:00:00Z") },
	);
	return result.issues.map((issue) => issue.key).sort();
}

beforeAll(async () => {
	await runMigrations();
	fixture = await createGitlabFixture(tag);

	const [type] = await db
		.select({ id: issueTypes.id })
		.from(issueTypes)
		.where(eq(issueTypes.name, `${tag} Task`));
	const [status] = await db
		.select({ id: statuses.id })
		.from(statuses)
		.where(eq(statuses.name, `${tag} To Do`));

	const rows = await db
		.insert(issues)
		.values([
			{
				sourceId: `${tag}:issue:2`,
				projectId: fixture.projectId,
				number: 2,
				key: `${fixture.projectKey}-2`,
				typeId: type.id,
				statusId: status.id,
				summary: "merged only",
			},
			{
				sourceId: `${tag}:issue:3`,
				projectId: fixture.projectId,
				number: 3,
				key: `${fixture.projectKey}-3`,
				typeId: type.id,
				statusId: status.id,
				summary: "no development",
			},
		])
		.returning();
	otherIssueKey = rows[0].key;
	emptyIssueKey = rows[1].key;

	const [repository] = await db
		.insert(gitlabRepositories)
		.values({
			gitlabProjectId: 900000 + Number.parseInt(tag.slice(2, 5), 36),
			path: `${tag}/jql`,
			name: "jql",
			webUrl: `https://gitlab.example.test/${tag}/jql`,
		})
		.returning();

	const [branch] = await db
		.insert(gitlabBranches)
		.values({
			repositoryId: repository.id,
			name: `${fixture.issueKey}-branch`,
		})
		.returning();
	await db.insert(gitlabBranchIssues).values({
		branchId: branch.id,
		issueId: fixture.issueId,
	});

	const mergeRequests = await db
		.insert(gitlabMergeRequests)
		.values([
			{
				repositoryId: repository.id,
				iid: 1,
				title: `${fixture.issueKey} open`,
				state: "opened",
			},
			{
				repositoryId: repository.id,
				iid: 2,
				title: `${otherIssueKey} merged`,
				state: "merged",
			},
		])
		.returning();
	await db.insert(gitlabMergeRequestIssues).values([
		{ mergeRequestId: mergeRequests[0].id, issueId: fixture.issueId },
		{ mergeRequestId: mergeRequests[1].id, issueId: rows[0].id },
	]);
});

afterAll(async () => {
	await cleanupGitlabFixture(fixture);
	await pool.end();
});

describe("JQL development fields", () => {
	test("filters by branches and merge requests", async () => {
		expect(
			await keys(`project = ${fixture.projectKey} AND hasBranch = true`),
		).toEqual([fixture.issueKey]);
		expect(
			await keys(`project = ${fixture.projectKey} AND hasBranch = false`),
		).toEqual([otherIssueKey, emptyIssueKey].sort());
		expect(
			await keys(
				`project = ${fixture.projectKey} AND hasOpenMergeRequest = true`,
			),
		).toEqual([fixture.issueKey]);
		expect(
			await keys(
				`project = ${fixture.projectKey} AND hasMergedMergeRequest = true`,
			),
		).toEqual([otherIssueKey]);
		expect(
			await keys(
				`project = ${fixture.projectKey} AND hasMergedMergeRequest = false`,
			),
		).toEqual([fixture.issueKey, emptyIssueKey].sort());
	});

	test("accepts spaced aliases and combines with other clauses", async () => {
		expect(
			await keys(
				`project = ${fixture.projectKey} AND "has open merge request" = true`,
			),
		).toEqual([fixture.issueKey]);
		expect(
			await keys(
				`project = ${fixture.projectKey} AND (hasBranch = true OR hasMergedMergeRequest = true)`,
			),
		).toEqual([fixture.issueKey, otherIssueKey].sort());
	});

	test("rejects values and operators outside the boolean form", async () => {
		await expect(keys("hasBranch = maybe")).rejects.toBeInstanceOf(JqlError);
		await expect(keys("hasBranch ~ branch")).rejects.toBeInstanceOf(JqlError);
	});
});
