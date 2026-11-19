<script lang="ts">
	import { untrack } from "svelte";
	import { enhance } from "$app/forms";
	import type { BoardConfig, BoardSwimlane } from "#lib/api-types.ts";
	import Button from "#lib/components/Button.svelte";
	import SaveRow from "./SaveRow.svelte";

	interface Props {
		board: BoardConfig;
		canEdit: boolean;
	}

	let { board, canEdit }: Props = $props();

	let strategy = $state(untrack(() => board.swimlaneStrategy));
	let lanes = $state<BoardSwimlane[]>(untrack(() => board.swimlanes));
	let saved = $state(false);
	let error = $state<string | null>(null);
	let pending = $state(false);

	function reset() {
		strategy = board.swimlaneStrategy;
		lanes = board.swimlanes;
	}

	function updateLane(index: number, values: Partial<BoardSwimlane>) {
		lanes = lanes.map((lane, itemIndex) =>
			itemIndex === index ? { ...lane, ...values } : lane,
		);
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
	class="swimlanes"
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
			reset();
		};
	}}
>
	<input type="hidden" name="intent" value="swimlanes" />
	<input type="hidden" name="rapidView" value={board.rapidViewId} />
	<div class="field">
		<span class="label">Swimlanes</span>
		<select
			class="input"
			aria-label="Swimlane strategy"
			name="swimlaneStrategy"
			bind:value={() => strategy, (value) => {
				strategy = value as BoardConfig["swimlaneStrategy"];
				saved = false;
			}}
			disabled={!canEdit}
		>
			<option value="none">No swimlanes</option>
			<option value="assignee">Assignees</option>
			<option value="epic">Epics</option>
			<option value="queries">Queries</option>
		</select>
	</div>
	{#if strategy === "queries"}
		<div class="lane-list">
			{#each lanes as lane, index (lane.id)}
				<div class="lane">
					<input
						class="input lane-name"
						name="laneName"
						aria-label={`Swimlane name ${index + 1}`}
						bind:value={() => lane.name, (value) =>
							updateLane(index, { name: value })}
						disabled={!canEdit}
					/>
					<input
						class="input"
						name="laneJql"
						aria-label={`Swimlane JQL ${index + 1}`}
						bind:value={() => lane.jql, (value) =>
							updateLane(index, { jql: value })}
						disabled={!canEdit}
					/>
					<Button
						spacing="compact"
						appearance="danger"
						onclick={() => {
							lanes = lanes.filter((_, itemIndex) => itemIndex !== index);
							saved = false;
						}}
						isDisabled={!canEdit}
					>
						Remove
					</Button>
				</div>
			{/each}
			<div>
				<Button
					onclick={() => {
						lanes = [
							...lanes,
							{
								id: crypto.randomUUID(),
								name: "New swimlane",
								jql: "",
								sequence: lanes.length,
							},
						];
						saved = false;
					}}
					isDisabled={!canEdit}
				>
					Add swimlane
				</Button>
			</div>
		</div>
	{/if}
	<div class="save">
		<SaveRow {saved} {error} pending={pending} disabled={!canEdit} />
	</div>
</form>

<style>
	form {
		margin: 0;
	}

	.swimlanes {
		max-width: 760px;
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

	.lane-list {
		display: grid;
		gap: 8px;
	}

	.lane {
		display: flex;
		gap: 8px;
	}

	.lane-name {
		max-width: 200px;
	}

	.save {
		margin-top: 12px;
	}
</style>
