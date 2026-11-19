import {
	type DecorationWithType,
	type Editor,
	NodeView,
	type NodeViewRenderer,
	type NodeViewRendererOptions,
	type NodeViewRendererProps,
} from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import type { Decoration, DecorationSource } from "@tiptap/pm/view";
import { type Component, mount, unmount } from "svelte";
import {
	createNodeViewState,
	type NodeViewState,
} from "./node-view-state.svelte.ts";

export type SvelteNodeViewComponent = Component<NodeViewState>;

export type SvelteNodeViewOptions = NodeViewRendererOptions & {
	/** The wrapper element; defaults to a span for inline nodes and a div otherwise. */
	as?: "div" | "span";
	className?: string;
};

class SvelteNodeView extends NodeView<
	SvelteNodeViewComponent,
	Editor,
	SvelteNodeViewOptions
> {
	declare state: NodeViewState;
	declare instance: ReturnType<typeof mount>;
	declare element: HTMLElement;
	declare contentElement: HTMLElement | null;

	override mount() {
		const as = this.options.as ?? (this.node.isInline ? "span" : "div");
		const wrapper = document.createElement(as);
		wrapper.className =
			`node-${this.node.type.name} ${this.options.className ?? ""}`.trim();
		this.element = wrapper;
		this.state = createNodeViewState({
			node: this.node,
			selected: false,
			editor: this.editor,
			getPos: () => this.getPos(),
			updateAttributes: (attrs) => this.updateAttributes(attrs),
			deleteNode: () => this.deleteNode(),
		});
		this.instance = mount(this.component, {
			target: wrapper,
			props: this.state,
		});
		this.contentElement = wrapper.querySelector<HTMLElement>(
			"[data-node-view-content]",
		);
		if (!this.contentElement && !this.node.isLeaf) {
			const content = document.createElement(
				this.node.isInline ? "span" : "div",
			);
			content.hidden = true;
			wrapper.appendChild(content);
			this.contentElement = content;
		}
	}

	get dom() {
		return this.element;
	}

	get contentDOM() {
		return this.contentElement;
	}

	update(
		node: PmNode,
		decorations: readonly Decoration[],
		innerDecorations: DecorationSource,
	) {
		if (node.type !== this.node.type) return false;
		this.node = node;
		this.decorations = decorations as DecorationWithType[];
		this.innerDecorations = innerDecorations;
		this.state.node = node;
		return true;
	}

	selectNode() {
		this.state.selected = true;
		this.element.classList.add("ProseMirror-selectednode");
	}

	deselectNode() {
		this.state.selected = false;
		this.element.classList.remove("ProseMirror-selectednode");
	}

	destroy() {
		unmount(this.instance);
		this.contentElement = null;
	}
}

/**
 * Mounts a Svelte component as a node view and keeps
 * it alive across node updates. The component marks its editable content hole with
 * `data-node-view-content`; stopEvent and ignoreMutation come from TipTap's NodeView.
 */
export function SvelteNodeViewRenderer(
	component: SvelteNodeViewComponent,
	options: Partial<SvelteNodeViewOptions> = {},
): NodeViewRenderer {
	return (props: NodeViewRendererProps) =>
		new SvelteNodeView(component, props, options);
}
