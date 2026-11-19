<script lang="ts">
	import Button from "#lib/components/Button.svelte";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import type { DevelopmentRow } from "./development-dialog.ts";

	interface Props {
		title: string;
		width: number;
		columns: string[];
		rows: DevelopmentRow[];
		empty: string;
		onClose: () => void;
	}

	let { title, width, columns, rows, empty, onClose }: Props = $props();
</script>

{#snippet footer()}
	<Button appearance="subtle" onclick={onClose}>Close</Button>
{/snippet}

<Modal {title} {width} {onClose} {footer}>
	<table class="fat-table table">
		<thead>
			<tr>
				{#each columns as column (column)}
					<th>{column}</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#if rows.length === 0}
				<tr>
					<td colspan={columns.length} class="muted">{empty}</td>
				</tr>
			{/if}
			{#each rows as row (row.id)}
				<tr>
					{#each row.cells as cell, index (index)}
						<td>
							{#if cell.href}
								<a
									href={cell.href}
									target="_blank"
									rel="noopener noreferrer"
									class="link"
								>
									{cell.text}
								</a>
							{:else if cell.lozenge}
								<Lozenge appearance={cell.lozenge}>{cell.text}</Lozenge>
							{:else if cell.title}
								<span title={cell.title}>{cell.text}</span>
							{:else}
								{cell.text}
							{/if}
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</Modal>

<style>
	.link {
		color: var(--ds-link, #0c66e4);
		text-decoration: none;
	}

	.table {
		width: 100%;
	}

	.muted {
		color: var(--ds-text-subtle, #596773);
	}
</style>
