<script lang="ts">
	import { enhance } from "$app/forms";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import { formError } from "#lib/dashboards/gadget-helpers.ts";
	import type { DashboardDetail } from "#lib/dashboards/types.ts";

	interface Props {
		dashboard: DashboardDetail;
		intent: string;
		onClose: () => void;
		onsuccess?: () => void;
	}

	let { dashboard, intent, onClose, onsuccess }: Props = $props();

	let error = $state<string | null>(null);
	let pending = $state(false);
	// svelte-ignore state_referenced_locally
	let name = $state(`Copy of ${dashboard.name}`);
</script>

{#snippet footer()}
	<Button appearance="primary" type="submit" isLoading={pending}>Copy</Button>
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
			if (result.type === "redirect") onClose();
			await update();
		};
	}}
>
	<input type="hidden" name="intent" value={intent} />
	<Modal title="Copy dashboard" {onClose} {footer}>
		{#if error}
			<p role="alert" class="error">{error}</p>
		{/if}
		<input type="hidden" name="copyOf" value={dashboard.id} />
		<label class="label">
			Name
			<input
				aria-label="Copy name"
				name="name"
				class="input"
				bind:value={name}
				autocomplete="off"
			/>
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
</style>
