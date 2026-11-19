import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";

/** The props every Svelte node view component receives. */
export type NodeViewState = {
	node: PmNode;
	selected: boolean;
	editor: Editor;
	getPos: () => number | undefined;
	updateAttributes: (attrs: Record<string, unknown>) => void;
	deleteNode: () => void;
};

/** A rune-owned props object, so mutating it updates the mounted component. */
export function createNodeViewState(initial: NodeViewState) {
	let state = $state(initial);
	return state;
}
