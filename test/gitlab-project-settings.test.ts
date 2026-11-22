import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	projectGitlabSettings,
	saveProjectGitlabSettings,
} from "../src/lib/server/gitlab/project-settings.ts";
import {
	gitlabProjectRepositories,
	gitlabRepositories,
} from "../src/lib/server/schema-gitlab.ts";
import {
	cleanupGitlabFixture,
	createGitlabFixture,
	type GitlabFixture,
	linkFixtureRepository,
	uniqueTag,
} from "./gitlab-fixtures.ts";

const tag = uniqueTag();
let fixture: GitlabFixture;
let repositoryId: string;
let otherRepositoryId: string;

function settings(overrides: Record<string, unknown> = {}) {
	return {
		linkedRepositoryIds: [repositoryId],
		defaultRepositoryId: repositoryId,
		smartCommitsEnabled: false,
		mergeRequestOpenedEnabled: false,
		mergeRequestOpenedTransitions: [],
		mergeRequestMergedEnabled: false,
		mergeRequestMergedTransitions: [],
		...overrides,
	};
}

beforeAll(async () => {
	await runMigrations();
	fixture = await createGitlabFixture(tag);
	repositoryId = await linkFixtureRepository(fixture);
	const [other] = await db
		.insert(gitlabRepositories)
		.values({
			gitlabProjectId: 515_151,
			path: `${tag}/other`,
			name: "other",
			webUrl: `https://gitlab.example.test/${tag}/other`,
		})
		.returning();
	otherRepositoryId = other.id;
	await db
		.insert(gitlabProjectRepositories)
		.values({ projectId: fixture.projectId, repositoryId: otherRepositoryId });
});

afterAll(async () => {
	await cleanupGitlabFixture(fixture);
	await pool.end();
});

test("a default repository that is no longer linked falls back to a linked one", async () => {
	await saveProjectGitlabSettings(
		fixture.projectId,
		settings({
			linkedRepositoryIds: [repositoryId, otherRepositoryId],
			defaultRepositoryId: repositoryId,
		}),
	);
	await db
		.delete(gitlabProjectRepositories)
		.where(
			and(
				eq(gitlabProjectRepositories.projectId, fixture.projectId),
				eq(gitlabProjectRepositories.repositoryId, repositoryId),
			),
		);

	const stored = await projectGitlabSettings(fixture.projectId);
	expect(stored.linkedRepositoryIds).toEqual([otherRepositoryId]);
	expect(stored.defaultRepositoryId).toBe(otherRepositoryId);

	await db
		.delete(gitlabProjectRepositories)
		.where(eq(gitlabProjectRepositories.projectId, fixture.projectId));
	const empty = await projectGitlabSettings(fixture.projectId);
	expect(empty.defaultRepositoryId).toBeNull();
});

test("only transition names from the project workflow are stored", async () => {
	await saveProjectGitlabSettings(
		fixture.projectId,
		settings({
			mergeRequestOpenedEnabled: true,
			mergeRequestOpenedTransitions: [
				"No such transition",
				"start progress",
				"Start progress",
				"Finish",
			],
			mergeRequestMergedEnabled: true,
			mergeRequestMergedTransitions: ["Reopen", "Reopen", "Missing"],
		}),
	);

	const stored = await projectGitlabSettings(fixture.projectId);
	expect(stored.mergeRequestOpenedTransitions).toEqual([
		"Start progress",
		"Finish",
	]);
	expect(stored.mergeRequestMergedTransitions).toEqual(["Reopen"]);
});

test("only the submitted repository ids are checked", async () => {
	const unknown = randomUUID();
	await saveProjectGitlabSettings(
		fixture.projectId,
		settings({
			linkedRepositoryIds: [repositoryId, unknown],
			defaultRepositoryId: unknown,
		}),
	);

	const stored = await projectGitlabSettings(fixture.projectId);
	expect(stored.linkedRepositoryIds).toEqual([repositoryId]);
	expect(stored.defaultRepositoryId).toBe(repositoryId);
});
