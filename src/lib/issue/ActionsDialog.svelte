<script lang="ts">
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import type { ShortcutAction } from "./types.ts";

	interface Props {
		actions: ShortcutAction[];
		onClose: () => void;
	}

	let { actions, onClose }: Props = $props();

	let filter = $state("");
	let active = $state(0);
	let input = $state<HTMLInputElement>();

	let visible = $derived(
		actions.filter((action) =>
			action.label.toLowerCase().includes(filter.toLowerCase()),
		),
	);

	$effect(() => {
		input?.focus();
	});

	function move(delta: number) {
		if (visible.length === 0) {
			active = 0;
			return;
		}
		active = (active + delta + visible.length) % visible.length;
	}

	function run(action: ShortcutAction) {
		onClose();
		action.run();
	}
</script>

{#snippet footer()}
	<Button appearance="subtle" onclick={onClose}>Close</Button>
{/snippet}

<Modal title="Actions" width={460} {onClose} {footer}>
	<input
		bind:this={input}
		aria-label="Filter actions"
		placeholder="Filter actions"
		value={filter}
		oninput={(event) => {
			filter = event.currentTarget.value;
			active = 0;
		}}
		onkeydown={(event) => {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				move(1);
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				move(-1);
			}
			if (event.key === "Enter") {
				const action = visible[active];
				if (action) {
					event.preventDefault();
					run(action);
				}
			}
		}}
		class="filter"
	/>
	<div role="menu" aria-label="Actions">
		{#if visible.length === 0}
			<p class="empty">No matching actions.</p>
		{:else}
			{#each visible as action, index (action.id)}
				<button
					type="button"
					role="menuitem"
					class="fat-menu-item"
					class:active={index === active}
					onmouseenter={() => (active = index)}
					onclick={() => run(action)}
				>
					<span>{action.label}</span>
					{#if action.keys}
						<span class="keys">{action.keys}</span>
					{/if}
				</button>
			{/each}
		{/if}
	</div>
</Modal>

<style>
	.filter {
		width: 100%;
		height: 32px;
		margin-bottom: 8px;
		padding: 0 8px;
		background: var(--ds-background-input);
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text);
	}

	.empty {
		color: var(--ds-text-subtle);
	}

	button {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		background: transparent;
	}

	button.active {
		background: var(--ds-background-neutral-subtle-hovered);
	}

	.keys {
		margin-left: auto;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}
</style>
