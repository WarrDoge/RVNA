<script lang="ts">
	import { enhance } from "$app/forms";
	import { invalidate } from "$app/navigation";
	import Banner from "#lib/admin/Banner.svelte";
	import ErrorText from "#lib/admin/ErrorText.svelte";
	import FormField from "#lib/components/FormField.svelte";
	import type { FieldOptionChild } from "#lib/admin/custom-fields.ts";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";

	interface Props {
		fieldId: string;
		option: FieldOptionChild;
		parentId: string | null;
		siblings: FieldOptionChild[];
		onClose: () => void;
	}

	let { fieldId, option, parentId, siblings, onClose }: Props = $props();

	let migrateTo = $state("");
	let refusal = $state<string | null>(null);
	let error = $state<string | null>(null);
	let pending = $state(false);

	let migrateCandidates = $derived(
		siblings.filter((candidate) => candidate.id !== option.id),
	);

	function failureMessage(data: unknown) {
		if (
			typeof data === "object" &&
			data !== null &&
			"error" in data &&
			typeof data.error === "string"
		) {
			return data.error;
		}
		return "Could not delete the option";
	}
</script>

{#snippet footer()}
	<Button
		appearance="danger"
		type="submit"
		form="delete-option-form"
		isLoading={pending}
		isDisabled={refusal !== null && migrateTo === ""}
	>
		{migrateTo === "" ? "Delete" : "Migrate and delete"}
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal title="Delete option" {onClose} {footer}>
	<form
		id="delete-option-form"
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
					error = "Could not delete the option";
					return;
				}
				if (result.type === "success") {
					onClose();
					await Promise.all([
						invalidate("app:admin-field"),
						invalidate("app:admin-fields"),
					]);
				}
			};
		}}
	>
		<input type="hidden" name="intent" value="deleteOption" />
		<input type="hidden" name="id" value={fieldId} />
		<input type="hidden" name="optionId" value={option.id} />
		<input type="hidden" name="parentOptionId" value={parentId ?? ""} />
		{#if refusal !== null}
			<p class="dialog-text refusal">{refusal}</p>
			{#if migrateCandidates.length > 0}
				<FormField
					label="Move the issues to"
					htmlFor="migrate-option"
					hint="Only options of the same list can take the values."
				>
					{#snippet children(aria)}
					<select
						id="migrate-option"
						name="migrateTo"
						bind:value={migrateTo}
						style={inputStyle} aria-describedby={aria.describedBy} aria-invalid={aria.invalid || undefined} aria-required={aria.required || undefined}>
						<option value="">Choose an option</option>
						{#each migrateCandidates as candidate (candidate.id)}
							<option value={candidate.id}>{candidate.value}</option>
						{/each}
					</select>
					{/snippet}
				</FormField>
			{:else}
				<Banner tone="warning">
					There is no other option in this list to move the values to, so this
					option cannot be deleted.
				</Banner>
			{/if}
		{:else}
			<p class="dialog-text">
				Delete {option.value}? Issues that use it keep their value until you
				migrate them.
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
