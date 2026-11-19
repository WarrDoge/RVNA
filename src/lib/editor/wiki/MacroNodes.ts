import { SvelteNodeViewRenderer } from "../node-view.ts";
import { InlineMacro, Macro } from "./extensions.ts";
import InlineMacroView from "./InlineMacroView.svelte";
import MacroView from "./MacroView.svelte";

export const MacroNode = Macro.extend({
	addNodeView() {
		return SvelteNodeViewRenderer(MacroView, { as: "div" });
	},
});

export const InlineMacroNode = InlineMacro.extend({
	addNodeView() {
		return SvelteNodeViewRenderer(InlineMacroView, { as: "span" });
	},
});
