<script lang="ts">
	import { enhance } from "$app/forms";
	import { invalidate } from "$app/navigation";
	import type { AdminField } from "#lib/admin/custom-fields.ts";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Banner from "#lib/admin/Banner.svelte";
	import ErrorText from "#lib/admin/ErrorText.svelte";
	import FormField from "#lib/components/FormField.svelte";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";

	interface Props {
		field: AdminField;
		candidates: AdminField[];
		onClose: () => void;
	}

	let { field, candidates, onClose }: Props = $props();

	let migrateTo = $state("");
	let refusal = $state<string | null>(null);
	let error = $state<string | null>(null);
	let pending = $state(false);

	let used = $derived(field.issueCount > 0);
	let needsMigration = $derived(used || refusal !== null);

	function failureMessage(data: unknown) {
		if (
			typeof data === "object" &&
			data !== null &&
			"error" in data &&
			typeof data.error === "string"
		) {
			return data.error;
		}
		return "Could not delete the custom field";
	}
</script>

{#snippet footer()}
	<Button
		appearance="danger"
		type="submit"
		form="delete-field-form"
		isLoading={pending}
		isDisabled={needsMigration && migrateTo === ""}
	>
		{migrateTo === "" ? "Delete" : "Migrate and delete"}
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal title="Delete custom field" {onClose} {footer}>
	<form
		id="delete-field-form"
		method="POST"
		use:enhance={() => {
			pending = true;
			error = null;
			return async ({ result }) => {
				pending = false;
				if (result.type === "failure") {
					if (result.status === 409) {
						refusal = failureMessage(result.data);
					} else {
						error = failureMessage(result.data);
					}
					return;
				}
				if (result.type === "error") {
					error = "Could not delete the custom field";
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
		<input type="hidden" name="intent" value="delete" />
		<input type="hidden" name="id" value={field.id} />
		{#if needsMigration}
			<p class="dialog-text refusal">
				{refusal ??
					`${field.issueCount} issue${field.issueCount === 1 ? "" : "s"} store${field.issueCount === 1 ? "s" : ""} a value for ${field.name}. Choose another field of the same type to move the values to.`}
			</p>
			{#if candidates.length > 0}
				<FormField
					label="Move the values to"
					htmlFor="migrate-field"
					hint="The target field must have the same type and an enabled option for every value in use."
				>
					{#snippet children(aria)}
					<select
						id="migrate-field"
						name="migrateTo"
						bind:value={migrateTo}
						style={inputStyle} aria-describedby={aria.describedBy} aria-invalid={aria.invalid || undefined} aria-required={aria.required || undefined}>
						<option value="">Choose a field</option>
						{#each candidates as candidate (candidate.id)}
							<option value={candidate.id}>{candidate.name}</option>
						{/each}
					</select>
					{/snippet}
				</FormField>
			{:else}
				<Banner tone="warning">
					There is no other field of this type to move the values to, so this
					field cannot be deleted.
				</Banner>
			{/if}
		{:else}
			<p class="dialog-text">
				Delete {field.name}? Its options and contexts are removed with it. This
				cannot be undone.
			</p>
		{/if}
		{#if error}
			<ErrorText>{error}</ErrorText>
		{/if}
	</form>
</Modal>

<style>
	.dialog-text {
		margin: 0;
	}

	.dialog-text.refusal {
		margin: 0 0 12px;
	}
</style>
