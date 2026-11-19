<script lang="ts">
	import type { Editor } from "@tiptap/core";
	import { onMount } from "svelte";
	import type { MacroParam } from "#lib/shared/wiki/index.ts";
	import { filterToc, getParam, type TocEntry } from "./macros.ts";
	import { headingsOf } from "./macro-view-helpers.ts";

	interface Props {
		editor: Editor;
		params: MacroParam[];
	}

	let { editor, params }: Props = $props();

	let headings = $state<TocEntry[]>([]);

	onMount(() => {
		const update = () => {
			headings = headingsOf(editor.state.doc);
		};
		update();
		editor.on("update", update);
		return () => {
			editor.off("update", update);
		};
	});

	let shown = $derived(filterToc(headings, params));
	let flat = $derived(getParam(params, "type") === "flat");
	let outline = $derived(getParam(params, "outline") === "true");
	let base = $derived(
		shown.length === 0 ? 1 : Math.min(...shown.map((entry) => entry.level)),
	);
	let labels = $derived.by(() => {
		if (!outline) return shown.map((entry) => entry.text);
		const counters = [0, 0, 0, 0, 0, 0, 0];
		return shown.map((entry) => {
			counters[entry.level] += 1;
			counters.fill(0, entry.level + 1);
			return `${counters.slice(base, entry.level + 1).join(".")}. ${entry.text}`;
		});
	});
</script>

{#if shown.length === 0}
	<div class="wke-muted">No headings on this page yet.</div>
{:else if flat}
	<div class="wke-toc-flat">
		{#each shown as entry, index (index)}
			<span class="wke-toc-link">{labels[index]}</span>
		{/each}
	</div>
{:else}
	<ul class="wke-toc-list">
		{#each shown as entry, index (index)}
			<li style="margin-left: {(entry.level - base) * 18}px">
				<span class="wke-toc-link">{labels[index]}</span>
			</li>
		{/each}
	</ul>
{/if}
