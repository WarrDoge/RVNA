import { db } from "../db.ts";
import { issues } from "../schema.ts";
import { gitlabMergeRequests } from "../schema-gitlab.ts";
import type { GitlabApi, GitlabCommit, GitlabMergeRequest } from "./client.ts";
import { normalizeMergeRequestState } from "./development.ts";
import { extractIssueKeys, type IssueRef, loadProjectKeys } from "./keys.ts";
import {
	linkBranch,
	linkCommit,
	linkMergeRequest,
	upsertBranch,
	upsertCommit,
	upsertRepository,
} from "./store.ts";

export interface BackfillResult {
	path: string;
	branches: number;
	commits: number;
	mergeRequests: number;
}

async function* pages<T>(
	fetchPage: (page: number) => Promise<{ items: T[]; nextPage: number | null }>,
) {
	let page = 1;
	for (;;) {
		const result = await fetchPage(page);
		yield result.items;
		if (!result.nextPage || result.nextPage <= page) return;
		page = result.nextPage;
	}
}

function date(value: string | null) {
	if (!value) return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function commitInput(value: GitlabCommit) {
	return {
		id: value.id,
		title: value.title,
		message: value.message,
		authorName: value.author_name,
		authorEmail: value.author_email,
		committedAt: date(value.committed_date),
		url: value.web_url,
	};
}

async function upsertMergeRequest(
	repositoryId: string,
	value: GitlabMergeRequest,
) {
	const [row] = await db
		.insert(gitlabMergeRequests)
		.values({
			repositoryId,
			iid: value.iid,
			title: value.title,
			state: normalizeMergeRequestState(value.state),
			sourceBranch: value.source_branch,
			targetBranch: value.target_branch,
			authorName: value.author?.name ?? null,
			authorEmail: value.author?.email ?? null,
			reviewers: (value.reviewers ?? []).map((reviewer) => ({
				name: reviewer.name,
				email: reviewer.email ?? null,
			})),
			approvals: 0,
			webUrl: value.web_url,
			gitlabUpdatedAt: date(value.updated_at),
		})
		.onConflictDoUpdate({
			target: [gitlabMergeRequests.repositoryId, gitlabMergeRequests.iid],
			set: {
				title: value.title,
				state: normalizeMergeRequestState(value.state),
				sourceBranch: value.source_branch,
				targetBranch: value.target_branch,
				authorName: value.author?.name ?? null,
				authorEmail: value.author?.email ?? null,
				reviewers: (value.reviewers ?? []).map((reviewer) => ({
					name: reviewer.name,
					email: reviewer.email ?? null,
				})),
				webUrl: value.web_url,
				gitlabUpdatedAt: date(value.updated_at),
				updatedAt: new Date(),
			},
		})
		.returning();
	return row;
}

/**
 * Reads a project from GitLab's REST API and stores branches, the last 90 days
 * of commits and merge requests. It only links issues; smart commits and merge
 * request triggers are left to live webhook deliveries.
 */
export async function backfillProject(
	api: GitlabApi,
	path: string,
	options: { now?: Date; days?: number } = {},
): Promise<BackfillResult> {
	const project = await api.project(path);
	const repository = await upsertRepository(project);

	const projectKeys = await loadProjectKeys();
	const issueRows = await db
		.select({
			id: issues.id,
			key: issues.key,
			projectId: issues.projectId,
			summary: issues.summary,
		})
		.from(issues);
	const issueByKey = new Map(issueRows.map((row) => [row.key, row]));
	const linked = (text: string): IssueRef[] =>
		extractIssueKeys(text, projectKeys)
			.map((key) => issueByKey.get(key))
			.filter((issue): issue is IssueRef => issue !== undefined);

	const since = new Date(
		(options.now ?? new Date()).getTime() -
			(options.days ?? 90) * 24 * 60 * 60 * 1000,
	).toISOString();

	let branches = 0;
	for await (const items of pages((page) => api.branches(project.id, page))) {
		for (const branch of items) {
			const row = await upsertBranch(
				repository,
				branch.name,
				branch.commit?.id ?? null,
			);
			await linkBranch(row.id, linked(branch.name));
			branches += 1;
		}
	}

	let commits = 0;
	for await (const items of pages((page) =>
		api.commits(project.id, since, page),
	)) {
		for (const commit of items) {
			const row = await upsertCommit(repository, commitInput(commit));
			await linkCommit(
				row.id,
				linked([commit.title, commit.message].filter(Boolean).join("\n")),
			);
			commits += 1;
		}
	}

	let mergeRequests = 0;
	for await (const items of pages((page) =>
		api.mergeRequests(project.id, page),
	)) {
		for (const mergeRequest of items) {
			const row = await upsertMergeRequest(repository.id, mergeRequest);
			await linkMergeRequest(
				row.id,
				linked(
					[
						mergeRequest.title,
						mergeRequest.source_branch,
						mergeRequest.target_branch,
					]
						.filter(Boolean)
						.join("\n"),
				),
			);
			mergeRequests += 1;
		}
	}

	return {
		path: project.path_with_namespace,
		branches,
		commits,
		mergeRequests,
	};
}
