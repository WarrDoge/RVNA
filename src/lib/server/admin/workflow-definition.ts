import { z } from "zod";

export const transitionDefinitionSchema = z.object({
	id: z.uuid(),
	name: z.string().trim().min(1).max(255),
	fromStatusId: z.uuid().nullable(),
	toStatusId: z.uuid(),
	asksResolution: z.boolean(),
});

export const definitionSchema = z.object({
	initialStatusId: z.uuid().nullable(),
	statuses: z.array(z.uuid()).max(500),
	transitions: z.array(transitionDefinitionSchema).max(5000),
});

export type TransitionDefinition = z.infer<typeof transitionDefinitionSchema>;
export type Definition = z.infer<typeof definitionSchema>;

export type ProblemCode =
	| "no_initial_status"
	| "unreachable_status"
	| "duplicate_transition"
	| "removed_status_in_use"
	| "invalid_mapping"
	| "unknown_status";

export type Problem = {
	code: ProblemCode;
	message: string;
	statusId?: string;
	statusName?: string;
	issueCount?: number;
};

/** Structural problems that make a draft unusable even as a draft. */
export function shapeProblem(definition: Definition): string | null {
	const statusIds = new Set(definition.statuses);
	if (statusIds.size !== definition.statuses.length) {
		return "A status is listed twice";
	}
	const transitionIds = new Set<string>();
	for (const transition of definition.transitions) {
		if (transitionIds.has(transition.id)) {
			return "Transition ids must be unique";
		}
		transitionIds.add(transition.id);
		if (
			!statusIds.has(transition.toStatusId) ||
			(transition.fromStatusId !== null &&
				!statusIds.has(transition.fromStatusId))
		) {
			return "Transitions can only connect statuses of the workflow";
		}
		if (transition.fromStatusId === transition.toStatusId) {
			return "A transition cannot lead back to the status it starts from";
		}
	}
	return null;
}

/** Statuses reachable from the initial status; a transition without a source starts from every status. */
export function reachableStatuses(definition: Definition): Set<string> {
	const initial = definition.initialStatusId;
	const statusIds = new Set(definition.statuses);
	if (initial === null || !statusIds.has(initial)) return new Set();
	const reached = new Set([initial]);
	let changed = true;
	while (changed) {
		changed = false;
		for (const transition of definition.transitions) {
			if (reached.has(transition.toStatusId)) continue;
			if (
				transition.fromStatusId === null ||
				reached.has(transition.fromStatusId)
			) {
				reached.add(transition.toStatusId);
				changed = true;
			}
		}
	}
	return reached;
}

/** Statuses ordered for display: the initial status first, then breadth first, the rest by name. */
export function orderStatuses(
	definition: Definition,
	names: ReadonlyMap<string, string>,
): string[] {
	const name = (id: string) => names.get(id) ?? "";
	const byName = (a: string, b: string) => name(a).localeCompare(name(b));
	const ordered: string[] = [];
	const seen = new Set<string>();
	const statusIds = new Set(definition.statuses);
	const queue: string[] = [];
	const visit = (id: string) => {
		if (seen.has(id)) return;
		seen.add(id);
		ordered.push(id);
		queue.push(id);
	};

	if (
		definition.initialStatusId !== null &&
		statusIds.has(definition.initialStatusId)
	) {
		visit(definition.initialStatusId);
	}
	for (let head = 0; head < queue.length; head++) {
		const current = queue[head];
		const next = definition.transitions
			.filter(
				(transition) =>
					transition.fromStatusId === null ||
					transition.fromStatusId === current,
			)
			.map((transition) => transition.toStatusId)
			.sort(byName);
		for (const id of next) visit(id);
	}
	for (const id of [...definition.statuses].sort(byName)) visit(id);
	return ordered;
}

export type ValidationInput = {
	definition: Definition;
	/** Statuses that exist, by id. */
	names: ReadonlyMap<string, string>;
	/** Statuses of the live workflow. */
	liveStatusIds: ReadonlySet<string>;
	/** Issues governed by the workflow, by status id. */
	issueCounts: ReadonlyMap<string, number>;
	statusMapping?: Readonly<Record<string, string>>;
};

export function validateDefinition(input: ValidationInput): Problem[] {
	const { definition, names, liveStatusIds, issueCounts } = input;
	const mapping = input.statusMapping ?? {};
	const nameOf = (id: string) => names.get(id) ?? id;
	const problems: Problem[] = [];
	const statusIds = new Set(definition.statuses);

	for (const id of definition.statuses) {
		if (!names.has(id)) {
			problems.push({
				code: "unknown_status",
				message: "A status of this workflow no longer exists",
				statusId: id,
			});
		}
	}

	const initial = definition.initialStatusId;
	if (initial === null) {
		problems.push({
			code: "no_initial_status",
			message: "The workflow has no initial status. Set one before publishing.",
		});
	} else if (!statusIds.has(initial)) {
		problems.push({
			code: "no_initial_status",
			message: "The initial status is not one of the statuses of the workflow",
			statusId: initial,
			statusName: nameOf(initial),
		});
	} else {
		const reached = reachableStatuses(definition);
		for (const id of definition.statuses) {
			if (reached.has(id)) continue;
			problems.push({
				code: "unreachable_status",
				message: `${nameOf(id)} cannot be reached from the initial status. Add a transition into it.`,
				statusId: id,
				statusName: nameOf(id),
			});
		}
	}

	const seen = new Set<string>();
	for (const transition of definition.transitions) {
		const key = `${transition.name.trim().toLowerCase()}|${transition.fromStatusId}|${transition.toStatusId}`;
		if (!seen.has(key)) {
			seen.add(key);
			continue;
		}
		const anchor = transition.fromStatusId ?? transition.toStatusId;
		problems.push({
			code: "duplicate_transition",
			message: `Transition "${transition.name}" is defined more than once from ${
				transition.fromStatusId ? nameOf(transition.fromStatusId) : "any status"
			} to ${nameOf(transition.toStatusId)}`,
			statusId: anchor,
			statusName: nameOf(anchor),
		});
	}

	for (const id of liveStatusIds) {
		if (statusIds.has(id)) continue;
		const issueCount = issueCounts.get(id) ?? 0;
		if (issueCount === 0) continue;
		const replacement = mapping[id];
		if (replacement === undefined) {
			problems.push({
				code: "removed_status_in_use",
				message: `${issueCount} ${issueCount === 1 ? "issue is" : "issues are"} in ${nameOf(id)}, which is removed from the workflow. Choose a status to move them to.`,
				statusId: id,
				statusName: nameOf(id),
				issueCount,
			});
		} else if (!statusIds.has(replacement) || !names.has(replacement)) {
			problems.push({
				code: "invalid_mapping",
				message: `${nameOf(id)} cannot be mapped to a status that is not part of the workflow`,
				statusId: id,
				statusName: nameOf(id),
				issueCount,
			});
		}
	}

	return problems;
}

export type DefinitionChanges = {
	addedStatuses: string[];
	removedStatuses: string[];
	addedTransitions: string[];
	removedTransitions: string[];
	changedTransitions: string[];
	initialStatus: { from: string | null; to: string | null } | null;
};

/** What publishing `next` over `live` changes, described by names for the audit log. */
export function describeChanges(
	live: Definition,
	next: Definition,
	names: ReadonlyMap<string, string>,
): DefinitionChanges {
	const nameOf = (id: string | null) =>
		id === null ? null : (names.get(id) ?? id);
	const label = (transition: TransitionDefinition) =>
		`${transition.name} (${nameOf(transition.fromStatusId) ?? "Any status"} -> ${nameOf(transition.toStatusId)})`;
	const liveStatuses = new Set(live.statuses);
	const nextStatuses = new Set(next.statuses);
	const liveById = new Map(live.transitions.map((item) => [item.id, item]));
	const nextById = new Map(next.transitions.map((item) => [item.id, item]));

	return {
		addedStatuses: next.statuses
			.filter((id) => !liveStatuses.has(id))
			.map((id) => nameOf(id) as string),
		removedStatuses: live.statuses
			.filter((id) => !nextStatuses.has(id))
			.map((id) => nameOf(id) as string),
		addedTransitions: next.transitions
			.filter((item) => !liveById.has(item.id))
			.map(label),
		removedTransitions: live.transitions
			.filter((item) => !nextById.has(item.id))
			.map(label),
		changedTransitions: next.transitions
			.filter((item) => {
				const before = liveById.get(item.id);
				return (
					before !== undefined &&
					(before.name !== item.name ||
						before.fromStatusId !== item.fromStatusId ||
						before.toStatusId !== item.toStatusId ||
						before.asksResolution !== item.asksResolution)
				);
			})
			.map(label),
		initialStatus:
			live.initialStatusId === next.initialStatusId
				? null
				: {
						from: nameOf(live.initialStatusId),
						to: nameOf(next.initialStatusId),
					},
	};
}

export function hasChanges(changes: DefinitionChanges): boolean {
	return (
		changes.addedStatuses.length > 0 ||
		changes.removedStatuses.length > 0 ||
		changes.addedTransitions.length > 0 ||
		changes.removedTransitions.length > 0 ||
		changes.changedTransitions.length > 0 ||
		changes.initialStatus !== null
	);
}
