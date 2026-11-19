<script lang="ts">
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import type { Filter, ProjectSummary } from "#lib/api-types.ts";
	import { inputStyle, textareaStyle } from "#lib/admin/styles.ts";
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";

	type EditableFilter = Omit<
		Filter,
		"jql" | "columns" | "favouriteCount" | "createdAt"
	> & {
		sharedWith: {
			projectIds: string[];
			groups: string[];
			groupIds: string[];
		};
	};

	interface Props {
		filter: EditableFilter;
		onSaved: () => void;
	}

	let { filter, onSaved }: Props = $props();

	// svelte-ignore state_referenced_locally
	let name = $state(filter.name);
	// svelte-ignore state_referenced_locally
	let description = $state(filter.description ?? "");
	// svelte-ignore state_referenced_locally
	let shared = $state(filter.shared);
	// svelte-ignore state_referenced_locally
	let projectIds = $state<string[]>([...filter.sharedWith.projectIds]);
	// svelte-ignore state_referenced_locally
	let groupIds = $state<string[]>([...filter.sharedWith.groupIds]);
	let projects = $state<ProjectSummary[]>([]);
	let groups = $state<{ id: string; name: string }[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let projectsChanged = $state(false);
	let groupsChanged = $state(false);
	let error = $state<string | null>(null);
	let pending = $state(false);

	async function loadShares() {
		loading = true;
		loadError = null;
		try {
			const [projectList, groupList] = await Promise.all([
				api<ProjectSummary[]>("/api/projects"),
				api<{ id: string; name: string }[]>("/api/filters/share-groups"),
			]);
			projects = projectList;
			groups = groupList;
		} catch (cause) {
			loadError =
				cause instanceof Error ? cause.message : "Could not load shares.";
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void loadShares();
	});

	function toggle(list: string[], value: string) {
		return list.includes(value)
			? list.filter((item) => item !== value)
			: [...list, value];
	}
</script>

{#snippet footer()}
	<Button
		appearance="primary"
		type="submit"
		isLoading={pending}
		isDisabled={name.trim() === "" || loading || loadError !== null}
	>
		Save
	</Button>
	<Button appearance="subtle" onclick={onSaved}>Cancel</Button>
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
			if (result.type === "success") onSaved();
		};
	}}
>
	<Modal title="Edit filter" width={460} onClose={onSaved} {footer}>
		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}
		{#if loadError}
			<p class="error" role="alert">
				{loadError}
				<button type="button" class="retry" onclick={() => void loadShares()}>
					Retry
				</button>
			</p>
		{/if}
		{#if projectsChanged}
			<input type="hidden" name="sharedProjectIdsChanged" value="1" />
			{#each projectIds as id (id)}
				<input type="hidden" name="sharedProjectIds" value={id} />
			{/each}
		{/if}
		{#if groupsChanged}
			<input type="hidden" name="sharedGroupIdsChanged" value="1" />
			{#each groupIds as id (id)}
				<input type="hidden" name="sharedGroupIds" value={id} />
			{/each}
		{/if}
		<input type="hidden" name="filterId" value={filter.id} />
		<label class="field-label" for="edit-filter-name">Name</label>
		<input
			id="edit-filter-name"
			class="control"
			name="name"
			value={name}
			oninput={(event) => (name = event.currentTarget.value)}
			style={inputStyle}
		/>
		<label class="field-label" for="edit-filter-description">Description</label>
		<textarea
			id="edit-filter-description"
			class="control"
			name="description"
			value={description}
			oninput={(event) => (description = event.currentTarget.value)}
			style={textareaStyle}
		></textarea>
		<label class="shared">
			<input
				type="checkbox"
				name="shared"
				checked={shared}
				onchange={(event) => (shared = event.currentTarget.checked)}
			/>
			Share with everyone
		</label>

		<fieldset hidden={shared} class="shares">
			<legend>Share with the members of a project</legend>
			{#each projects as project (project.id)}
				<label class="share-row">
					<input
						type="checkbox"
						value={project.id}
						checked={projectIds.includes(project.id)}
						onchange={() => {
							projectIds = toggle(projectIds, project.id);
							projectsChanged = true;
						}}
					/>
					{project.name} ({project.key})
				</label>
			{/each}
		</fieldset>

		<fieldset hidden={shared} class="shares">
			<legend>Share with a group</legend>
			{#each groups as group (group.id)}
				<label class="share-row">
					<input
						type="checkbox"
						value={group.id}
						checked={groupIds.includes(group.id)}
						onchange={() => {
							groupIds = toggle(groupIds, group.id);
							groupsChanged = true;
						}}
					/>
					{group.name}
				</label>
			{/each}
		</fieldset>
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

	.retry {
		margin-left: 6px;
		padding: 0;
		background: transparent;
		border: 0;
		color: var(--ds-link);
		cursor: pointer;
		font: inherit;
	}

	.field-label {
		display: block;
		margin-bottom: 4px;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.control {
		margin-bottom: 12px;
	}

	.shared {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.shares {
		border: 0;
		margin: 12px 0 0;
		padding: 0;
	}

	.shares legend {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.share-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
</style>
