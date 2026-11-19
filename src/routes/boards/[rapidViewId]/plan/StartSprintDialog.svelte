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
		onClose: () => void;
		onDone: () => Promise<void>;
	}

	let { sprint, rapidViewId, canEditText, onClose, onDone }: Props = $props();

	let name = $state(untrack(() => sprint.name));
	let goal = $state(untrack(() => sprint.goal ?? ""));
	let duration = $state("2");
	let start = $state(toLocalInput(new Date().toISOString()));
	let end = $state(initialEnd());
	let error = $state<string | null>(null);
	let pending = $state(false);

	let startIso = $derived(toIso(start));
	let endIso = $derived(toIso(end));

	function toLocalInput(value: string) {
		const date = new Date(value);
		const offset = date.getTimezoneOffset() * 60_000;
		return new Date(date.getTime() - offset).toISOString().slice(0, 16);
	}

	function toIso(value: string) {
		if (!value) return "";
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? "" : date.toISOString();
	}

	function initialEnd() {
		const date = new Date();
		date.setDate(date.getDate() + 14);
		return toLocalInput(date.toISOString());
	}

	function endFor(value: string, weeks: number) {
		const startDate = value ? new Date(value) : new Date();
		const endDate = new Date(startDate);
		endDate.setDate(endDate.getDate() + weeks * 7);
		return toLocalInput(endDate.toISOString());
	}

	function applyDuration(value: string) {
		duration = value;
		if (value === "custom") return;
		end = endFor(start, Number(value));
	}

	function changeStart(value: string) {
		start = value;
		if (duration !== "custom") end = endFor(value, Number(duration));
	}

	function changeEnd(value: string) {
		end = value;
		duration = "custom";
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
		form="start-sprint-form"
		isLoading={pending}
		isDisabled={name.trim() === "" || !start || !end}
	>
		Start
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal title="Start sprint" width={520} {onClose} {footer}>
	<form
		id="start-sprint-form"
		method="POST"
		action={`/boards/${rapidViewId}/plan?/startSprint`}
		use:enhance={submit}
	>
		<input type="hidden" name="sprintId" value={sprint.id} />
		<input type="hidden" name="startDate" value={startIso} />
		<input type="hidden" name="endDate" value={endIso} />
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
				<span>Duration</span>
				<select
					aria-label="Sprint duration"
					value={duration}
					onchange={(event) => applyDuration(event.currentTarget.value)}
				>
					<option value="1">1 week</option>
					<option value="2">2 weeks</option>
					<option value="3">3 weeks</option>
					<option value="4">4 weeks</option>
					<option value="custom">Custom</option>
				</select>
			</label>
			<div class="dates">
				<label class="field">
					<span>Start</span>
					<input
						aria-label="Sprint start"
						type="datetime-local"
						value={start}
						onchange={(event) => changeStart(event.currentTarget.value)}
					/>
				</label>
				<label class="field">
					<span>End</span>
					<input
						aria-label="Sprint end"
						type="datetime-local"
						value={end}
						onchange={(event) => changeEnd(event.currentTarget.value)}
					/>
				</label>
			</div>
			<label class="field">
				<span>Sprint goal</span>
				<textarea
					aria-label="Sprint goal"
					name="goal"
					bind:value={goal}
					disabled={!canEditText}
				></textarea>
			</label>
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
	select,
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
