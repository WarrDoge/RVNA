<script lang="ts">
	import { enhance } from "$app/forms";
	import { page } from "$app/state";
	import { untrack } from "svelte";
	import Banner from "#lib/admin/Banner.svelte";
	import FormField from "#lib/components/FormField.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import { formAction } from "#lib/admin/users.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";

	let {
		user,
		onClose,
	}: {
		user: { id: string; displayName: string; email: string | null };
		onClose: () => void;
	} = $props();

	const formId = "edit-user-details-form";

	let displayName = $state(untrack(() => user.displayName));
	let email = $state(untrack(() => user.email ?? ""));
	let busy = $state(false);
	let error = $state<string | null>(null);
	let action = $derived(formAction(page.url, "updateDetails"));
</script>

{#snippet footer()}
	<Button
		appearance="primary"
		type="submit"
		form={formId}
		isLoading={busy}>Save</Button
	>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal title="Edit details" {onClose} width={480} {footer}>
	{#if error}
		<Banner tone="danger">{error}</Banner>
	{/if}
	<form
		id={formId}
		method="POST"
		action={action}
		novalidate
		use:enhance={() => {
			error = null;
			busy = true;
			return async ({ result, update }) => {
				busy = false;
				if (result.type === "failure") {
					const data = result.data as { error?: unknown } | null;
					error =
						typeof data?.error === "string"
							? data.error
							: "Something went wrong";
					return;
				}
				if (result.type === "error") {
					error = "Something went wrong";
					return;
				}
				await update();
				onClose();
			};
		}}
	>
		<input type="hidden" name="userId" value={user.id} />
		<FormField label="Display name" htmlFor="edit-display-name">
			<input
				id="edit-display-name"
				name="displayName"
				bind:value={displayName}
				style={inputStyle}
			/>
		</FormField>
		<FormField label="Email address" htmlFor="edit-email">
			<input
				id="edit-email"
				name="email"
				type="email"
				bind:value={email}
				style={inputStyle}
			/>
		</FormField>
	</form>
</Modal>

<style>
	form {
		margin: 0;
	}
</style>
