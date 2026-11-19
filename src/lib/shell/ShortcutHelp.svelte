<script lang="ts">
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import { ISSUE_SHORTCUTS } from "./shortcut-list.ts";

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();
</script>

{#snippet footer()}
	<Button appearance="subtle" onclick={onClose}>Close</Button>
{/snippet}

<Modal title="Keyboard shortcuts" width={460} {onClose} {footer}>
	<dl class="shortcuts">
		{#each ISSUE_SHORTCUTS as shortcut (shortcut.keys)}
			<dt><kbd>{shortcut.keys}</kbd></dt>
			<dd>{shortcut.label}</dd>
		{/each}
	</dl>
</Modal>

<style>
	.shortcuts {
		display: grid;
		grid-template-columns: 60px 1fr;
		row-gap: 8px;
		column-gap: 16px;
		margin: 0;
	}

	dt {
		margin: 0;
	}

	kbd {
		display: inline-block;
		min-width: 24px;
		padding: 1px 6px;
		text-align: center;
		background-color: var(--ds-background-neutral);
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		font-family: inherit;
		font-size: 12px;
	}

	dd {
		margin: 0;
		color: var(--ds-text);
	}
</style>
