import { afterAll, beforeAll, expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { issueDevelopment } from "../src/lib/server/gitlab/development.ts";
import { branchNameFor } from "../src/lib/server/gitlab/keys.ts";
import { saveProjectGitlabSettings } from "../src/lib/server/gitlab/project-settings.ts";
import {
	cleanupGitlabFixture,
	createGitlabFixture,
	deliverDirect,
	type GitlabFixture,
	linkFixtureRepository,
	pipelinePayload,
	pushPayload,
	uniqueTag,
} from "./gitlab-fixtures.ts";

const tag = uniqueTag();
let fixture: GitlabFixture;
let repositoryId: string;

beforeAll(async () => {
	await runMigrations();
	fixture = await createGitlabFixture(tag);
	repositoryId = await linkFixtureRepository(fixture);
	await saveProjectGitlabSettings(fixture.projectId, {
		linkedRepositoryIds: [repositoryId],
		defaultRepositoryId: repositoryId,
		smartCommitsEnabled: false,
		mergeRequestOpenedEnabled: false,
		mergeRequestOpenedTransitions: [],
		mergeRequestMergedEnabled: false,
		mergeRequestMergedTransitions: [],
	});
});

afterAll(async () => {
	await cleanupGitlabFixture(fixture);
	await pool.end();
});

test("the development panel combines pipelines, settings and linked repositories", async () => {
	const branch = `${fixture.issueKey}-development`;
	const sha = "a".repeat(40);
	await deliverDirect(
		"Push Hook",
		pushPayload(fixture, branch, [
			{ sha, title: `${fixture.issueKey} add development data` },
		]),
		`${tag}:development-push`,
	);
	await deliverDirect(
		"Pipeline Hook",
		pipelinePayload(fixture, {
			id: 7001,
			ref: branch,
			sha,
			status: "success",
		}),
		`${tag}:development-pipeline`,
	);

	const development = await issueDevelopment(fixture.issueKey);
	expect(development?.counts).toEqual({
		branches: 1,
		commits: 1,
		mergeRequests: 0,
	});
	expect(development?.latestPipeline).toMatchObject({
		status: "success",
		ref: branch,
	});
	expect(development?.latestCommit?.sha).toBe(sha);

	const name = branchNameFor(fixture.issueKey, `${tag} test issue`);
	expect(development?.createBranch).toEqual({
		name,
		url: `https://gitlab.example.test/${tag}/service/-/branches/new?branch_name=${name}`,
	});
});
