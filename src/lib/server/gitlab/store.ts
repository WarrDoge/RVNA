import { db } from "../db.ts";
import {
	gitlabBranches,
	gitlabBranchIssues,
	gitlabCommitIssues,
	gitlabCommits,
	gitlabMergeRequestIssues,
	gitlabRepositories,
} from "../schema-gitlab.ts";
import type { IssueRef } from "./keys.ts";

export interface RepositoryInput {
	id: number;
	path_with_namespace: string;
	name?: string | null;
	web_url: string;
}

export type Repository = typeof gitlabRepositories.$inferSelect;

export async function upsertRepository(value: RepositoryInput) {
	const webUrl = value.web_url.replace(/\/+$/, "");
	const [row] = await db
		.insert(gitlabRepositories)
		.values({
			gitlabProjectId: value.id,
			path: value.path_with_namespace,
			name: value.name ?? null,
			webUrl,
		})
		.onConflictDoUpdate({
			target: gitlabRepositories.gitlabProjectId,
			set: {
				path: value.path_with_namespace,
				name: value.name ?? null,
				webUrl,
				updatedAt: new Date(),
			},
		})
		.returning();
	return row;
}

export function branchUrl(repository: Repository, name: string) {
	return `${repository.webUrl}/-/tree/${encodeURIComponent(name)}`;
}

export async function upsertBranch(
	repository: Repository,
	name: string,
	sha: string | null,
) {
	const [row] = await db
		.insert(gitlabBranches)
		.values({
			repositoryId: repository.id,
			name,
			webUrl: branchUrl(repository, name),
			lastCommitSha: sha,
		})
		.onConflictDoUpdate({
			target: [gitlabBranches.repositoryId, gitlabBranches.name],
			set: {
				webUrl: branchUrl(repository, name),
				lastCommitSha: sha ?? undefined,
				updatedAt: new Date(),
			},
		})
		.returning();
	return row;
}

export async function linkBranch(branchId: string, linked: IssueRef[]) {
	if (linked.length === 0) return;
	await db
		.insert(gitlabBranchIssues)
		.values(linked.map((issue) => ({ branchId, issueId: issue.id })))
		.onConflictDoNothing();
}

export interface CommitInput {
	id: string;
	title?: string | null;
	message?: string | null;
	authorName?: string | null;
	authorEmail?: string | null;
	committedAt?: Date | null;
	url?: string | null;
}

export async function upsertCommit(repository: Repository, value: CommitInput) {
	const title = value.title ?? value.message?.split("\n")[0] ?? value.id;
	const webUrl = value.url ?? `${repository.webUrl}/-/commit/${value.id}`;
	const [row] = await db
		.insert(gitlabCommits)
		.values({
			repositoryId: repository.id,
			sha: value.id,
			title,
			message: value.message ?? null,
			authorName: value.authorName ?? null,
			authorEmail: value.authorEmail ?? null,
			committedAt: value.committedAt ?? null,
			webUrl,
		})
		.onConflictDoUpdate({
			target: [gitlabCommits.repositoryId, gitlabCommits.sha],
			set: {
				title,
				message: value.message ?? null,
				authorName: value.authorName ?? null,
				authorEmail: value.authorEmail ?? null,
				committedAt: value.committedAt ?? null,
				webUrl,
				updatedAt: new Date(),
			},
		})
		.returning();
	return row;
}

export async function linkCommit(commitId: string, linked: IssueRef[]) {
	if (linked.length === 0) return;
	await db
		.insert(gitlabCommitIssues)
		.values(linked.map((issue) => ({ commitId, issueId: issue.id })))
		.onConflictDoNothing();
}

export async function linkMergeRequest(
	mergeRequestId: string,
	linked: IssueRef[],
) {
	if (linked.length === 0) return;
	await db
		.insert(gitlabMergeRequestIssues)
		.values(linked.map((issue) => ({ mergeRequestId, issueId: issue.id })))
		.onConflictDoNothing();
}
