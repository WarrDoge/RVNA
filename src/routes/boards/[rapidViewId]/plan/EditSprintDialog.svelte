<script lang="ts">
	import { enhance, type ActionResult } from "$app/forms";
	import { goto } from "$app/navigation";
	import { untrack } from "svelte";
	import type { Sprint } from "#lib/api-types.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";

	interface Props {
		sprint: Sprint;
		rapidViewId: number;
		canEditText: boolean;
		canManage: boolean;
		onClose: () => void;
		onDone: () => Promise<void>;
	}

	let {
		sprint,
		rapidViewId,
		canEditText,
		canManage,
		onClose,
		onDone,
	}: Props = $props();

	let name = $state(untrack(() => sprint.name));
	let goal = $state(untrack(() => sprint.goal ?? ""));
	let startDate = $state(untrack(() => toLocalInput(sprint.startDate)));
	let endDate = $state(untrack(() => toLocalInput(sprint.endDate)));
	let error = $state<string | null>(null);
	let pending = $state(false);

	let startIso = $derived(toIso(startDate));
	let endIso = $derived(toIso(endDate));

	function toLocalInput(value: string | null) {
		if (!value) return "";
		const date = new Date(value);
		const offset = date.getTimezoneOffset() * 60_000;
		return new Date(date.getTime() - offset).toISOString().slice(0, 16);
	}

	function toIso(value: string) {
		if (!value) return "";
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? "" : date.toISOString();
	}

	function submit() {
		pending = true;
		error = null;
		return async ({ result }: { result: ActionResult }) => {
			pending = false;
			if (result.type === "failure") {
				const data = result.data as { error?: unknown } | undefined;
				error =
					typeof data?.error === "string"
						? data.error
						: "Something went wrong";
				return;
			}
			if (result.type === "error") {
				error = result.error.message;
				return;
			}
			if (result.type === "redirect") {
				await goto(result.location);
				return;
			}
			await onDone();
		};
	}
</script>

{#snippet footer()}
	<Button
		appearance="primary"
		type="submit"
		form="edit-sprint-form"
		isLoading={pending}
		isDisabled={name.trim() === ""}
	>
		Save
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal title="Edit sprint" width={480} {onClose} {footer}>
	<form
		id="edit-sprint-form"
		method="POST"
		action={`/boards/${rapidViewId}/plan?/editSprint`}
		use:enhance={submit}
	>
		<input type="hidden" name="sprintId" value={sprint.id} />
		{#if canManage}
			<input type="hidden" name="startDate" value={startIso} />
			<input type="hidden" name="endDate" value={endIso} />
		{/if}
		<div class="fields">
			<label class="field">
				<span>Sprint name</span>
				<input
					aria-label="Sprint name"
					name="name"
					bind:value={name}
					disabled={!canEditText}
				/>
			</label>
			<label class="field">
				<span>Goal</span>
				<textarea
					aria-label="Sprint goal"
					name="goal"
					bind:value={goal}
					disabled={!canEditText}
				></textarea>
			</label>
			{#if canManage}
				<div class="dates">
					<label class="field">
						<span>Start</span>
						<input
							aria-label="Sprint start"
							type="datetime-local"
							bind:value={startDate}
						/>
					</label>
					<label class="field">
						<span>End</span>
						<input
							aria-label="Sprint end"
							type="datetime-local"
							bind:value={endDate}
						/>
					</label>
				</div>
			{/if}
			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}
		</div>
	</form>
</Modal>

<style>
	form {
		margin: 0;
	}

	.fields {
		display: grid;
		gap: 12px;
	}

	.field {
		display: grid;
		gap: 4px;
		flex: 1;
	}

	.field > span {
		font-size: 12px;
		font-weight: 600;
	}

	.dates {
		display: flex;
		gap: 12px;
	}

	input,
	textarea {
		width: 100%;
		height: 32px;
		padding: 0 8px;
		background-color: var(--ds-background-input);
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text);
		font-size: 14px;
	}

	textarea {
		height: 70px;
		padding: 8px;
	}

	.error {
		margin: 0;
		color: #e5493a;
	}
</style>
