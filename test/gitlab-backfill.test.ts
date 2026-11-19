import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { backfillProject } from "../src/lib/server/gitlab/backfill.ts";
import { type FetchLike, GitlabApi } from "../src/lib/server/gitlab/client.ts";
import { issueDevelopment } from "../src/lib/server/gitlab/development.ts";
import {
	gitlabBranches,
	gitlabCommits,
	gitlabMergeRequests,
} from "../src/lib/server/schema-gitlab.ts";
import {
	cleanupGitlabFixture,
	createGitlabFixture,
	type GitlabFixture,
	uniqueTag,
} from "./gitlab-fixtures.ts";

const tag = uniqueTag();
const projectPath = `${tag}/backfill`;
let fixture: GitlabFixture;

const sha = (character: string) => character.repeat(40);

function json(body: unknown, nextPage: number | null = null) {
	return {
		ok: true,
		status: 200,
		headers: {
			get: (name: string) =>
				name === "x-next-page"
					? nextPage === null
						? ""
						: String(nextPage)
					: null,
		},
		json: async () => body,
		text: async () => "",
	};
}

function mockGitlab(calls: { url: string; token?: string }[]): FetchLike {
	return async (url, init) => {
		calls.push({ url, token: init?.headers?.["PRIVATE-TOKEN"] });
		const parsed = new URL(url);
		const page = Number(parsed.searchParams.get("page") ?? "1");

		if (
			parsed.pathname === `/api/v4/projects/${encodeURIComponent(projectPath)}`
		) {
			return json({
				id: 555,
				path_with_namespace: projectPath,
				name: "backfill",
				web_url: `https://gitlab.example.test/${projectPath}`,
				default_branch: "main",
			});
		}
		if (parsed.pathname.endsWith("/repository/branches")) {
			return page === 1
				? json(
						[
							{ name: `${fixture.issueKey}-feature`, commit: { id: sha("a") } },
							{ name: "main", commit: { id: sha("b") } },
						],
						2,
					)
				: json([
						{ name: `${fixture.issueKey}-second`, commit: { id: sha("c") } },
					]);
		}
		if (parsed.pathname.endsWith("/repository/commits")) {
			return page === 1
				? json(
						[
							{
								id: sha("a"),
								title: `${fixture.issueKey} first`,
								message: `${fixture.issueKey} first`,
								author_name: "GitLab Tester",
								author_email: fixture.userEmail,
								committed_date: "2026-05-01T10:00:00Z",
								web_url: `https://gitlab.example.test/${projectPath}/-/commit/${sha("a")}`,
							},
							{
								id: sha("b"),
								title: "unrelated",
								message: "unrelated",
								author_name: "GitLab Tester",
								author_email: fixture.userEmail,
								committed_date: "2026-05-02T10:00:00Z",
								web_url: null,
							},
						],
						2,
					)
				: json([
						{
							id: sha("c"),
							title: `${fixture.issueKey} third`,
							message: `${fixture.issueKey} third`,
							author_name: "GitLab Tester",
							author_email: fixture.userEmail,
							committed_date: "2026-05-03T10:00:00Z",
							web_url: null,
						},
					]);
		}
		if (parsed.pathname.endsWith("/merge_requests")) {
			return json([
				{
					iid: 21,
					title: `${fixture.issueKey} backfilled MR`,
					state: "opened",
					source_branch: `${fixture.issueKey}-feature`,
					target_branch: "main",
					author: { name: "GitLab Tester", email: fixture.userEmail },
					reviewers: [{ name: "Reviewer", email: "reviewer@example.test" }],
					web_url: `https://gitlab.example.test/${projectPath}/-/merge_requests/21`,
					updated_at: "2026-05-04T10:00:00Z",
				},
			]);
		}
		return {
			ok: false,
			status: 404,
			headers: { get: () => null },
			json: async () => ({}),
			text: async () => `unexpected ${parsed.pathname}`,
		};
	};
}

beforeAll(async () => {
	await runMigrations();
	fixture = await createGitlabFixture(tag);
});

afterAll(async () => {
	await cleanupGitlabFixture(fixture);
	await pool.end();
});

test("backfills branches, commits and merge requests through the paged API", async () => {
	const calls: { url: string; token?: string }[] = [];
	const api = new GitlabApi(
		"https://gitlab.example.test",
		"glpat-backfill",
		mockGitlab(calls),
	);

	const result = await backfillProject(api, projectPath, {
		now: new Date("2026-06-01T00:00:00Z"),
		days: 90,
	});

	expect(result).toEqual({
		path: projectPath,
		branches: 3,
		commits: 3,
		mergeRequests: 1,
	});
	expect(calls.length).toBe(6);
	expect(calls.every((call) => call.token === "glpat-backfill")).toBe(true);
	expect(calls.some((call) => call.url.includes("since=2026-03-03"))).toBe(
		true,
	);

	const branches = await db
		.select()
		.from(gitlabBranches)
		.where(eq(gitlabBranches.name, `${fixture.issueKey}-feature`));
	expect(branches).toHaveLength(1);

	const commits = await db
		.select()
		.from(gitlabCommits)
		.where(eq(gitlabCommits.sha, sha("a")));
	expect(commits).toHaveLength(1);
	expect(commits[0]?.authorEmail).toBe(fixture.userEmail);

	const mergeRequests = await db
		.select()
		.from(gitlabMergeRequests)
		.where(eq(gitlabMergeRequests.iid, 21));
	expect(mergeRequests).toHaveLength(1);
	expect(mergeRequests[0]?.state).toBe("opened");
	expect(mergeRequests[0]?.reviewers).toHaveLength(1);

	const development = await issueDevelopment(fixture.issueKey);
	expect(development?.counts).toEqual({
		branches: 2,
		commits: 2,
		mergeRequests: 1,
	});
});
