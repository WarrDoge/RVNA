<script lang="ts">
	import { goto } from "$app/navigation";
	import { enhance } from "$app/forms";
	import { untrack } from "svelte";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	
	interface Props {
		projects: { key: string; name: string }[];
		defaultProject: string;
		onClose: () => void;
	}

	let { projects, defaultProject, onClose }: Props = $props();

	let name = $state("New board");
	let type = $state<"scrum" | "kanban">("scrum");
	let projectKey = $state(
		untrack(() => defaultProject || projects[0]?.key || ""),
	);
	let filterJql = $state(
		untrack(() => (projectKey ? `project = "${projectKey}"` : "")),
	);
	let error = $state<string | null>(null);
	let busy = $state(false);

	function changeProject(value: string) {
		projectKey = value;
		if (
			filterJql === "" ||
			/^project = "?[A-Z][A-Z0-9_]*"?$/.test(filterJql.trim())
		) {
			filterJql = `project = "${value}"`;
		}
	}

	function message(data: unknown) {
		if (
			typeof data === "object" &&
			data !== null &&
			"error" in data &&
			typeof data.error === "string"
		) {
			return data.error;
		}
		return "Something went wrong";
	}
</script>

{#snippet footer()}
	<Button
		appearance="primary"
		type="submit"
		form="create-board-form"
		isLoading={busy}
		isDisabled={
			name.trim() === "" || projectKey === "" || filterJql.trim() === ""
		}
	>
		Create
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal title="Create board" width={520} {onClose} {footer}>
	<form
		id="create-board-form"
		method="POST"
		use:enhance={() => {
			busy = true;
			error = null;
			return async ({ result, update }) => {
				busy = false;
				if (result.type === "failure") {
					error = message(result.data);
					return;
				}
				if (result.type === "error") {
					error = "Something went wrong";
					return;
				}
				if (result.type === "redirect") {
					await goto(result.location);
					return;
				}
				await update();
			};
		}}
	>
		<input type="hidden" name="intent" value="create" />
		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}
		<div class="field">
			<span class="label">Name</span>
			<input
				class="input"
				name="name"
				aria-label="Board name"
				value={name}
				oninput={(event) => (name = event.currentTarget.value)}
			/>
		</div>
		<div class="field">
			<span class="label">Type</span>
			<select
				class="input"
				name="type"
				aria-label="Board type"
				value={type}
				onchange={(event) =>
					(type = event.currentTarget.value as "scrum" | "kanban")}
			>
				<option value="scrum">Scrum</option>
				<option value="kanban">Kanban</option>
			</select>
		</div>
		<div class="field">
			<span class="label">Project</span>
			<select
				class="input"
				name="project"
				aria-label="Board project"
				value={projectKey}
				onchange={(event) => changeProject(event.currentTarget.value)}
			>
				{#each projects as project (project.key)}
					<option value={project.key}>{project.name} ({project.key})</option>
				{/each}
			</select>
		</div>
		<div class="field">
			<span class="label">Filter</span>
			<input
				class="input"
				name="filterJql"
				aria-label="Board filter"
				value={filterJql}
				oninput={(event) => (filterJql = event.currentTarget.value)}
			/>
		</div>
	</form>
</Modal>

<style>
	form {
		margin: 0;
	}

	.field {
		margin-bottom: 12px;
	}

	.label {
		display: block;
		margin-bottom: 4px;
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle, #a9abaf);
	}

	.input {
		width: 100%;
		height: 32px;
		padding: 0 8px;
		background-color: var(--ds-background-input, #242528);
		border: 1px solid var(--ds-border-input, #7e8188);
		border-radius: 3px;
		color: var(--ds-text, #cecfd2);
		font-size: 14px;
	}

	.error {
		margin: 0 0 12px;
		color: #e5493a;
	}
</style>
