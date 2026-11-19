<script lang="ts">
	import { enhance } from "$app/forms";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import { formError } from "./gadget-helpers.ts";

	interface Props {
		intent: string;
		onClose: () => void;
		onsuccess?: () => void;
	}

	let { intent, onClose, onsuccess }: Props = $props();

	let error = $state<string | null>(null);
	let pending = $state(false);
</script>

{#snippet footer()}
	<Button appearance="primary" type="submit" isLoading={pending}>Create</Button>
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
	<Modal title="Create dashboard" {onClose} {footer}>
		{#if error}
			<p role="alert" class="error">{error}</p>
		{/if}
		<label class="label">
			Name
			<input
				aria-label="Dashboard name"
				name="name"
				class="input"
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
