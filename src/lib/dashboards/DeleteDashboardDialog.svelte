<script lang="ts">
	import { enhance } from "$app/forms";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import { formError } from "./gadget-helpers.ts";
	import type { Dashboard } from "./types.ts";

	interface Props {
		dashboard: Dashboard;
		intent: string;
		onClose: () => void;
		onsuccess?: () => void;
	}

	let { dashboard, intent, onClose, onsuccess }: Props = $props();

	let error = $state<string | null>(null);
	let pending = $state(false);
</script>

{#snippet footer()}
	<Button appearance="danger" type="submit" isLoading={pending}>Delete</Button>
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
	<Modal title="Delete dashboard" {onClose} {footer}>
		{#if error}
			<p role="alert" class="error">{error}</p>
		{/if}
		<input type="hidden" name="id" value={dashboard.id} />
		<p class="message">Delete {dashboard.name} and all of its gadgets?</p>
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
	.message {
		margin: 0;
	}
</style>
