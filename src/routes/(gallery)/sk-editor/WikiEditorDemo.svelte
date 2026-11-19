<script lang="ts">
	import { Editor } from "@tiptap/core";
	import { onDestroy, onMount } from "svelte";
	import type { WikiDoc } from "#lib/shared/wiki/index.ts";
	import { schemaExtensions } from "#lib/editor/wiki/extensions.ts";
	import {
		InlineMacroNode,
		MacroNode,
	} from "#lib/editor/wiki/MacroNodes.ts";
	import "#lib/editor/wiki/macro.css";

	interface Props {
		doc: WikiDoc;
		onChange?: (doc: WikiDoc) => void;
		onEditor?: (editor: Editor) => void;
	}

	let { doc, onChange, onEditor }: Props = $props();

	let mountEl: HTMLDivElement;
	let editor = $state.raw<Editor | null>(null);

	onMount(() => {
		const instance = new Editor({
			element: mountEl,
			extensions: schemaExtensions({
				macro: MacroNode,
				inlineMacro: InlineMacroNode,
			}),
			content: doc,
			editorProps: {
				attributes: {
					class: "wke-content fat-editor-content",
					"aria-label": "Wiki demo editor",
				},
			},
			onUpdate: ({ editor: current }) => {
				onChange?.(current.getJSON() as WikiDoc);
			},
		});
		editor = instance;
		onEditor?.(instance);
	});

	onDestroy(() => {
		editor?.destroy();
		editor = null;
	});
</script>

<div class="wke">
	<div bind:this={mountEl}></div>
</div>
