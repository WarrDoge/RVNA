<script lang="ts">
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import {
		type DashboardLayout,
		GADGET_TYPES,
		layoutColumns,
	} from "#lib/shared/gadgets.ts";
	import { columnIds, errorMessage } from "#lib/dashboards/gadget-helpers.ts";
	import type { DashboardDetail } from "#lib/dashboards/types.ts";

	interface Props {
		dashboard: DashboardDetail;
		onClose: () => void;
		onAdded: () => void;
	}

	let { dashboard, onClose, onAdded }: Props = $props();

	let error = $state<string | null>(null);
	let pending = $state<string | null>(null);

	async function add(type: string) {
		if (pending) return;
		pending = type;
		error = null;
		try {
			const columnCount = layoutColumns(
				dashboard.layout as DashboardLayout,
			);
			const ids = columnIds(dashboard.gadgets, columnCount);
			let target = 0;
			for (let column = 1; column < ids.length; column += 1) {
				if ((ids[column]?.length ?? 0) < (ids[target]?.length ?? 0)) {
					target = column;
				}
			}
			await api(`/api/dashboards/${dashboard.id}/gadgets`, {
				method: "POST",
				body: JSON.stringify({
					type,
					column: target,
					row: ids[target]?.length ?? 0,
				}),
			});
			onAdded();
			onClose();
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			pending = null;
		}
	}
</script>

{#snippet footer()}
	<Button appearance="subtle" onclick={onClose}>Close</Button>
{/snippet}

<Modal title="Add gadget" {onClose} width={620} {footer}>
	{#if error}
		<p role="alert" class="error">{error}</p>
	{/if}
	<div class="grid">
		{#each GADGET_TYPES as gadget (gadget.type)}
			<div class="choice" data-gadget-type={gadget.type}>
				<strong>{gadget.title}</strong>
				<span class="description">{gadget.description}</span>
				<Button
					appearance="primary"
					isLoading={pending === gadget.type}
					isDisabled={pending !== null}
					onclick={() => void add(gadget.type)}
				>
					Add
				</Button>
			</div>
		{/each}
	</div>
</Modal>

<style>
	.error {
		margin-top: 0;
		color: #e5493a;
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.choice {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px;
		border: 1px solid var(--ds-border);
		border-radius: 3px;
	}
	strong {
		font-size: 14px;
	}
	.description {
		font-size: 12px;
		color: var(--ds-text-subtle);
		flex: 1;
	}
</style>
