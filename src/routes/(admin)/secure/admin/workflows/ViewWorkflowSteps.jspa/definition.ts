import type {
	Definition,
	WorkflowDetail,
	WorkflowTransition,
} from "#lib/workflow/types.ts";

export function toDefinition(detail: WorkflowDetail): Definition {
	return {
		initialStatusId: detail.initialStatusId,
		statuses: detail.statuses.map((status) => status.id),
		transitions: detail.transitions,
	};
}

/** Pure edits of a definition; the editor saves the result as the draft. */
export const edits = {
	addStatus(definition: Definition, statusId: string): Definition {
		if (definition.statuses.includes(statusId)) return definition;
		return {
			...definition,
			initialStatusId: definition.initialStatusId ?? statusId,
			statuses: [...definition.statuses, statusId],
		};
	},
	removeStatus(definition: Definition, statusId: string): Definition {
		return {
			initialStatusId:
				definition.initialStatusId === statusId
					? null
					: definition.initialStatusId,
			statuses: definition.statuses.filter((id) => id !== statusId),
			transitions: definition.transitions.filter(
				(transition) =>
					transition.fromStatusId !== statusId &&
					transition.toStatusId !== statusId,
			),
		};
	},
	setInitial(definition: Definition, statusId: string): Definition {
		return { ...definition, initialStatusId: statusId };
	},
	saveTransition(
		definition: Definition,
		transition: WorkflowTransition,
	): Definition {
		const exists = definition.transitions.some(
			(item) => item.id === transition.id,
		);
		return {
			...definition,
			transitions: exists
				? definition.transitions.map((item) =>
						item.id === transition.id ? transition : item,
					)
				: [...definition.transitions, transition],
		};
	},
	deleteTransition(definition: Definition, id: string): Definition {
		return {
			...definition,
			transitions: definition.transitions.filter((item) => item.id !== id),
		};
	},
};
