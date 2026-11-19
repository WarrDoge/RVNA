import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { type CurrentUser, loadUser } from "../auth.ts";
import { db } from "../db.ts";
import { type HistoryItem, writeHistory } from "../history.ts";
import { sanitizeBodyHtml } from "../html.ts";
import { HttpError } from "../http.ts";
import { recordIssueEvent } from "../notifications.ts";
import { requireIssuePermissionFor } from "../permissions.ts";
import {
	comments,
	issues,
	resolutions,
	statuses,
	users,
	workflowTransitions,
	worklogs,
} from "../schema.ts";
import {
	gitlabAutomationEvents,
	gitlabProjectRepositories,
	gitlabProjectSettings,
} from "../schema-gitlab.ts";
import type {
	EventChanges,
	NotificationKind,
} from "../schema-notifications.ts";
import { recomputeIssueSla } from "../servicedesk/recompute.ts";
import { type TransitionIssue, transitionIssue } from "../transitions.ts";
import { transitionsFrom, workflowForIssueType } from "../workflows.ts";
import type { IssueRef } from "./keys.ts";
import {
	parseSmartCommitMessage,
	type SmartCommitCommand,
} from "./smart-commits.ts";

export interface ProjectGitlabSettings {
	projectId: string;
	smartCommitsEnabled: boolean;
	mergeRequestOpenedEnabled: boolean;
	mergeRequestOpenedTransitions: string[];
	mergeRequestMergedEnabled: boolean;
	mergeRequestMergedTransitions: string[];
}

export async function projectSettings(
	projectId: string,
): Promise<ProjectGitlabSettings> {
	const [row] = await db
		.select()
		.from(gitlabProjectSettings)
		.where(eq(gitlabProjectSettings.projectId, projectId))
		.limit(1);
	return {
		projectId,
		smartCommitsEnabled: row?.smartCommitsEnabled ?? false,
		mergeRequestOpenedEnabled: row?.mergeRequestOpenedEnabled ?? false,
		mergeRequestOpenedTransitions: stringList(
			row?.mergeRequestOpenedTransitions,
		),
		mergeRequestMergedEnabled: row?.mergeRequestMergedEnabled ?? false,
		mergeRequestMergedTransitions: stringList(
			row?.mergeRequestMergedTransitions,
		),
	};
}

function stringList(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

export async function userByEmail(
	email: string | null | undefined,
): Promise<CurrentUser | null> {
	if (!email) return null;
	const [row] = await db
		.select({ id: users.id })
		.from(users)
		.where(
			and(
				eq(users.active, true),
				sql`lower(${users.email}) = lower(${email.trim()})`,
			),
		)
		.limit(1);
	return row ? loadUser(row.id) : null;
}

type AutomationPermission =
	| "ADD_COMMENTS"
	| "WORK_ON_ISSUES"
	| "TRANSITION_ISSUES";

async function linkedProjectIds(repositoryId: string) {
	const rows = await db
		.select({ projectId: gitlabProjectRepositories.projectId })
		.from(gitlabProjectRepositories)
		.where(eq(gitlabProjectRepositories.repositoryId, repositoryId));
	return new Set(rows.map((row) => row.projectId));
}

/** The reason a command is skipped, or null when the author may run it. */
async function automationDenial(
	author: CurrentUser,
	issue: IssueRef,
	permission: AutomationPermission,
	linkedProjects: Set<string>,
): Promise<string | null> {
	if (!linkedProjects.has(issue.projectId)) {
		return "repository is not linked to the issue's project";
	}
	try {
		await requireIssuePermissionFor(author, issue.id, permission);
		return null;
	} catch (cause) {
		if (cause instanceof HttpError) return cause.message;
		throw cause;
	}
}

async function transitionContext(issueId: string) {
	const [row] = await db
		.select({
			id: issues.id,
			projectId: issues.projectId,
			typeId: issues.typeId,
			statusId: issues.statusId,
			statusName: statuses.name,
			statusCategory: statuses.category,
			resolutionId: issues.resolutionId,
			resolutionName: resolutions.name,
			resolved: issues.resolved,
			timeSpent: issues.timeSpent,
			remainingEstimate: issues.remainingEstimate,
		})
		.from(issues)
		.innerJoin(statuses, eq(statuses.id, issues.statusId))
		.leftJoin(resolutions, eq(resolutions.id, issues.resolutionId))
		.where(eq(issues.id, issueId))
		.limit(1);
	return row ?? null;
}

export async function workflowTransitionNames(
	projectId: string,
	typeId: string,
) {
	const workflow = await workflowForIssueType(projectId, typeId);
	if (!workflow) return [];
	const rows = await db
		.select({ name: workflowTransitions.name })
		.from(workflowTransitions)
		.where(eq(workflowTransitions.workflowId, workflow.id))
		.orderBy(workflowTransitions.sequence, workflowTransitions.name);
	return [...new Set(rows.map((row) => row.name))];
}

export async function availableTransitionNames(issueId: string) {
	const context = await transitionContext(issueId);
	if (!context) return [];
	const workflow = await workflowForIssueType(
		context.projectId,
		context.typeId,
	);
	if (!workflow) return [];
	const transitions = await transitionsFrom(workflow.id, context.statusId);
	return transitions.map((transition) => transition.name);
}

async function recordEvent(input: {
	deliveryId: string | null;
	repositoryId: string | null;
	mergeRequestId?: string | null;
	issueId: string | null;
	kind: string;
	status: "applied" | "ignored";
	reason: string | null;
}) {
	await db.insert(gitlabAutomationEvents).values({
		deliveryId: input.deliveryId,
		repositoryId: input.repositoryId,
		mergeRequestId: input.mergeRequestId ?? null,
		issueId: input.issueId,
		kind: input.kind,
		status: input.status,
		reason: input.reason,
	});
}

async function notifyIssueEvent(
	issueId: string,
	actorId: string,
	event: {
		kind: NotificationKind;
		changes?: EventChanges[];
		commentHtml?: string | null;
		worklogSeconds?: number;
	},
) {
	await recomputeIssueSla(issueId);
	const [issue] = await db
		.select({
			id: issues.id,
			key: issues.key,
			summary: issues.summary,
			reporterId: issues.reporterId,
			assigneeId: issues.assigneeId,
		})
		.from(issues)
		.where(eq(issues.id, issueId))
		.limit(1);
	const [actor] = await db
		.select({ id: users.id, displayName: users.displayName })
		.from(users)
		.where(eq(users.id, actorId))
		.limit(1);
	if (!issue || !actor) return;
	await recordIssueEvent({ issue, actor, ...event });
}

function transitionChanges(items: HistoryItem[]): EventChanges[] {
	return items.map((item) => ({
		field: item.field === "status" ? "Status" : "Resolution",
		from: item.fromText,
		to: item.toText,
	}));
}

function escapeHtml(text: string) {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;")
		.replace(/\r?\n/g, "<br>");
}

async function applyComment(
	issue: IssueRef,
	authorId: string,
	text: string,
	deliveryId: string,
	repositoryId: string,
) {
	const bodyHtml = await sanitizeBodyHtml(escapeHtml(text));
	await db.insert(comments).values({
		sourceId: `local:${randomUUID()}`,
		issueId: issue.id,
		authorId,
		bodySource: text,
		bodyHtml,
		created: new Date(),
		updated: new Date(),
	});
	await notifyIssueEvent(issue.id, authorId, {
		kind: "commented",
		commentHtml: bodyHtml,
	});
	await recordEvent({
		deliveryId,
		repositoryId,
		issueId: issue.id,
		kind: "smart_commit_comment",
		status: "applied",
		reason: null,
	});
}

async function applyTime(
	issue: IssueRef,
	authorId: string,
	command: Extract<SmartCommitCommand, { kind: "time" }>,
	started: Date,
	deliveryId: string,
	repositoryId: string,
) {
	const context = await transitionContext(issue.id);
	if (!context) return;
	const timeSpent = (context.timeSpent ?? 0) + command.seconds;
	const remainingEstimate =
		context.remainingEstimate === null
			? null
			: Math.max(0, context.remainingEstimate - command.seconds);

	const items: HistoryItem[] = [
		{
			field: "timespent",
			fieldType: "jira",
			fromValue: context.timeSpent === null ? null : String(context.timeSpent),
			fromText: context.timeSpent === null ? null : String(context.timeSpent),
			toValue: String(timeSpent),
			toText: String(timeSpent),
		},
	];
	if (remainingEstimate !== context.remainingEstimate) {
		items.push({
			field: "timeestimate",
			fieldType: "jira",
			fromValue:
				context.remainingEstimate === null
					? null
					: String(context.remainingEstimate),
			fromText:
				context.remainingEstimate === null
					? null
					: String(context.remainingEstimate),
			toValue: remainingEstimate === null ? null : String(remainingEstimate),
			toText: remainingEstimate === null ? null : String(remainingEstimate),
		});
	}

	await db.transaction(async (tx) => {
		await tx.insert(worklogs).values({
			sourceId: `local:${randomUUID()}`,
			issueId: issue.id,
			authorId,
			started,
			seconds: command.seconds,
			comment: null,
		});
		await tx
			.update(issues)
			.set({ timeSpent, remainingEstimate, updated: new Date() })
			.where(eq(issues.id, issue.id));
		await writeHistory(tx, issue.id, authorId, items, "gitlab");
	});
	await notifyIssueEvent(issue.id, authorId, {
		kind: "worklog_added",
		worklogSeconds: command.seconds,
	});

	await recordEvent({
		deliveryId,
		repositoryId,
		issueId: issue.id,
		kind: "smart_commit_time",
		status: "applied",
		reason: null,
	});
}

async function applyTransitionCommand(
	issue: IssueRef,
	authorId: string,
	name: string,
	deliveryId: string,
	repositoryId: string,
) {
	const context = await transitionContext(issue.id);
	if (!context) return;
	const workflow = await workflowForIssueType(
		context.projectId,
		context.typeId,
	);
	const available = workflow
		? await transitionsFrom(workflow.id, context.statusId)
		: [];
	const transition = available.find(
		(item) => item.name.toLowerCase() === name.toLowerCase(),
	);
	if (!transition) {
		await recordEvent({
			deliveryId,
			repositoryId,
			issueId: issue.id,
			kind: "smart_commit_transition",
			status: "ignored",
			reason: `transition "${name}" is not available from ${context.statusName}`,
		});
		return;
	}

	const items = await transitionIssue(
		{
			...context,
			statusCategory:
				context.statusCategory as TransitionIssue["statusCategory"],
		},
		transition,
		authorId,
		{ via: "gitlab" },
	);
	if (!items) {
		await recordEvent({
			deliveryId,
			repositoryId,
			issueId: issue.id,
			kind: "smart_commit_transition",
			status: "ignored",
			reason: `status changed from ${context.statusName} before the transition could be applied`,
		});
		return;
	}
	await notifyIssueEvent(issue.id, authorId, {
		kind: "transitioned",
		changes: transitionChanges(items),
	});
	await recordEvent({
		deliveryId,
		repositoryId,
		issueId: issue.id,
		kind: "smart_commit_transition",
		status: "applied",
		reason: null,
	});
}

export async function applySmartCommits(input: {
	deliveryId: string;
	repositoryId: string;
	message: string;
	authorEmail: string | null;
	committedAt: Date | null;
	projectKeys: string[];
	issues: IssueRef[];
}) {
	if (input.issues.length === 0) return;

	const settingsByProject = new Map<string, ProjectGitlabSettings>();
	for (const issue of input.issues) {
		if (!settingsByProject.has(issue.projectId)) {
			settingsByProject.set(
				issue.projectId,
				await projectSettings(issue.projectId),
			);
		}
	}
	const enabled = input.issues.filter(
		(issue) => settingsByProject.get(issue.projectId)?.smartCommitsEnabled,
	);
	if (enabled.length === 0) return;

	const [author, linkedProjects] = await Promise.all([
		userByEmail(input.authorEmail),
		linkedProjectIds(input.repositoryId),
	]);
	const issueById = new Map(enabled.map((issue) => [issue.id, issue]));
	const commandNames = new Set<string>();
	for (const issue of enabled) {
		const context = await transitionContext(issue.id);
		if (!context) continue;
		for (const name of await workflowTransitionNames(
			context.projectId,
			context.typeId,
		)) {
			commandNames.add(name);
		}
	}

	const lines = parseSmartCommitMessage(input.message, {
		projectKeys: input.projectKeys,
		commandNames: [...commandNames],
	});
	const started = input.committedAt ?? new Date();

	for (const line of lines) {
		const targets = line.keys
			.map((key) => enabled.find((issue) => issue.key === key))
			.filter((issue): issue is IssueRef => issue !== undefined);
		for (const issue of targets) {
			if (!issueById.has(issue.id)) continue;
			for (const command of line.commands) {
				if (!author) {
					await recordEvent({
						deliveryId: input.deliveryId,
						repositoryId: input.repositoryId,
						issueId: issue.id,
						kind:
							command.kind === "comment"
								? "smart_commit_comment"
								: command.kind === "time"
									? "smart_commit_time"
									: "smart_commit_transition",
						status: "ignored",
						reason: `author email ${input.authorEmail ?? "(none)"} matches no active user`,
					});
					continue;
				}
				const kind =
					command.kind === "comment"
						? "smart_commit_comment"
						: command.kind === "time"
							? "smart_commit_time"
							: "smart_commit_transition";
				const denial = await automationDenial(
					author,
					issue,
					command.kind === "comment"
						? "ADD_COMMENTS"
						: command.kind === "time"
							? "WORK_ON_ISSUES"
							: "TRANSITION_ISSUES",
					linkedProjects,
				);
				if (denial) {
					await recordEvent({
						deliveryId: input.deliveryId,
						repositoryId: input.repositoryId,
						issueId: issue.id,
						kind,
						status: "ignored",
						reason: denial,
					});
					continue;
				}
				if (command.kind === "comment") {
					await applyComment(
						issue,
						author.id,
						command.text,
						input.deliveryId,
						input.repositoryId,
					);
				} else if (command.kind === "time") {
					await applyTime(
						issue,
						author.id,
						command,
						started,
						input.deliveryId,
						input.repositoryId,
					);
				} else {
					await applyTransitionCommand(
						issue,
						author.id,
						command.name,
						input.deliveryId,
						input.repositoryId,
					);
				}
			}
		}
	}
}

export async function applyMergeRequestTrigger(input: {
	deliveryId: string;
	repositoryId: string;
	mergeRequestId: string;
	kind: "merge_request_opened" | "merge_request_merged";
	actorEmail: string | null;
	issues: IssueRef[];
}) {
	if (input.issues.length === 0) return;

	const [alreadyApplied] = await db
		.select({ id: gitlabAutomationEvents.id })
		.from(gitlabAutomationEvents)
		.where(
			and(
				eq(gitlabAutomationEvents.mergeRequestId, input.mergeRequestId),
				eq(gitlabAutomationEvents.kind, input.kind),
				eq(gitlabAutomationEvents.status, "applied"),
			),
		)
		.limit(1);
	if (alreadyApplied) return;

	const [actor, linkedProjects] = await Promise.all([
		userByEmail(input.actorEmail),
		linkedProjectIds(input.repositoryId),
	]);

	for (const issue of input.issues) {
		const settings = await projectSettings(issue.projectId);
		const enabled =
			input.kind === "merge_request_opened"
				? settings.mergeRequestOpenedEnabled
				: settings.mergeRequestMergedEnabled;
		if (!enabled) continue;
		const names =
			input.kind === "merge_request_opened"
				? settings.mergeRequestOpenedTransitions
				: settings.mergeRequestMergedTransitions;

		if (!actor) {
			await recordEvent({
				deliveryId: input.deliveryId,
				repositoryId: input.repositoryId,
				mergeRequestId: input.mergeRequestId,
				issueId: issue.id,
				kind: input.kind,
				status: "ignored",
				reason: `author email ${input.actorEmail ?? "(none)"} matches no active user`,
			});
			continue;
		}

		const denial = await automationDenial(
			actor,
			issue,
			"TRANSITION_ISSUES",
			linkedProjects,
		);
		if (denial) {
			await recordEvent({
				deliveryId: input.deliveryId,
				repositoryId: input.repositoryId,
				mergeRequestId: input.mergeRequestId,
				issueId: issue.id,
				kind: input.kind,
				status: "ignored",
				reason: denial,
			});
			continue;
		}

		const context = await transitionContext(issue.id);
		if (!context) continue;
		const workflow = await workflowForIssueType(
			context.projectId,
			context.typeId,
		);
		const available = workflow
			? await transitionsFrom(workflow.id, context.statusId)
			: [];
		const transition = names
			.map((name) =>
				available.find(
					(item) => item.name.toLowerCase() === name.toLowerCase(),
				),
			)
			.find((item) => item !== undefined);

		if (!transition) {
			await recordEvent({
				deliveryId: input.deliveryId,
				repositoryId: input.repositoryId,
				mergeRequestId: input.mergeRequestId,
				issueId: issue.id,
				kind: input.kind,
				status: "ignored",
				reason:
					names.length === 0
						? "no transition names configured"
						: `none of ${names.map((name) => `"${name}"`).join(", ")} is available from ${context.statusName}`,
			});
			continue;
		}

		const items = await transitionIssue(
			{
				...context,
				statusCategory:
					context.statusCategory as TransitionIssue["statusCategory"],
			},
			transition,
			actor.id,
			{ via: "gitlab" },
		);
		if (!items) {
			await recordEvent({
				deliveryId: input.deliveryId,
				repositoryId: input.repositoryId,
				mergeRequestId: input.mergeRequestId,
				issueId: issue.id,
				kind: input.kind,
				status: "ignored",
				reason: `status changed from ${context.statusName} before the transition could be applied`,
			});
			continue;
		}
		await notifyIssueEvent(issue.id, actor.id, {
			kind: "transitioned",
			changes: transitionChanges(items),
		});
		await recordEvent({
			deliveryId: input.deliveryId,
			repositoryId: input.repositoryId,
			mergeRequestId: input.mergeRequestId,
			issueId: issue.id,
			kind: input.kind,
			status: "applied",
			reason: null,
		});
	}
}
