<script lang="ts">
	import { enhance } from "$app/forms";
	import { invalidate } from "$app/navigation";
	import type { AdminField } from "#lib/admin/custom-fields.ts";
	import { inputStyle, textareaStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import ErrorText from "#lib/admin/ErrorText.svelte";
	import FormField from "#lib/components/FormField.svelte";
	import Modal from "#lib/components/Modal.svelte";

	interface Props {
		field: AdminField;
		onClose: () => void;
	}

	let { field, onClose }: Props = $props();

	function initial<T>(read: () => T) {
		return read();
	}

	let name = $state(initial(() => field.name));
	let description = $state(initial(() => field.description ?? ""));
	let required = $state(initial(() => field.required));
	let error = $state<string | null>(null);
	let pending = $state(false);

	function failureMessage(data: unknown) {
		if (
			typeof data === "object" &&
			data !== null &&
			"error" in data &&
			typeof data.error === "string"
		) {
			return data.error;
		}
		return "Could not save the custom field";
	}
</script>

{#snippet footer()}
	<Button
		appearance="primary"
		type="submit"
		form="edit-field-form"
		isLoading={pending}
		isDisabled={name.trim() === ""}
	>
		Save
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal title="Edit custom field" {onClose} {footer}>
	<form
		id="edit-field-form"
		method="POST"
		use:enhance={() => {
			pending = true;
			error = null;
			return async ({ result }) => {
				pending = false;
				if (result.type === "failure") {
					error = failureMessage(result.data);
					return;
				}
				if (result.type === "error") {
					error = "Could not save the custom field";
					return;
				}
				onClose();
				await Promise.all([
					invalidate("app:admin-fields"),
					invalidate("app:admin-field"),
				]);
			};
		}}
	>
		<input type="hidden" name="intent" value="update" />
		<input type="hidden" name="id" value={field.id} />
		<FormField label="Name" htmlFor="edit-field-name">
			<input
				id="edit-field-name"
				name="name"
				bind:value={name}
				style={inputStyle}
			/>
		</FormField>
		<FormField label="Description" htmlFor="edit-field-description">
			<textarea
				id="edit-field-description"
				name="description"
				rows={3}
				bind:value={description}
				style={textareaStyle}
			></textarea>
		</FormField>
		<label class="required-label">
			<input type="checkbox" name="required" bind:checked={required} />
			Required
		</label>
		{#if error}
			<ErrorText>{error}</ErrorText>
		{/if}
	</form>
</Modal>

<style>
	.required-label {
		display: flex;
		align-items: center;
		gap: 8px;
	}
</style>
