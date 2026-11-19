<script lang="ts">
	import { enhance } from "$app/forms";
	import { page } from "$app/state";
	import { onMount, untrack } from "svelte";
	import { api } from "#lib/api.ts";
	import Banner from "#lib/admin/Banner.svelte";
	import ErrorText from "#lib/admin/ErrorText.svelte";
	import FormField from "#lib/components/FormField.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import { formAction } from "#lib/admin/users.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import type { WorkflowStatus } from "#lib/workflow/types.ts";

	interface Props {
		status: WorkflowStatus;
		workflowId: string;
		onDone: () => void;
		onClose: () => void;
	}

	let { status, workflowId, onDone, onClose }: Props = $props();

	type StatusUsage = {
		id: string;
		workflows: { id: string; name: string }[];
	};

	const uid = $props.id();

	let usage = $state<StatusUsage[]>([]);
	let name = $state(untrack(() => status.name));
	let busy = $state(false);
	let error = $state<string | null>(null);
	let action = $derived(formAction(page.url, "renameStatus"));

	let shared = $derived(
		(usage.find((row) => row.id === status.id)?.workflows ?? []).filter(
			(workflow) => workflow.id !== workflowId,
		),
	);
	let ready = $derived(name.trim() !== "" && name.trim() !== status.name);

	onMount(() => {
		const controller = new AbortController();
		(async () => {
			try {
				usage = await api<StatusUsage[]>("/api/admin/statuses", {
					signal: controller.signal,
				});
			} catch {
				// The rename still works without the shared-status warning.
			}
		})();
		return () => controller.abort();
	});

</script>

<Modal title="Rename status" {onClose}>
	{#snippet footer()}
		<Button
			appearance="primary"
			type="submit"
			form={`${uid}-rename-status-form`}
			isDisabled={!ready}
			isLoading={busy}
		>
			Rename
		</Button>
		<Button appearance="subtle" onclick={onClose}>Cancel</Button>
	{/snippet}
	<form
		id={`${uid}-rename-status-form`}
		method="POST"
		{action}
		use:enhance={({ cancel }) => {
			if (!ready) {
				cancel();
				return;
			}
			busy = true;
			error = null;
			return async ({ result }) => {
				busy = false;
				if (result.type === "success") {
					onDone();
					return;
				}
				if (result.type === "failure") {
					const failure = result.data as { error?: unknown } | null;
					error =
						typeof failure?.error === "string"
							? failure.error
							: "Could not rename the status";
					return;
				}
				error = "Could not rename the status";
			};
		}}
	>
		<input type="hidden" name="id" value={status.id} />
		{#if shared.length > 0}
			<Banner tone="warning">
				Statuses are shared. Renaming this status also renames it in{" "}
				{shared.map((workflow) => workflow.name).join(", ")}.
			</Banner>
		{/if}
		<FormField label="Status name" htmlFor={`${uid}-name`}>
			<input
				id={`${uid}-name`}
				name="name"
				style={inputStyle}
				bind:value={name}
				maxLength={255}
			/>
		</FormField>
		{#if error}
			<ErrorText>{error}</ErrorText>
		{/if}
		<button type="submit" hidden aria-label="Submit form"></button>
	</form>
</Modal>

<style>
	form {
		margin: 0;
	}
</style>
