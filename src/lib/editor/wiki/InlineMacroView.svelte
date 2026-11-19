<script lang="ts">
	import type { Editor } from "@tiptap/core";
	import type { Node as PmNode } from "@tiptap/pm/model";
	import type { MacroParam } from "#lib/shared/wiki/index.ts";
	import { getParam, macroDef } from "./macros.ts";
	import { jiraText, previewGlyph } from "./macro-view-helpers.ts";

	interface Props {
		node: PmNode;
		selected: boolean;
		editor: Editor;
		getPos: () => number | undefined;
		updateAttributes: (attrs: Record<string, unknown>) => void;
		deleteNode: () => void;
	}

	let { node, selected, editor }: Props = $props();

	let name = $derived(String(node.attrs.name ?? ""));
	let def = $derived(macroDef(name));
	let params = $derived((node.attrs.params ?? []) as MacroParam[]);
	let rich = $derived(node.attrs.bodyType === "rich");
	let text = $derived(
		name === "anchor"
			? getParam(params, "") || "anchor"
			: name === "jira"
				? jiraText(params)
				: (def?.label ?? name),
	);
</script>

<span
	class="wke-inline-macro wke-inline-macro-{def
		? name
		: 'unknown'}{selected ? ' is-selected' : ''}"
	data-macro={name}
	data-node-view-wrapper
>
	<span class="wke-inline-glyph" contenteditable="false">
		{previewGlyph[name] ?? "{}"}
	</span>
	{#if rich}
		<span><span data-node-view-content></span></span>
	{:else}
		<span contenteditable="false">{text}</span>
	{/if}
</span>
