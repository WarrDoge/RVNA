<script lang="ts">
	import { enhance } from "$app/forms";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import { DASHBOARD_LAYOUTS } from "#lib/shared/gadgets.ts";
	import { formError } from "#lib/dashboards/gadget-helpers.ts";
	import type { DashboardDetail } from "#lib/dashboards/types.ts";

	interface Props {
		dashboard: DashboardDetail;
		intent: string;
		onClose: () => void;
		onsuccess?: () => void;
	}

	let { dashboard, intent, onClose, onsuccess }: Props = $props();

	// svelte-ignore state_referenced_locally
	let name = $state(dashboard.name);
	// svelte-ignore state_referenced_locally
	let description = $state(dashboard.description ?? "");
	// svelte-ignore state_referenced_locally
	let layout = $state(dashboard.layout);
	// svelte-ignore state_referenced_locally
	let shared = $state(dashboard.shared);
	let error = $state<string | null>(null);
	let pending = $state(false);
</script>

{#snippet footer()}
	<Button appearance="primary" type="submit" isLoading={pending}>Save</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<form
	method="POST"
	class="dialog-form"
	use:enhance={() => {
		pending = true;
		error = null;
		return async ({ result, update }) => {
			pending = false;
			if (result.type === "failure") {
				error = formError(result.data);
				return;
			}
			if (result.type === "error") {
				error = result.error.message;
				return;
			}
			if (result.type === "success") onsuccess?.();
			await update();
		};
	}}
>
	<input type="hidden" name="intent" value={intent} />
	<Modal title="Edit dashboard" {onClose} {footer}>
		{#if error}
			<p role="alert" class="error">{error}</p>
		{/if}
		<input type="hidden" name="id" value={dashboard.id} />
		<label class="label">
			Name
			<input
				aria-label="Dashboard name"
				name="name"
				class="input"
				bind:value={name}
				autocomplete="off"
			/>
		</label>
		<label class="label spaced">
			Description
			<textarea
				aria-label="Dashboard description"
				name="description"
				class="input description"
				bind:value={description}
			></textarea>
		</label>
		<label class="label spaced">
			Layout
			<select
				aria-label="Dashboard layout"
				name="layout"
				class="input"
				bind:value={layout}
			>
				{#each DASHBOARD_LAYOUTS as item (item.value)}
					<option value={item.value}>{item.label}</option>
				{/each}
			</select>
		</label>
		<label class="checkbox">
			<input
				type="checkbox"
				name="shared"
				checked={shared}
				onchange={(event) => (shared = event.currentTarget.checked)}
			/>
			Share with everyone who signs in
		</label>
	</Modal>
</form>

<style>
	.dialog-form {
		margin: 0;
	}
	.error {
		margin-top: 0;
		color: #e5493a;
	}
	.label {
		display: block;
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle);
	}
	.label.spaced {
		margin-top: 12px;
	}
	.input {
		display: block;
		width: 100%;
		min-height: 32px;
		margin-top: 4px;
		padding: 4px 8px;
		background: var(--ds-background-input);
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text);
		font-size: 14px;
	}
	.description {
		min-height: 64px;
	}
	.checkbox {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 12px;
		font-size: 13px;
	}
</style>
