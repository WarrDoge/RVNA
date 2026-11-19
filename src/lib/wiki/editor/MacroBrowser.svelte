<script lang="ts">
	import {
		type MacroDef,
		macroCatalog,
		macroCategories,
	} from "#lib/editor/wiki/macros.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";

	interface Props {
		onpick: (def: MacroDef) => void;
		onclose: () => void;
	}

	let { onpick, onclose }: Props = $props();

	let query = $state("");
	let active = $state(0);

	function matchMacros(value: string): MacroDef[] {
		const needle = value.trim().toLowerCase();
		if (needle === "") return macroCatalog;
		return macroCatalog.filter(
			(def) =>
				def.name.includes(needle) ||
				def.label.toLowerCase().includes(needle) ||
				def.description.toLowerCase().includes(needle) ||
				def.category.toLowerCase().includes(needle),
		);
	}

	let ordered = $derived(
		macroCategories.flatMap((category) =>
			matchMacros(query).filter((def) => def.category === category),
		),
	);
	let current = $derived(ordered[Math.min(active, ordered.length - 1)]);
</script>

{#snippet footer()}
	<Button appearance="subtle" onclick={onclose}>Cancel</Button>
{/snippet}

<Modal title="Select macro" width={560} onClose={onclose} {footer}>
	<input
		class="wke-input"
		aria-label="Search macros"
		placeholder="Search macros"
		bind:value={query}
		oninput={() => (active = 0)}
		onkeydown={(event) => {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				active = Math.min(active + 1, ordered.length - 1);
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				active = Math.max(active - 1, 0);
			} else if (event.key === "Enter" && current) {
				event.preventDefault();
				onpick(current);
			}
		}}
	/>
	<div class="wke-browser-list" role="listbox" aria-label="Macros">
		{#if ordered.length === 0}
			<div class="wke-muted">No macros match "{query}".</div>
		{/if}
		{#each macroCategories as category (category)}
			{@const items = ordered.filter((def) => def.category === category)}
			{#if items.length > 0}
				<div>
					<div class="wke-menu-group">{category}</div>
					{#each items as def (def.name)}
						<button
							type="button"
							role="option"
							aria-selected={def === current}
							class="wke-browser-item{def === current ? ' is-active' : ''}"
							onmousemove={() => (active = ordered.indexOf(def))}
							onclick={() => onpick(def)}
						>
							<strong>{def.label}</strong>
							<span>{def.description}</span>
						</button>
					{/each}
				</div>
			{/if}
		{/each}
	</div>
</Modal>
