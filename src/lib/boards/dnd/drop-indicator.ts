import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import type { Attachment } from "svelte/attachments";

export type DropIndicatorTarget =
	| { kind: "card"; key: string }
	| { kind: "zone"; testId: string }
	| null;

type DropTargetLike = {
	data: Record<string, unknown>;
	element: Element;
};

/** The innermost target drives the insertion line; zones are identified by test id. */
export function dropIndicatorForTargets(
	targets: DropTargetLike[],
): DropIndicatorTarget {
	const target = targets[0];
	if (!target) return null;
	if (target.data.type === "board-card" || target.data.type === "backlog-row") {
		return { kind: "card", key: String(target.data.key) };
	}
	const testId =
		target.element instanceof HTMLElement
			? target.element.dataset.testid
			: undefined;
	return testId ? { kind: "zone", testId } : null;
}

export function dropIndicatorMonitor(
	onChange: (target: DropIndicatorTarget) => void,
): Attachment<HTMLElement> {
	return () =>
		monitorForElements({
			onDropTargetChange: ({ location }) => {
				onChange(dropIndicatorForTargets(location.current.dropTargets));
			},
			onDrop: () => onChange(null),
		});
}
