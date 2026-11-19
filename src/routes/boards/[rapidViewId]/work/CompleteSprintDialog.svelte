<script lang="ts">
	import { enhance, type SubmitFunction } from "$app/forms";
	import type { Sprint, SprintComplete } from "#lib/api-types.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";

	interface Props {
		sprint: Sprint;
		completed: number;
		incomplete: number;
		futureSprints: Sprint[];
		onClose: () => void;
		onCompleted: () => void;
	}

	let {
		sprint,
		completed,
		incomplete,
		futureSprints,
		onClose,
		onCompleted,
	}: Props = $props();

	const formId = $props.id();
	let target = $state("backlog");
	let result = $state<SprintComplete | null>(null);
	let pending = $state(false);
	let error = $state<string | null>(null);

	const submit: SubmitFunction = () => {
		pending = true;
		error = null;
		return async ({ result: actionResult }) => {
			pending = false;
			if (actionResult.type === "success") {
				result = actionResult.data as SprintComplete;
			} else if (actionResult.type === "failure") {
				error =
					(actionResult.data as { error?: string } | undefined)?.error ??
					"Something went wrong";
			} else if (actionResult.type === "error") {
				error = actionResult.error.message;
			}
		};
	};
</script>

<Modal
	title={result ? "Sprint completed" : "Complete sprint"}
	width={520}
	{onClose}
>
	{#if result}
		<div class="complete-result">
			<p>
				<strong>{result.completed}</strong>
				issue{result.completed === 1 ? "" : "s"} completed.
			</p>
			<p>
				<strong>{result.incomplete}</strong>
				incomplete issue{result.incomplete === 1 ? "" : "s"} moved to
				{result.movedToSprintId
					? (futureSprints.find((item) => item.id === result?.movedToSprintId)
							?.name ?? "a future sprint")
					: "the backlog"}.
			</p>
		</div>
	{:else}
		<form
			id={formId}
			method="POST"
			action="?/completeSprint"
			use:enhance={submit}
		>
			<input type="hidden" name="sprintId" value={sprint.id} />
			<div class="complete-body">
				<p class="summary">
					{completed} completed, {incomplete} incomplete. Unfinished issues move
					to the sprint or backlog you choose.
				</p>
				<label class="target">
					<span>Move unfinished to</span>
					<select
						name="moveToSprintId"
						aria-label="Move unfinished issues to"
						bind:value={target}
					>
						<option value="backlog">Backlog</option>
						{#each futureSprints as item (item.id)}
							<option value={item.id}>{item.name}</option>
						{/each}
					</select>
				</label>
				{#if error}
					<p class="error" role="alert">{error}</p>
				{/if}
			</div>
		</form>
	{/if}

	{#snippet footer()}
		{#if result}
			<Button appearance="primary" onclick={onCompleted}>Done</Button>
		{:else}
			<Button
				appearance="primary"
				type="submit"
				form={formId}
				isLoading={pending}
			>
				Complete sprint
			</Button>
			<Button appearance="subtle" onclick={onClose}>Cancel</Button>
		{/if}
	{/snippet}
</Modal>

<style>
	form {
		margin: 0;
	}

	.complete-body {
		display: grid;
		gap: 12px;
	}

	.complete-result {
		display: grid;
		gap: 8px;
	}

	p {
		margin: 0;
	}

	.summary {
		color: var(--ds-text-subtle, #a9abaf);
	}

	.target {
		display: grid;
		gap: 4px;
	}

	.target span {
		font-size: 12px;
		font-weight: 600;
	}

	select {
		height: 32px;
		background-color: var(--ds-background-input, #242528);
		border: 1px solid var(--ds-border-input, #7e8188);
		border-radius: 3px;
		color: var(--ds-text, #cecfd2);
		padding: 0 8px;
	}

	.error {
		color: #e5493a;
	}
</style>
