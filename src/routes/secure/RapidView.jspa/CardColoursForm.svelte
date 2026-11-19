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

	let strategy = $state(untrack(() => board.cardColourStrategy));
	let saved = $state(false);
	let error = $state<string | null>(null);
	let pending = $state(false);

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
	class="card-colours"
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
			strategy = board.cardColourStrategy;
		};
	}}
>
	<input type="hidden" name="intent" value="cardColours" />
	<input type="hidden" name="rapidView" value={board.rapidViewId} />
	<div class="field">
		<span class="label">Card colour based on</span>
		<select
			class="input"
			aria-label="Card colour strategy"
			name="cardColourStrategy"
			bind:value={() => strategy, (value) => {
				strategy = value as BoardConfig["cardColourStrategy"];
				saved = false;
			}}
			disabled={!canEdit}
		>
			<option value="none">No colours</option>
			<option value="priority">Priority</option>
			<option value="assignee">Assignee</option>
			<option value="epic">Epic</option>
			<option value="issue_type">Issue type</option>
		</select>
	</div>
	<SaveRow {saved} {error} pending={pending} disabled={!canEdit} />
</form>

<style>
	form {
		margin: 0;
	}

	.card-colours {
		max-width: 520px;
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
