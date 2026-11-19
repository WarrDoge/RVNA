<script lang="ts">
	import { enhance } from "$app/forms";
	import { inputStyle, textareaStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import type { ComponentRow } from "./types.ts";

	interface Props {
		component: ComponentRow | "new";
		onClose: () => void;
	}

	let { component, onClose }: Props = $props();

	// svelte-ignore state_referenced_locally
	const editing = component === "new" ? null : component;
	let name = $state(editing?.name ?? "");
	let description = $state(editing?.description ?? "");
	let error = $state<string | null>(null);
	let pending = $state(false);
</script>

{#snippet footer()}
	<Button
		appearance="primary"
		type="submit"
		isLoading={pending}
		isDisabled={name.trim() === ""}
	>
		Save
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<form
	method="POST"
	use:enhance={() => {
		pending = true;
		error = null;
		return async ({ result, update }) => {
			pending = false;
			if (result.type === "failure") {
				error = String(
					(result.data as { error?: string } | undefined)?.error ??
						"Something went wrong",
				);
			}
			await update({ reset: false });
			if (result.type === "success") onClose();
		};
	}}
>
	<Modal
		title={editing ? "Edit component" : "Add component"}
		width={480}
		{onClose}
		{footer}
	>
		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}
		<input type="hidden" name="intent" value="component" />
		<input type="hidden" name="componentId" value={editing?.id ?? ""} />
		<div class="field">
			<span class="field-label">Name</span>
			<input
				aria-label="Component name"
				name="name"
				value={name}
				oninput={(event) => (name = event.currentTarget.value)}
				style={inputStyle}
			/>
		</div>
		<div class="field">
			<span class="field-label">Description</span>
			<textarea
				aria-label="Component description"
				name="description"
				value={description}
				oninput={(event) => (description = event.currentTarget.value)}
				style={textareaStyle}
			></textarea>
		</div>
	</Modal>
</form>

<style>
	form {
		margin: 0;
	}

	.error {
		margin: 0 0 12px;
		color: #e5493a;
	}

	.field {
		margin-bottom: 12px;
	}

	.field-label {
		display: block;
		margin-bottom: 4px;
		color: var(--ds-text-subtle);
		font-size: 12px;
		font-weight: 600;
	}
</style>
