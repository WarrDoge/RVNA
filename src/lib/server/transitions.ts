import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "./db.ts";
import { type Executor, type HistoryItem, writeHistory } from "./history.ts";
import { issues, resolutions, statuses } from "./schema.ts";
import type { StatusRef } from "./workflows.ts";

export type TransitionableIssue = {
	id: string;
	statusId: string;
	statusName: string;
	statusCategory: StatusRef["category"];
	resolutionId: string | null;
	resolutionName: string | null;
	resolved: Date | null;
};

export type TransitionRef = {
	id: string;
	name: string;
	asksResolution?: boolean;
	to: StatusRef;
};

export type TransitionIssue = TransitionableIssue;
export type TransitionTarget = TransitionRef;

/**
 * Moves an issue through a workflow transition inside the caller's transaction,
 * applying the resolution rules Jira uses when a transition enters or leaves a
 * done status. Returns the history items it wrote so callers can notify.
 */
export async function applyTransition(
	tx: Executor,
	issue: TransitionableIssue,
	transition: TransitionRef,
	authorId: string | null,
	requestedResolutionId?: string | null,
	via: string | null = null,
): Promise<HistoryItem[] | null> {
	const [locked] = await tx
		.select({ statusId: issues.statusId })
		.from(issues)
		.where(eq(issues.id, issue.id))
		.for("update");
	if (!locked || locked.statusId !== issue.statusId) return null;

	if (requestedResolutionId) {
		const [resolution] = await tx
			.select({ id: resolutions.id })
			.from(resolutions)
			.where(eq(resolutions.id, requestedResolutionId))
			.limit(1);
		if (!resolution) return null;
	}

	const [current] = await tx
		.select({
			statusId: issues.statusId,
			statusName: statuses.name,
			statusCategory: statuses.category,
			resolutionId: issues.resolutionId,
			resolutionName: resolutions.name,
			resolved: issues.resolved,
		})
		.from(issues)
		.innerJoin(statuses, eq(statuses.id, issues.statusId))
		.leftJoin(resolutions, eq(resolutions.id, issues.resolutionId))
		.where(eq(issues.id, issue.id));
	if (!current) return null;

	const fromDone = current.statusCategory === "done";
	const toDone = transition.to.category === "done";
	let resolutionId = current.resolutionId;
	let resolved = current.resolved;

	if (toDone) {
		if (requestedResolutionId) {
			resolutionId = requestedResolutionId;
		} else if (fromDone && current.resolutionId) {
			resolutionId = current.resolutionId;
		} else {
			const [done] = await tx
				.select({ id: resolutions.id })
				.from(resolutions)
				.where(eq(resolutions.name, "Done"))
				.limit(1);
			if (done) {
				resolutionId = done.id;
			} else {
				const [created] = await tx
					.insert(resolutions)
					.values({ sourceId: `local:${randomUUID()}`, name: "Done" })
					.returning({ id: resolutions.id });
				resolutionId = created.id;
			}
		}
		resolved = fromDone ? (current.resolved ?? new Date()) : new Date();
	} else if (transition.asksResolution && requestedResolutionId) {
		resolutionId = requestedResolutionId;
		resolved = current.resolved ?? new Date();
	} else if (fromDone) {
		resolutionId = null;
		resolved = null;
	}

	const resolution = resolutionId
		? (
				await tx
					.select({ id: resolutions.id, name: resolutions.name })
					.from(resolutions)
					.where(eq(resolutions.id, resolutionId))
					.limit(1)
			)[0]
		: null;

	const items: HistoryItem[] = [
		{
			field: "status",
			fieldType: "jira",
			fromValue: current.statusId,
			fromText: current.statusName,
			toValue: transition.to.id,
			toText: transition.to.name,
		},
	];
	if (resolutionId !== current.resolutionId) {
		items.push({
			field: "resolution",
			fieldType: "jira",
			fromValue: current.resolutionId,
			fromText: current.resolutionName,
			toValue: resolutionId,
			toText: resolution?.name ?? null,
		});
	}

	await tx
		.update(issues)
		.set({
			statusId: transition.to.id,
			resolutionId,
			resolved,
			updated: new Date(),
		})
		.where(and(eq(issues.id, issue.id), eq(issues.statusId, current.statusId)));
	await writeHistory(tx, issue.id, authorId, items, via);
	return items;
}

/**
 * Runs `applyTransition` in its own transaction for callers outside a request
 * (webhooks). Returns false when the requested resolution does not exist.
 */
export async function transitionIssue(
	issue: TransitionableIssue,
	transition: TransitionRef,
	actorId: string | null,
	options: { resolutionId?: string | null; via?: string | null } = {},
): Promise<HistoryItem[] | false> {
	const items = await db.transaction((tx) =>
		applyTransition(
			tx,
			issue,
			transition,
			actorId,
			options.resolutionId,
			options.via ?? null,
		),
	);
	return items ?? false;
}
