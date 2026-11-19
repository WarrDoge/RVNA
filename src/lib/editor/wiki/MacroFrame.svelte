<script lang="ts">
	import type { Snippet } from "svelte";
	import type { MacroParam } from "#lib/shared/wiki/index.ts";
	import type { MacroDef } from "./macros.ts";
	import { previewGlyph, summary } from "./macro-view-helpers.ts";

	interface Props {
		name: string;
		label: string;
		params: MacroParam[];
		def: MacroDef | undefined;
		children?: Snippet;
	}

	let { name, label, params, def, children }: Props = $props();

	let lines = $derived(summary(def, params));
</script>

<div class="wke-preview" contenteditable="false">
	<div class="wke-preview-head">
		<span class="wke-preview-glyph">{previewGlyph[name] ?? "{}"}</span>
		<strong>{label}</strong>
	</div>
	{@render children?.()}
	{#if lines.length > 0}
		<div class="wke-preview-params">{lines.join(" · ")}</div>
	{/if}
</div>
