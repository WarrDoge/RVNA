<script lang="ts">
	import { enhance } from "$app/forms";
	import type { Filter } from "#lib/api-types.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";

	interface Props {
		jql: string;
		columns: string[];
		onClose: () => void;
		onSaved: (filter: Filter) => void;
	}

	let { jql, columns, onClose, onSaved }: Props = $props();

	let name = $state("");
	let description = $state("");
	let shared = $state(false);
	let error = $state<string | null>(null);
	let pending = $state(false);
</script>

{#snippet footer()}
	<Button
		appearance="primary"
		type="submit"
		form="save-filter-form"
		isLoading={pending}
		isDisabled={name.trim() === ""}
	>
		Save
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal title="Save filter" width={460} {onClose} {footer}>
	<form
		id="save-filter-form"
		method="POST"
		action="/issues/?/saveAs"
		use:enhance={() => {
			pending = true;
			error = null;
			return async ({ result }) => {
				pending = false;
				if (result.type === "failure") {
					const failure = result.data as { error?: unknown } | null;
					error =
						typeof failure?.error === "string"
							? failure.error
							: "Could not save the filter";
					return;
				}
				if (result.type === "error") {
					error = "Could not save the filter";
					return;
				}
				if (result.type === "success") {
					const created = (result.data as { filter?: Filter } | undefined)
						?.filter;
					if (created) onSaved(created);
				}
			};
		}}
	>
		<input type="hidden" name="jql" value={jql} />
		<input type="hidden" name="columns" value={columns.join(",")} />
		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}
		<label class="label" for="filter-name">Name</label>
		<input
			id="filter-name"
			name="name"
			value={name}
			oninput={(event) => (name = event.currentTarget.value)}
			class="input"
		/>
		<label class="label" for="filter-description">Description</label>
		<textarea
			id="filter-description"
			name="description"
			value={description}
			oninput={(event) => (description = event.currentTarget.value)}
			class="textarea"
		></textarea>
		<label class="checkbox">
			<input
				type="checkbox"
				name="shared"
				checked={shared}
				onchange={(event) => (shared = event.currentTarget.checked)}
			/>
			Share with everyone
		</label>
	</form>
</Modal>

<style>
	form {
		margin: 0;
	}

	.label {
		display: block;
		margin-bottom: 4px;
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 12px;
	}

	.input {
		width: 100%;
		height: 32px;
		margin-bottom: 12px;
		padding: 0 8px;
		background: var(--ds-background-input, #ffffff);
		border: 1px solid var(--ds-border-input, #8c8f97);
		border-radius: 3px;
		color: var(--ds-text, #292a2e);
	}

	.textarea {
		width: 100%;
		height: 70px;
		margin-bottom: 12px;
		padding: 8px;
		background: var(--ds-background-input, #ffffff);
		border: 1px solid var(--ds-border-input, #8c8f97);
		border-radius: 3px;
		color: var(--ds-text, #292a2e);
		resize: vertical;
	}

	.checkbox {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.error {
		margin: 0 0 12px;
		color: #e5493a;
	}
</style>
