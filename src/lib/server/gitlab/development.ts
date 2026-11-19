import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db.ts";
import { issues } from "../schema.ts";
import {
	gitlabBranches,
	gitlabBranchIssues,
	gitlabCommitIssues,
	gitlabCommits,
	gitlabMergeRequestIssues,
	gitlabMergeRequests,
	gitlabPipelineIssues,
	gitlabPipelines,
	gitlabProjectRepositories,
	gitlabProjectSettings,
	gitlabRepositories,
} from "../schema-gitlab.ts";
import { branchNameFor } from "./keys.ts";

export type MergeRequestLozenge = "OPEN" | "MERGED" | "DECLINED";

export function normalizeMergeRequestState(
	state: string,
): "opened" | "merged" | "closed" | "locked" {
	return state === "merged" || state === "closed" || state === "locked"
		? state
		: "opened";
}

export function mergeRequestLozenge(state: string): MergeRequestLozenge | null {
	if (state === "opened") return "OPEN";
	if (state === "merged" || state === "locked") return "MERGED";
	if (state === "closed") return "DECLINED";
	return null;
}

export function dominantMergeRequestState(
	states: string[],
): MergeRequestLozenge | null {
	const lozenges = states
		.map(mergeRequestLozenge)
		.filter((value): value is MergeRequestLozenge => value !== null);
	if (lozenges.includes("OPEN")) return "OPEN";
	if (lozenges.includes("MERGED")) return "MERGED";
	if (lozenges.includes("DECLINED")) return "DECLINED";
	return null;
}

export async function issueDevelopment(key: string) {
	const [issue] = await db
		.select({
			id: issues.id,
			key: issues.key,
			summary: issues.summary,
			projectId: issues.projectId,
		})
		.from(issues)
		.where(eq(issues.key, key.toUpperCase()))
		.limit(1);
	if (!issue) return null;

	const repositoryColumns = {
		id: gitlabRepositories.id,
		path: gitlabRepositories.path,
		webUrl: gitlabRepositories.webUrl,
	};

	const [
		branches,
		commits,
		mergeRequests,
		branchCount,
		commitCount,
		mergeRequestCount,
	] = await Promise.all([
		db
			.select({
				id: gitlabBranches.id,
				name: gitlabBranches.name,
				webUrl: gitlabBranches.webUrl,
				updatedAt: gitlabBranches.updatedAt,
				repository: repositoryColumns,
			})
			.from(gitlabBranchIssues)
			.innerJoin(
				gitlabBranches,
				eq(gitlabBranches.id, gitlabBranchIssues.branchId),
			)
			.innerJoin(
				gitlabRepositories,
				eq(gitlabRepositories.id, gitlabBranches.repositoryId),
			)
			.where(eq(gitlabBranchIssues.issueId, issue.id))
			.orderBy(desc(gitlabBranches.updatedAt))
			.limit(200),
		db
			.select({
				id: gitlabCommits.id,
				sha: gitlabCommits.sha,
				title: gitlabCommits.title,
				authorName: gitlabCommits.authorName,
				committedAt: gitlabCommits.committedAt,
				webUrl: gitlabCommits.webUrl,
				repository: repositoryColumns,
			})
			.from(gitlabCommitIssues)
			.innerJoin(
				gitlabCommits,
				eq(gitlabCommits.id, gitlabCommitIssues.commitId),
			)
			.innerJoin(
				gitlabRepositories,
				eq(gitlabRepositories.id, gitlabCommits.repositoryId),
			)
			.where(eq(gitlabCommitIssues.issueId, issue.id))
			.orderBy(sql`${gitlabCommits.committedAt} desc nulls last`)
			.limit(200),
		db
			.select({
				id: gitlabMergeRequests.id,
				iid: gitlabMergeRequests.iid,
				title: gitlabMergeRequests.title,
				state: gitlabMergeRequests.state,
				approvals: gitlabMergeRequests.approvals,
				authorName: gitlabMergeRequests.authorName,
				webUrl: gitlabMergeRequests.webUrl,
				updatedAt: gitlabMergeRequests.updatedAt,
				repository: repositoryColumns,
			})
			.from(gitlabMergeRequestIssues)
			.innerJoin(
				gitlabMergeRequests,
				eq(gitlabMergeRequests.id, gitlabMergeRequestIssues.mergeRequestId),
			)
			.innerJoin(
				gitlabRepositories,
				eq(gitlabRepositories.id, gitlabMergeRequests.repositoryId),
			)
			.where(eq(gitlabMergeRequestIssues.issueId, issue.id))
			.orderBy(desc(gitlabMergeRequests.updatedAt))
			.limit(200),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(gitlabBranchIssues)
			.where(eq(gitlabBranchIssues.issueId, issue.id)),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(gitlabCommitIssues)
			.where(eq(gitlabCommitIssues.issueId, issue.id)),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(gitlabMergeRequestIssues)
			.where(eq(gitlabMergeRequestIssues.issueId, issue.id)),
	]);

	const [pipeline] = await db
		.select({
			id: gitlabPipelines.id,
			status: gitlabPipelines.status,
			ref: gitlabPipelines.ref,
			webUrl: gitlabPipelines.webUrl,
			createdAt: gitlabPipelines.createdAt,
		})
		.from(gitlabPipelineIssues)
		.innerJoin(
			gitlabPipelines,
			eq(gitlabPipelines.id, gitlabPipelineIssues.pipelineId),
		)
		.where(eq(gitlabPipelineIssues.issueId, issue.id))
		.orderBy(desc(gitlabPipelines.createdAt), desc(gitlabPipelines.gitlabId))
		.limit(1);

	const [settings] = await db
		.select({
			defaultRepositoryId: gitlabProjectSettings.defaultRepositoryId,
		})
		.from(gitlabProjectSettings)
		.where(eq(gitlabProjectSettings.projectId, issue.projectId))
		.limit(1);

	let createBranch: { name: string; url: string } | null = null;
	const linked = await db
		.select({ repositoryId: gitlabProjectRepositories.repositoryId })
		.from(gitlabProjectRepositories)
		.where(eq(gitlabProjectRepositories.projectId, issue.projectId));
	const linkedIds = linked.map((row) => row.repositoryId);
	const defaultId =
		settings?.defaultRepositoryId &&
		linkedIds.includes(settings.defaultRepositoryId)
			? settings.defaultRepositoryId
			: null;
	if (defaultId) {
		const [repository] = await db
			.select({ webUrl: gitlabRepositories.webUrl })
			.from(gitlabRepositories)
			.where(eq(gitlabRepositories.id, defaultId))
			.limit(1);
		if (repository) {
			const name = branchNameFor(issue.key, issue.summary);
			createBranch = {
				name,
				url: `${repository.webUrl}/-/branches/new?branch_name=${encodeURIComponent(name)}`,
			};
		}
	}

	const latestCommit = commits[0] ?? null;

	return {
		counts: {
			branches: branchCount[0]?.count ?? 0,
			commits: commitCount[0]?.count ?? 0,
			mergeRequests: mergeRequestCount[0]?.count ?? 0,
		},
		mergeRequestState: dominantMergeRequestState(
			mergeRequests.map((mergeRequest) => mergeRequest.state),
		),
		latestPipeline: pipeline
			? { ...pipeline, createdAt: pipeline.createdAt.toISOString() }
			: null,
		latestCommit: latestCommit
			? {
					sha: latestCommit.sha,
					title: latestCommit.title,
					webUrl: latestCommit.webUrl,
					committedAt: latestCommit.committedAt?.toISOString() ?? null,
				}
			: null,
		createBranch,
		branches: branches.map((branch) => ({
			id: branch.id,
			name: branch.name,
			webUrl: branch.webUrl,
			updatedAt: branch.updatedAt.toISOString(),
			repository: branch.repository,
		})),
		commits: commits.map((commit) => ({
			id: commit.id,
			sha: commit.sha,
			title: commit.title,
			webUrl: commit.webUrl,
			authorName: commit.authorName,
			committedAt: commit.committedAt?.toISOString() ?? null,
			repository: commit.repository,
		})),
		mergeRequests: mergeRequests.map((mergeRequest) => ({
			id: mergeRequest.id,
			iid: mergeRequest.iid,
			title: mergeRequest.title,
			state: mergeRequest.state,
			lozenge: mergeRequestLozenge(mergeRequest.state),
			approvals: mergeRequest.approvals,
			authorName: mergeRequest.authorName,
			webUrl: mergeRequest.webUrl,
			updatedAt: mergeRequest.updatedAt.toISOString(),
			repository: mergeRequest.repository,
		})),
	};
}
