<script lang="ts">
	import { enhance } from "$app/forms";
	import { invalidate } from "$app/navigation";
	import {
		FIELD_TYPES,
		fieldTypeInfo,
		type FieldTypeId,
	} from "#lib/admin/custom-fields.ts";
	import { inputStyle, textareaStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import ErrorText from "#lib/admin/ErrorText.svelte";
	import FormField from "#lib/components/FormField.svelte";
	import Modal from "#lib/components/Modal.svelte";

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	let type = $state<FieldTypeId | null>(null);
	let name = $state("");
	let description = $state("");
	let required = $state(false);
	let error = $state<string | null>(null);
	let pending = $state(false);

	let info = $derived(fieldTypeInfo(type));

	function failureMessage(data: unknown) {
		if (
			typeof data === "object" &&
			data !== null &&
			"error" in data &&
			typeof data.error === "string"
		) {
			return data.error;
		}
		return "Could not create the custom field";
	}
</script>

{#snippet footer()}
	{#if type !== null}
		<Button appearance="subtle" onclick={() => (type = null)}>Back</Button>
	{/if}
	<Button
		appearance="primary"
		type="submit"
		form="add-field-form"
		isLoading={pending}
		isDisabled={pending || type === null || name.trim() === ""}
	>
		Create
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal
	title={info ? `Add custom field: ${info.label}` : "Add custom field"}
	width={620}
	{onClose}
	{footer}
>
	{#if type === null}
		<p class="type-intro">Choose the kind of information this field holds.</p>
		<div class="type-grid">
			{#each FIELD_TYPES as item (item.id)}
				<button
					type="button"
					class="type-button"
					onclick={() => (type = item.id)}
				>
					<span class="type-label">{item.label}</span>
					<span class="type-description">{item.description}</span>
				</button>
			{/each}
		</div>
	{:else}
		<form
			id="add-field-form"
			method="POST"
			use:enhance={({ cancel }) => {
				if (pending) {
					cancel();
					return;
				}
				pending = true;
				error = null;
				return async ({ result, update }) => {
					pending = false;
					if (result.type === "failure") {
						error = failureMessage(result.data);
						return;
					}
					if (result.type === "error") {
						error = "Could not create the custom field";
						return;
					}
					await invalidate("app:admin-fields");
					await update();
				};
			}}
		>
			<input type="hidden" name="intent" value="create" />
			<input type="hidden" name="type" value={type} />
			<FormField label="Name" htmlFor="custom-field-name">
				<!-- svelte-ignore a11y_autofocus -->
				<input
					id="custom-field-name"
					name="name"
					autofocus
					bind:value={name}
					style={inputStyle}
				/>
			</FormField>
			<FormField
				label="Description"
				htmlFor="custom-field-description"
				hint="Shown under the field on the issue, as a hint for whoever fills it in."
			>
				{#snippet children(aria)}
				<textarea
					id="custom-field-description"
					name="description"
					rows={3}
					bind:value={description}
					style={textareaStyle} aria-describedby={aria.describedBy} aria-invalid={aria.invalid || undefined} aria-required={aria.required || undefined}></textarea>
				{/snippet}
			</FormField>
			<label class="required-label">
				<input type="checkbox" name="required" bind:checked={required} />
				Required
				<span class="required-hint">
					An issue of a matching type cannot be saved without a value.
				</span>
			</label>
			{#if error}
				<ErrorText>{error}</ErrorText>
			{/if}
		</form>
	{/if}
</Modal>

<style>
	.type-intro {
		margin: 0 0 12px;
		color: var(--ds-text-subtle);
	}

	.type-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}

	.type-button {
		padding: 10px 12px;
		background-color: var(--ds-background-neutral-subtle);
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		color: var(--ds-text);
		text-align: left;
		cursor: pointer;
	}

	.type-label {
		display: block;
		font-weight: 600;
	}

	.type-description {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.required-label {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--ds-text);
	}

	.required-hint {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}
</style>
