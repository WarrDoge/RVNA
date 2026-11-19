<script lang="ts">
	import { enhance, type ActionResult } from "$app/forms";
	import { goto } from "$app/navigation";
	import type { Sprint } from "#lib/api-types.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";

	interface Props {
		sprint: Sprint;
		rapidViewId: number;
		onClose: () => void;
		onDone: () => Promise<void>;
	}

	let { sprint, rapidViewId, onClose, onDone }: Props = $props();

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
	<Button appearance="danger" type="submit" form="delete-sprint-form" isLoading={pending}>Delete</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal title="Delete sprint" {onClose} {footer}>
	<form
		id="delete-sprint-form"
		method="POST"
		action={`/boards/${rapidViewId}/plan?/deleteSprint`}
		use:enhance={submit}
	>
		<input type="hidden" name="sprintId" value={sprint.id} />
		<p>Delete "{sprint.name}"? Its issues return to the backlog.</p>
		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}
	</form>
</Modal>

<style>
	form {
		margin: 0;
	}

	p {
		margin: 0;
	}

	.error {
		margin-top: 8px;
		color: #e5493a;
	}
</style>
