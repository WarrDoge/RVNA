import { and, eq, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.ts";
import { issues } from "../schema.ts";
import {
	gitlabCommitIssues,
	gitlabCommits,
	gitlabDeliveries,
	gitlabMergeRequests,
	gitlabPipelineIssues,
	gitlabPipelines,
} from "../schema-gitlab.ts";
import { applyMergeRequestTrigger, applySmartCommits } from "./automation.ts";
import { recordDelivery } from "./config.ts";
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

const gitlabUser = z
	.object({
		id: z.number().int().optional(),
		name: z.string().nullish(),
		username: z.string().nullish(),
		email: z.string().nullish(),
		state: z.string().nullish(),
	})
	.passthrough();

const project = z
	.object({
		id: z.number().int().nullish(),
		path_with_namespace: z.string(),
		web_url: z.string(),
		name: z.string().nullish(),
		default_branch: z.string().nullish(),
	})
	.passthrough();

const commit = z
	.object({
		id: z.string(),
		message: z.string().nullish(),
		title: z.string().nullish(),
		timestamp: z.string().nullish(),
		url: z.string().nullish(),
		author: z
			.object({
				name: z.string().nullish(),
				email: z.string().nullish(),
			})
			.passthrough()
			.nullish(),
	})
	.passthrough();

const pushPayload = z
	.object({
		ref: z.string(),
		project_id: z.number().int().nullish(),
		checkout_sha: z.string().nullish(),
		user_username: z.string().nullish(),
		user_email: z.string().nullish(),
		project,
		commits: z.array(commit).default([]),
	})
	.passthrough();

const mergeRequestPayload = z
	.object({
		project_id: z.number().int().nullish(),
		project,
		user: gitlabUser.nullish(),
		object_attributes: z
			.object({
				iid: z.number().int(),
				title: z.string(),
				state: z.string(),
				action: z.string().nullish(),
				source_branch: z.string().nullish(),
				target_branch: z.string().nullish(),
				url: z.string().nullish(),
				updated_at: z.string().nullish(),
				merged_at: z.string().nullish(),
				author: gitlabUser.nullish(),
				author_id: z.number().int().nullish(),
				approvals: z.number().int().nullish(),
			})
			.passthrough(),
		reviewers: z.array(gitlabUser).default([]),
	})
	.passthrough();

const pipelinePayload = z
	.object({
		project_id: z.number().int().nullish(),
		project,
		object_attributes: z
			.object({
				id: z.number().int(),
				ref: z.string(),
				sha: z.string(),
				status: z.string(),
				url: z.string().nullish(),
				created_at: z.string().nullish(),
			})
			.passthrough(),
	})
	.passthrough();

type PushPayload = z.infer<typeof pushPayload>;
type MergeRequestPayload = z.infer<typeof mergeRequestPayload>;
type PipelinePayload = z.infer<typeof pipelinePayload>;

function date(value: string | null | undefined) {
	if (!value) return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

interface DeliveryContext {
	deliveryId: string;
	projectKeys: string[];
	issueByKey: Map<string, IssueRef>;
	issueById: Map<string, IssueRef>;
}

async function repositoryFor(
	value: z.infer<typeof project>,
	projectId: number | null | undefined,
) {
	const id = value.id ?? projectId;
	if (!id) return null;
	return upsertRepository({
		id,
		path_with_namespace: value.path_with_namespace,
		name: value.name ?? null,
		web_url: value.web_url,
	});
}

async function deliveryContext(deliveryId: string): Promise<DeliveryContext> {
	const projectKeys = await loadProjectKeys();
	const rows = await db
		.select({
			id: issues.id,
			key: issues.key,
			projectId: issues.projectId,
			summary: issues.summary,
		})
		.from(issues);
	return {
		deliveryId,
		projectKeys,
		issueByKey: new Map(rows.map((row) => [row.key, row])),
		issueById: new Map(rows.map((row) => [row.id, row])),
	};
}

function issuesIn(context: DeliveryContext, text: string): IssueRef[] {
	return extractIssueKeys(text, context.projectKeys)
		.map((key) => context.issueByKey.get(key))
		.filter((issue): issue is IssueRef => issue !== undefined);
}

async function handlePush(
	context: DeliveryContext,
	payload: PushPayload,
): Promise<{ status: "processed" | "ignored"; reason?: string }> {
	if (!payload.ref.startsWith("refs/heads/")) {
		return { status: "ignored", reason: "tag pushes are not tracked" };
	}

	const branchName = payload.ref.slice("refs/heads/".length);
	const repository = await repositoryFor(payload.project, payload.project_id);
	if (!repository) return { status: "ignored", reason: "unknown project" };
	const branch = await upsertBranch(
		repository,
		branchName,
		payload.checkout_sha ?? null,
	);
	await linkBranch(branch.id, issuesIn(context, branchName));

	let linkedCommits = 0;
	for (const value of payload.commits) {
		const row = await upsertCommit(repository, {
			id: value.id,
			title: value.title,
			message: value.message,
			authorName: value.author?.name ?? null,
			authorEmail: value.author?.email ?? null,
			committedAt: date(value.timestamp),
			url: value.url,
		});
		// GitLab's message already starts with the title; joining both would
		// repeat every smart commit command.
		const message = value.message || value.title || "";
		const linked = issuesIn(context, message);
		if (linked.length === 0) continue;
		linkedCommits += 1;
		await linkCommit(row.id, linked);

		const claimed = await db
			.update(gitlabCommitIssues)
			.set({ smartCommitsApplied: true })
			.where(
				and(
					eq(gitlabCommitIssues.commitId, row.id),
					eq(gitlabCommitIssues.smartCommitsApplied, false),
					inArray(
						gitlabCommitIssues.issueId,
						linked.map((issue) => issue.id),
					),
				),
			)
			.returning({ issueId: gitlabCommitIssues.issueId });
		const claimedIds = new Set(claimed.map((link) => link.issueId));
		const pending = linked.filter((issue) => claimedIds.has(issue.id));
		if (pending.length === 0) continue;

		await applySmartCommits({
			deliveryId: context.deliveryId,
			repositoryId: repository.id,
			message,
			pusher: { email: payload.user_email, username: payload.user_username },
			committedAt: date(value.timestamp),
			projectKeys: context.projectKeys,
			issues: pending,
		});
	}

	return {
		status: "processed",
		reason: `${payload.commits.length} commit(s) on ${branchName}, ${linkedCommits} linked`,
	};
}

async function handleMergeRequest(
	context: DeliveryContext,
	payload: MergeRequestPayload,
): Promise<{ status: "processed" | "ignored"; reason?: string }> {
	const attributes = payload.object_attributes;
	const repository = await repositoryFor(payload.project, payload.project_id);
	if (!repository) return { status: "ignored", reason: "unknown project" };

	const [existing] = await db
		.select({
			id: gitlabMergeRequests.id,
			approvals: gitlabMergeRequests.approvals,
			authorName: gitlabMergeRequests.authorName,
			authorEmail: gitlabMergeRequests.authorEmail,
		})
		.from(gitlabMergeRequests)
		.where(
			and(
				eq(gitlabMergeRequests.repositoryId, repository.id),
				eq(gitlabMergeRequests.iid, attributes.iid),
			),
		)
		.limit(1);

	const approvedReviewers = payload.reviewers.filter(
		(reviewer) => reviewer.state === "approved",
	).length;
	let approvals: number;
	if (attributes.approvals != null) {
		approvals = attributes.approvals;
	} else if (payload.reviewers.length > 0) {
		approvals = approvedReviewers;
	} else if (
		attributes.action === "approval" ||
		attributes.action === "approved"
	) {
		approvals = (existing?.approvals ?? 0) + 1;
	} else if (
		attributes.action === "unapproval" ||
		attributes.action === "unapproved"
	) {
		approvals = Math.max(0, (existing?.approvals ?? 0) - 1);
	} else {
		approvals = existing?.approvals ?? 0;
	}

	const authorName =
		attributes.author?.name ??
		existing?.authorName ??
		payload.user?.name ??
		null;
	const authorEmail =
		attributes.author?.email ??
		existing?.authorEmail ??
		payload.user?.email ??
		null;
	const reviewers = payload.reviewers.map((reviewer) => ({
		name: reviewer.name ?? null,
		username: reviewer.username ?? null,
		email: reviewer.email ?? null,
	}));
	const webUrl =
		attributes.url ?? `${repository.webUrl}/-/merge_requests/${attributes.iid}`;
	const [row] = await db
		.insert(gitlabMergeRequests)
		.values({
			repositoryId: repository.id,
			iid: attributes.iid,
			title: attributes.title,
			state: normalizeMergeRequestState(attributes.state),
			sourceBranch: attributes.source_branch ?? null,
			targetBranch: attributes.target_branch ?? null,
			authorName,
			authorEmail,
			reviewers,
			approvals,
			webUrl,
			gitlabUpdatedAt: date(attributes.updated_at),
		})
		.onConflictDoUpdate({
			target: [gitlabMergeRequests.repositoryId, gitlabMergeRequests.iid],
			set: {
				title: attributes.title,
				state: normalizeMergeRequestState(attributes.state),
				sourceBranch: attributes.source_branch ?? null,
				targetBranch: attributes.target_branch ?? null,
				authorName,
				authorEmail,
				reviewers,
				approvals,
				webUrl,
				gitlabUpdatedAt: date(attributes.updated_at),
				updatedAt: new Date(),
			},
		})
		.returning();

	const linked = issuesIn(
		context,
		[attributes.title, attributes.source_branch, attributes.target_branch]
			.filter(Boolean)
			.join("\n"),
	);
	await linkMergeRequest(row.id, linked);

	const actor = payload.user ?? attributes.author ?? null;
	const state = normalizeMergeRequestState(attributes.state);
	if (attributes.action === "open") {
		await applyMergeRequestTrigger({
			deliveryId: context.deliveryId,
			repositoryId: repository.id,
			mergeRequestId: row.id,
			kind: "merge_request_opened",
			actor,
			issues: linked,
		});
	}
	if (
		state === "merged" &&
		!["close", "reopen"].includes(attributes.action ?? "")
	) {
		await applyMergeRequestTrigger({
			deliveryId: context.deliveryId,
			repositoryId: repository.id,
			mergeRequestId: row.id,
			kind: "merge_request_merged",
			actor,
			issues: linked,
		});
	}

	return {
		status: "processed",
		reason: `!${attributes.iid} ${state}, ${linked.length} linked issue(s)`,
	};
}

async function handlePipeline(
	context: DeliveryContext,
	payload: PipelinePayload,
): Promise<{ status: "processed" | "ignored"; reason?: string }> {
	const attributes = payload.object_attributes;
	const repository = await repositoryFor(payload.project, payload.project_id);
	if (!repository) return { status: "ignored", reason: "unknown project" };
	const [row] = await db
		.insert(gitlabPipelines)
		.values({
			repositoryId: repository.id,
			gitlabId: attributes.id,
			status: attributes.status,
			ref: attributes.ref,
			sha: attributes.sha,
			webUrl:
				attributes.url ?? `${repository.webUrl}/-/pipelines/${attributes.id}`,
			gitlabCreatedAt: date(attributes.created_at),
		})
		.onConflictDoUpdate({
			target: [gitlabPipelines.repositoryId, gitlabPipelines.gitlabId],
			set: {
				status: attributes.status,
				ref: attributes.ref,
				sha: attributes.sha,
				webUrl:
					attributes.url ?? `${repository.webUrl}/-/pipelines/${attributes.id}`,
				gitlabCreatedAt: date(attributes.created_at),
				updatedAt: new Date(),
			},
		})
		.returning();

	const linked = new Map<string, IssueRef>();
	for (const issue of issuesIn(context, attributes.ref)) {
		linked.set(issue.id, issue);
	}
	const commits = await db
		.select({ id: gitlabCommits.id })
		.from(gitlabCommits)
		.where(
			and(
				eq(gitlabCommits.repositoryId, repository.id),
				eq(gitlabCommits.sha, attributes.sha),
			),
		);
	for (const value of commits) {
		const rows = await db
			.select({ issueId: gitlabCommitIssues.issueId })
			.from(gitlabCommitIssues)
			.where(eq(gitlabCommitIssues.commitId, value.id));
		for (const link of rows) {
			const issue = context.issueById.get(link.issueId);
			if (issue) linked.set(issue.id, issue);
		}
	}
	await db.transaction(async (tx) => {
		await tx
			.delete(gitlabPipelineIssues)
			.where(eq(gitlabPipelineIssues.pipelineId, row.id));
		if (linked.size > 0) {
			await tx
				.insert(gitlabPipelineIssues)
				.values(
					[...linked.values()].map((issue) => ({
						pipelineId: row.id,
						issueId: issue.id,
					})),
				)
				.onConflictDoNothing();
		}
	});

	return {
		status: "processed",
		reason: `pipeline ${attributes.id} ${attributes.status} on ${attributes.ref}`,
	};
}

async function handleNote(): Promise<{
	status: "processed" | "ignored";
	reason?: string;
}> {
	return { status: "ignored", reason: "note events carry no development data" };
}

export type DeliveryResult = {
	status: "processed" | "ignored";
	reason?: string;
};

const EVENT_KIND_BY_HEADER: Record<string, string> = {
	"Push Hook": "push",
	"Tag Push Hook": "tag_push",
	"Merge Request Hook": "merge_request",
	"Pipeline Hook": "pipeline",
	"Note Hook": "note",
};

export async function handleGitlabEvent(
	header: string,
	payload: unknown,
	deliveryId: string,
): Promise<DeliveryResult> {
	const objectKind =
		typeof payload === "object" && payload !== null
			? String(
					(payload as { object_kind?: unknown; event_name?: unknown })
						.object_kind ??
						(payload as { event_name?: unknown }).event_name ??
						"",
				)
			: "";

	const kind =
		header === "System Hook"
			? objectKind
			: (EVENT_KIND_BY_HEADER[header] ?? objectKind);

	let context: Promise<DeliveryContext> | null = null;
	const contextFor = () => (context ??= deliveryContext(deliveryId));

	if (kind === "push") {
		const parsed = pushPayload.safeParse(payload);
		if (!parsed.success) {
			return { status: "ignored", reason: "unreadable push payload" };
		}
		return handlePush(await contextFor(), parsed.data);
	}
	if (kind === "tag_push") {
		return { status: "ignored", reason: "tag pushes are not tracked" };
	}
	if (kind === "merge_request") {
		const parsed = mergeRequestPayload.safeParse(payload);
		if (!parsed.success) {
			return { status: "ignored", reason: "unreadable merge request payload" };
		}
		return handleMergeRequest(await contextFor(), parsed.data);
	}
	if (kind === "pipeline") {
		const parsed = pipelinePayload.safeParse(payload);
		if (!parsed.success) {
			return { status: "ignored", reason: "unreadable pipeline payload" };
		}
		return handlePipeline(await contextFor(), parsed.data);
	}
	if (kind === "note") {
		return handleNote();
	}

	return { status: "ignored", reason: `unknown event ${header || kind}` };
}

export async function processGitlabDelivery(deliveryId: string) {
	const now = new Date();
	const [delivery] = await db
		.update(gitlabDeliveries)
		.set({ status: "processing", startedAt: now })
		.where(
			and(
				eq(gitlabDeliveries.id, deliveryId),
				or(
					inArray(gitlabDeliveries.status, ["queued", "failed"]),
					and(
						eq(gitlabDeliveries.status, "processing"),
						lt(
							gitlabDeliveries.startedAt,
							new Date(now.getTime() - 5 * 60 * 1000),
						),
					),
				),
			),
		)
		.returning();
	if (!delivery) return;

	const claimedAt = delivery.startedAt;
	if (!claimedAt) return;
	const owned = and(
		eq(gitlabDeliveries.id, delivery.id),
		eq(gitlabDeliveries.startedAt, claimedAt),
	);

	let result: DeliveryResult;
	try {
		result = await handleGitlabEvent(
			delivery.event,
			delivery.payload,
			delivery.id,
		);
		const [updated] = await db
			.update(gitlabDeliveries)
			.set({
				status: result.status,
				reason: result.reason ?? null,
				processedAt: new Date(),
			})
			.where(owned)
			.returning({ id: gitlabDeliveries.id });
		if (!updated) return;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const [updated] = await db
			.update(gitlabDeliveries)
			.set({ status: "failed", reason: message, processedAt: new Date() })
			.where(owned)
			.returning({ id: gitlabDeliveries.id });
		if (updated) {
			await recordDelivery(`${delivery.event}: failed`).catch(() => undefined);
		}
		throw error;
	}
	await recordDelivery(`${delivery.event}: ${result.status}`).catch(
		() => undefined,
	);
}
