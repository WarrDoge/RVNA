import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/lib/server/db.ts";
import { processGitlabDelivery } from "../src/lib/server/gitlab/events.ts";
import {
	issues,
	issueTypes,
	projectIssueTypes,
	projectRoleActors,
	projects,
	projectWorkflows,
	statuses,
	users,
	workflowStatuses,
	workflows,
	workflowTransitions,
} from "../src/lib/server/schema.ts";
import {
	gitlabDeliveries,
	gitlabProjectRepositories,
	gitlabRepositories,
} from "../src/lib/server/schema-gitlab.ts";
import type { TestApp } from "./server.ts";

export interface GitlabFixture {
	tag: string;
	projectId: string;
	projectKey: string;
	issueId: string;
	issueKey: string;
	userId: string;
	userEmail: string;
	transitions: Record<string, string>;
}

export async function createGitlabFixture(
	tag: string,
	options: { summary?: string; key?: string; member?: boolean } = {},
): Promise<GitlabFixture> {
	const projectKey = options.key ?? `G${tag.slice(2).toUpperCase()}`;
	const userEmail = `${tag}@example.test`;
	const [user] = await db
		.insert(users)
		.values({
			username: `gl-${tag}`,
			email: userEmail,
			displayName: "GitLab Tester",
			active: true,
		})
		.returning();

	const [task] = await db
		.insert(issueTypes)
		.values({ sourceId: `${tag}:type:task`, name: `${tag} Task` })
		.returning();

	const statusRows = await db
		.insert(statuses)
		.values([
			{ sourceId: `${tag}:status:todo`, name: `${tag} To Do`, category: "new" },
			{
				sourceId: `${tag}:status:progress`,
				name: `${tag} In Progress`,
				category: "indeterminate",
			},
			{ sourceId: `${tag}:status:done`, name: `${tag} Done`, category: "done" },
		])
		.returning();

	const [workflow] = await db
		.insert(workflows)
		.values({ sourceId: `${tag}:workflow`, name: `${tag} workflow` })
		.returning();
	await db.insert(workflowStatuses).values(
		statusRows.map((status) => ({
			sourceId: `${tag}:workflow-status:${status.id}`,
			workflowId: workflow.id,
			statusId: status.id,
		})),
	);

	const transitionRows = await db
		.insert(workflowTransitions)
		.values([
			{
				sourceId: `${tag}:transition:start`,
				workflowId: workflow.id,
				name: "Start progress",
				fromStatusId: statusRows[0].id,
				toStatusId: statusRows[1].id,
				sequence: 0,
			},
			{
				sourceId: `${tag}:transition:finish`,
				workflowId: workflow.id,
				name: "Finish",
				fromStatusId: statusRows[1].id,
				toStatusId: statusRows[2].id,
				sequence: 1,
			},
			{
				sourceId: `${tag}:transition:reopen`,
				workflowId: workflow.id,
				name: "Reopen",
				fromStatusId: statusRows[2].id,
				toStatusId: statusRows[1].id,
				sequence: 2,
			},
		])
		.returning();

	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `${tag}:project`,
			key: projectKey,
			name: `${tag} project`,
			projectType: "software",
		})
		.returning();
	await db.insert(projectIssueTypes).values({
		sourceId: `${tag}:project-type`,
		projectId: project.id,
		issueTypeId: task.id,
	});
	await db.insert(projectWorkflows).values({
		sourceId: `${tag}:project-workflow`,
		projectId: project.id,
		issueTypeId: null,
		workflowId: workflow.id,
	});
	if (options.member !== false) {
		await db.insert(projectRoleActors).values({
			sourceId: `${tag}:project-member`,
			projectId: project.id,
			roleId: "member",
			roleName: "member",
			actorType: "user",
			actorParameter: user.username,
			actorDisplayName: user.displayName,
			raw: { role: "member", actor: user.username },
		});
	}

	const [issue] = await db
		.insert(issues)
		.values({
			sourceId: `${tag}:issue:1`,
			projectId: project.id,
			number: 1,
			key: `${projectKey}-1`,
			typeId: task.id,
			statusId: statusRows[0].id,
			summary: options.summary ?? `${tag} test issue`,
			created: new Date("2026-01-01T00:00:00Z"),
			updated: new Date("2026-01-01T00:00:00Z"),
		})
		.returning();

	return {
		tag,
		projectId: project.id,
		projectKey,
		issueId: issue.id,
		issueKey: issue.key,
		userId: user.id,
		userEmail,
		transitions: Object.fromEntries(
			transitionRows.map((row) => [row.name, row.id]),
		),
	};
}

function gitlabProjectIdFor(tag: string) {
	let hash = 0;
	for (const character of tag) {
		hash = (hash * 31 + character.charCodeAt(0)) % 1_000_000;
	}
	return 1000 + hash;
}

export function projectPayload(fixture: GitlabFixture, path?: string) {
	return {
		id: gitlabProjectIdFor(fixture.tag),
		path_with_namespace: path ?? `${fixture.tag}/service`,
		name: "service",
		web_url: `https://gitlab.example.test/${path ?? `${fixture.tag}/service`}`,
		default_branch: "main",
	};
}

/** The repository the fixture's payload names, linked to its project. */
export async function linkFixtureRepository(fixture: GitlabFixture) {
	const payload = projectPayload(fixture);
	const [repository] = await db
		.insert(gitlabRepositories)
		.values({
			gitlabProjectId: payload.id,
			path: payload.path_with_namespace,
			name: payload.name,
			webUrl: payload.web_url,
		})
		.onConflictDoUpdate({
			target: gitlabRepositories.gitlabProjectId,
			set: {
				path: payload.path_with_namespace,
				name: payload.name,
				webUrl: payload.web_url,
				updatedAt: new Date(),
			},
		})
		.returning();
	await db
		.insert(gitlabProjectRepositories)
		.values({ projectId: fixture.projectId, repositoryId: repository.id })
		.onConflictDoNothing();
	return repository.id;
}

export function pushPayload(
	fixture: GitlabFixture,
	branch: string,
	commits: {
		sha: string;
		title: string;
		message?: string;
		email?: string | null;
		timestamp?: string;
	}[],
	/** The GitLab account that pushed; the commit authors only carry display names. */
	pusher: { email?: string | null; username?: string | null } = {},
) {
	return {
		object_kind: "push",
		ref: `refs/heads/${branch}`,
		checkout_sha: commits.at(-1)?.sha ?? null,
		user_username: pusher.username === undefined ? null : pusher.username,
		user_email: pusher.email === undefined ? fixture.userEmail : pusher.email,
		project: projectPayload(fixture),
		commits: commits.map((commit) => ({
			id: commit.sha,
			title: commit.title,
			message: commit.message ?? commit.title,
			timestamp: commit.timestamp ?? "2026-05-01T10:00:00+00:00",
			url: `https://gitlab.example.test/${fixture.tag}/service/-/commit/${commit.sha}`,
			author: {
				name: "GitLab Tester",
				email: commit.email === undefined ? fixture.userEmail : commit.email,
			},
		})),
		total_commits_count: commits.length,
	};
}

export function mergeRequestPayload(
	fixture: GitlabFixture,
	input: {
		iid: number;
		title: string;
		state: "opened" | "merged" | "closed" | "locked";
		action: string;
		sourceBranch: string;
		email?: string | null;
		approvals?: number;
		reviewerState?: string;
	},
) {
	return {
		object_kind: "merge_request",
		project: projectPayload(fixture),
		user: {
			id: 7,
			name: "GitLab Tester",
			username: "gl-tester",
			email: input.email === undefined ? fixture.userEmail : input.email,
		},
		object_attributes: {
			iid: input.iid,
			title: input.title,
			state: input.state,
			action: input.action,
			source_branch: input.sourceBranch,
			target_branch: "main",
			url: `https://gitlab.example.test/${fixture.tag}/service/-/merge_requests/${input.iid}`,
			updated_at: "2026-05-02T12:00:00Z",
			merged_at: input.state === "merged" ? "2026-05-02T12:00:00Z" : null,
			author: {
				id: 7,
				name: "GitLab Tester",
				username: "gl-tester",
				email: input.email === undefined ? fixture.userEmail : input.email,
			},
			approvals: input.approvals,
		},
		reviewers: [
			{
				id: 8,
				name: "Reviewer",
				username: "reviewer",
				email: "reviewer@example.test",
				state: input.reviewerState ?? "unreviewed",
			},
		],
	};
}

export function pipelinePayload(
	fixture: GitlabFixture,
	input: { id: number; ref: string; sha: string; status: string },
) {
	return {
		object_kind: "pipeline",
		project: projectPayload(fixture),
		object_attributes: {
			id: input.id,
			ref: input.ref,
			sha: input.sha,
			status: input.status,
			url: `https://gitlab.example.test/${fixture.tag}/service/-/pipelines/${input.id}`,
			created_at: "2026-05-03T08:00:00Z",
		},
	};
}

export async function delivery(
	app: TestApp,
	token: string,
	event: string,
	payload: unknown,
	idempotencyKey: string,
) {
	return app.inject({
		method: "POST",
		url: "/api/integrations/gitlab/webhook",
		headers: {
			"x-gitlab-token": token,
			"x-gitlab-event": event,
			"idempotency-key": idempotencyKey,
			"content-type": "application/json",
		},
		payload: payload as never,
	});
}

export async function waitForDelivery(
	idempotencyKey: string,
	timeoutMs = 10_000,
) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const [row] = await db
			.select()
			.from(gitlabDeliveries)
			.where(eq(gitlabDeliveries.idempotencyKey, idempotencyKey))
			.limit(1);
		if (row && (row.status === "processed" || row.status === "ignored")) {
			return row;
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`Delivery ${idempotencyKey} did not finish`);
}

export async function cleanupGitlabFixture(fixture: GitlabFixture | undefined) {
	if (!fixture) return;
	const tag = fixture.tag;
	await pool.query("delete from projects where id = $1", [fixture.projectId]);
	await pool.query("delete from gitlab_repositories where path like $1", [
		`${tag}/%`,
	]);
	await pool.query("delete from workflows where source_id like $1", [
		`${tag}%`,
	]);
	await pool.query("delete from statuses where source_id like $1", [`${tag}%`]);
	await pool.query("delete from issue_types where source_id like $1", [
		`${tag}%`,
	]);
	await pool.query("delete from users where id = $1", [fixture.userId]);
	await pool.query(
		"delete from gitlab_deliveries where idempotency_key like $1",
		[`${tag}%`],
	);
}

export function uniqueTag() {
	return `gl${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export async function deliverDirect(
	event: string,
	payload: unknown,
	idempotencyKey: string,
) {
	const [row] = await db
		.insert(gitlabDeliveries)
		.values({ idempotencyKey, event, payload })
		.returning();
	await processGitlabDelivery(row.id);
	const [after] = await db
		.select()
		.from(gitlabDeliveries)
		.where(eq(gitlabDeliveries.id, row.id))
		.limit(1);
	return after;
}
