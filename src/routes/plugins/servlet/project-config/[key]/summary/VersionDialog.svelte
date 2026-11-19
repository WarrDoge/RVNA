<script lang="ts">
	import { enhance } from "$app/forms";
	import { inputStyle, textareaStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import type { VersionRow } from "./types.ts";

	interface Props {
		version: VersionRow | "new";
		onClose: () => void;
	}

	let { version, onClose }: Props = $props();

	// svelte-ignore state_referenced_locally
	const editing = version === "new" ? null : version;
	let name = $state(editing?.name ?? "");
	let description = $state(editing?.description ?? "");
	let startDate = $state(editing?.startDate ?? "");
	let releaseDate = $state(editing?.releaseDate ?? "");
	let released = $state(editing?.released ?? false);
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
		title={editing ? "Edit version" : "Add version"}
		width={480}
		{onClose}
		{footer}
	>
		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}
		<input type="hidden" name="intent" value="version" />
		<input type="hidden" name="versionId" value={editing?.id ?? ""} />
		<div class="field">
			<span class="field-label">Name</span>
			<input
				aria-label="Version name"
				name="name"
				value={name}
				oninput={(event) => (name = event.currentTarget.value)}
				style={inputStyle}
			/>
		</div>
		<div class="field">
			<span class="field-label">Description</span>
			<textarea
				aria-label="Version description"
				name="description"
				value={description}
				oninput={(event) => (description = event.currentTarget.value)}
				style={textareaStyle}
			></textarea>
		</div>
		<div class="date-row">
			<div class="date-field">
				<span class="field-label">Start date</span>
				<input
					aria-label="Start date"
					type="date"
					name="startDate"
					value={startDate}
					oninput={(event) => (startDate = event.currentTarget.value)}
					style={inputStyle}
				/>
			</div>
			<div class="date-field">
				<span class="field-label">Release date</span>
				<input
					aria-label="Release date"
					type="date"
					name="releaseDate"
					value={releaseDate}
					oninput={(event) => (releaseDate = event.currentTarget.value)}
					style={inputStyle}
				/>
			</div>
		</div>
		<label class="released">
			<input
				type="checkbox"
				name="released"
				checked={released}
				onchange={(event) => (released = event.currentTarget.checked)}
			/>
			Released
		</label>
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

	.date-row {
		display: flex;
		gap: 12px;
	}

	.date-field {
		flex: 1;
		margin-bottom: 12px;
	}

	.released {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--ds-text);
	}
</style>
