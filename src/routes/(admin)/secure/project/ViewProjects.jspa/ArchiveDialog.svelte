<script lang="ts">
	import { enhance } from "$app/forms";
	import Banner from "#lib/admin/Banner.svelte";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import type { ProjectSummary } from "./types.ts";

	interface Props {
		project: ProjectSummary;
		onClose: () => void;
	}

	let { project, onClose }: Props = $props();
	let error = $state<string | null>(null);
	let busy = $state(false);

	const formId = $props.id();

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
		appearance="primary"
		isLoading={busy}
	>
		{project.archived ? "Restore" : "Archive"}
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal
	title={project.archived ? "Restore project" : "Archive project"}
	width={480}
	{onClose}
	{footer}
>
	{#if error}
		<Banner tone="danger">{error}</Banner>
	{/if}
	<form
		id={formId}
		method="POST"
		use:enhance={() => {
			error = null;
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
		<input type="hidden" name="intent" value="archive" />
		<input type="hidden" name="key" value={project.key} />
		<input type="hidden" name="archived" value={project.archived ? "false" : "true"} />
		<p class="message">
			{project.archived
				? `Restore ${project.name}? It becomes writable again.`
				: `Archive ${project.name}? Its issues become read-only and the project disappears from the project picker.`}
		</p>
	</form>
</Modal>

<style>
	form {
		margin: 0;
	}

	.message {
		margin: 0;
	}
</style>
