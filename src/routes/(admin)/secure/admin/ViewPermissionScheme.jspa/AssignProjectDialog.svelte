<script lang="ts">
	import { enhance } from "$app/forms";
	import Banner from "#lib/admin/Banner.svelte";
	import FormField from "#lib/components/FormField.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import Modal from "#lib/components/Modal.svelte";

	type ProjectRef = { id: string; key: string; name: string };

	interface Props {
		schemeId: string;
		projects: ProjectRef[];
		onClose: () => void;
	}

	let { schemeId, projects, onClose }: Props = $props();
	let projectId = $state("");
	let error = $state<string | null>(null);
	let busy = $state(false);
	let confirming = $state(false);
	let confirmed = false;
	let formElement: HTMLFormElement | null = $state(null);

	const formId = $props.id();

	let selected = $derived(projects.find((project) => project.id === projectId));

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
		isDisabled={projectId === ""}
	>
		Assign
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal
	title="Assign permission scheme to a project"
	width={480}
	{onClose}
	{footer}
>
	{#if error}
		<Banner tone="danger">{error}</Banner>
	{/if}
	<form
		id={formId}
		bind:this={formElement}
		method="POST"
		use:enhance={({ cancel }) => {
			error = null;
			if (projectId === "") {
				cancel();
				return;
			}
			if (!confirmed) {
				cancel();
				confirming = true;
				return;
			}
			busy = true;
			return async ({ result, update }) => {
				busy = false;
				confirmed = false;
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
		<input type="hidden" name="intent" value="assign" />
		<input type="hidden" name="schemeId" value={schemeId} />
		<FormField label="Project" htmlFor="assign-scheme-project">
			<select
				id="assign-scheme-project"
				name="projectId"
				bind:value={projectId}
				style="{inputStyle} appearance: auto;"
			>
				<option value="">Choose a project</option>
				{#each projects as project (project.id)}
					<option value={project.id}>{project.key} — {project.name}</option>
				{/each}
			</select>
		</FormField>
		<p class="hint">
			The project leaves its current scheme. This assignment is kept when the
			Jira import runs again.
		</p>
	</form>
</Modal>

{#if confirming}
	<ConfirmDialog
		title="Assign permission scheme"
		message={`Assign this scheme to ${selected ? `${selected.key} — ${selected.name}` : "the project"}? The project leaves its current scheme.`}
		confirmLabel="Assign"
		onConfirm={() => {
			confirmed = true;
			confirming = false;
			formElement?.requestSubmit();
		}}
		onClose={() => (confirming = false)}
	/>
{/if}

<style>
	form {
		margin: 0;
	}

	.hint {
		margin: 0;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}
</style>
