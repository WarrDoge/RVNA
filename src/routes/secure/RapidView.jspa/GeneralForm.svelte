<script lang="ts">
	import { untrack } from "svelte";
	import { enhance } from "$app/forms";
	import type { BoardConfig } from "#lib/api-types.ts";
	import SaveRow from "./SaveRow.svelte";

	interface Props {
		board: BoardConfig;
		canEdit: boolean;
	}

	let { board, canEdit }: Props = $props();

	let name = $state(untrack(() => board.name));
	let filterJql = $state(untrack(() => board.filterJql));
	let subFilterJql = $state(untrack(() => board.subFilterJql ?? ""));
	let backlogStatus = $state(untrack(() => board.kanbanBacklogStatus?.id ?? ""));
	let saved = $state(false);
	let error = $state<string | null>(null);
	let pending = $state(false);

	function changed() {
		saved = false;
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

<form
	class="general"
	method="POST"
	use:enhance={() => {
		pending = true;
		error = null;
		return async ({ result, update }) => {
			pending = false;
			if (result.type === "failure") {
				saved = false;
				error = message(result.data);
				return;
			}
			if (result.type === "error") {
				saved = false;
				error = "Something went wrong";
				return;
			}
			error = null;
			saved = true;
			await update({ navigate: false, reset: false });
			name = board.name;
			filterJql = board.filterJql;
			subFilterJql = board.subFilterJql ?? "";
			backlogStatus = board.kanbanBacklogStatus?.id ?? "";
		};
	}}
>
	<input type="hidden" name="intent" value="general" />
	<input type="hidden" name="rapidView" value={board.rapidViewId} />
	<div class="field">
		<span class="label">Name</span>
		<input
			class="input"
			name="name"
			aria-label="Board name"
			bind:value={() => name, (value) => {
				name = value;
				changed();
			}}
			disabled={!canEdit}
		/>
	</div>
	<div class="field">
		<span class="label">Project</span>
		<input
			class="input"
			aria-label="Board project"
			value={board.project?.name ?? ""}
			readonly
		/>
	</div>
	<div class="field">
		<span class="label">Filter query</span>
		<input
			class="input"
			name="filterJql"
			aria-label="Filter query"
			bind:value={() => filterJql, (value) => {
				filterJql = value;
				changed();
			}}
			disabled={!canEdit}
		/>
	</div>
	<div class="field">
		<span class="label">Sub-filter query</span>
		<input
			class="input"
			name="subFilterJql"
			aria-label="Sub-filter query"
			bind:value={() => subFilterJql, (value) => {
				subFilterJql = value;
				changed();
			}}
			disabled={!canEdit}
		/>
	</div>
	{#if board.type === "kanban"}
		<div class="field">
			<span class="label">Kanban backlog status</span>
			<select
				class="input"
				name="kanbanBacklogStatusId"
				aria-label="Kanban backlog status"
				bind:value={() => backlogStatus, (value) => {
					backlogStatus = value;
					changed();
				}}
				disabled={!canEdit}
			>
				<option value="">No kanban backlog</option>
				{#each board.availableStatuses as status (status.id)}
					<option value={status.id}>{status.name}</option>
				{/each}
			</select>
		</div>
	{/if}
	<SaveRow {saved} {error} pending={pending} disabled={!canEdit} />
</form>

<style>
	form {
		margin: 0;
	}

	.general {
		max-width: 680px;
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
</style>
