<script lang="ts">
	import { enhance } from "$app/forms";
	import Banner from "#lib/admin/Banner.svelte";
	import FormField from "#lib/components/FormField.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import type { ProjectSummary } from "./types.ts";

	interface Props {
		project: ProjectSummary;
		onClose: () => void;
	}

	let { project, onClose }: Props = $props();
	let confirmKey = $state("");
	let error = $state<string | null>(null);
	let busy = $state(false);

	const formId = $props.id();
	let matches = $derived(confirmKey.trim() === project.key);

	function failureMessage(result: { data?: unknown }) {
		const data = result.data as { error?: unknown } | null;
		return typeof data?.error === "string"
			? data.error
			: "Something went wrong";
	}
</script>

{#snippet footer()}
	<Button
		type="submit"
		form={formId}
		appearance="danger"
		isLoading={busy}
		isDisabled={!matches}
	>
		Delete
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal title="Delete project" width={520} {onClose} {footer}>
	{#if error}
		<Banner tone="danger">{error}</Banner>
	{/if}
	<form
		id={formId}
		method="POST"
		use:enhance={({ cancel }) => {
			error = null;
			if (!matches) {
				cancel();
				return;
			}
			busy = true;
			return async ({ result, update }) => {
				busy = false;
				if (result.type === "failure") {
					error = failureMessage(result);
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
		<input type="hidden" name="intent" value="remove" />
		<input type="hidden" name="key" value={project.key} />
		<p class="message">
			Deleting <strong>{project.name}</strong> removes the project and its
			{project.issueCount}
			{project.issueCount === 1 ? "issue" : "issues"} with all comments, history,
			components and versions. This cannot be undone.
		</p>
		<FormField
			label={`Type ${project.key} to confirm`}
			htmlFor="confirm-project-key"
			error={confirmKey !== "" && !matches
				? "Type the project key to confirm"
				: null}
		>
			{#snippet children(aria)}
			<input
				id="confirm-project-key"
				name="confirmKey"
				value={confirmKey}
				oninput={(event) => (confirmKey = event.currentTarget.value)}
				style="{inputStyle} width: 200px;" aria-describedby={aria.describedBy} aria-invalid={aria.invalid || undefined} aria-required={aria.required || undefined}/>
			{/snippet}
		</FormField>
	</form>
</Modal>

<style>
	form {
		margin: 0;
	}

	.message {
		margin: 0 0 12px;
	}
</style>
