<script lang="ts">
	import { enhance, type ActionResult } from "$app/forms";
	import { goto } from "$app/navigation";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";

	interface Props {
		rapidViewId: number;
		onClose: () => void;
		onDone: () => Promise<void>;
	}

	let { rapidViewId, onClose, onDone }: Props = $props();

	let name = $state("New sprint");
	let goal = $state("");
	let error = $state<string | null>(null);
	let pending = $state(false);

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
		form="create-sprint-form"
		isLoading={pending}
		isDisabled={name.trim() === ""}
	>
		Create
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal title="Create sprint" width={460} {onClose} {footer}>
	<form
		id="create-sprint-form"
		method="POST"
		action={`/boards/${rapidViewId}/plan?/createSprint`}
		use:enhance={submit}
	>
		<div class="fields">
			<label class="field">
				<span>Sprint name</span>
				<input aria-label="Sprint name" name="name" bind:value={name} />
			</label>
			<label class="field">
				<span>Goal</span>
				<textarea aria-label="Sprint goal" name="goal" bind:value={goal}
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
	}

	.field > span {
		font-size: 12px;
		font-weight: 600;
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
