<script lang="ts">
	import { enhance } from "$app/forms";
	import { page } from "$app/state";
	import { onMount } from "svelte";
	import { api } from "#lib/api.ts";
	import Banner from "#lib/admin/Banner.svelte";
	import ErrorText from "#lib/admin/ErrorText.svelte";
	import FormField from "#lib/components/FormField.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import { formAction } from "#lib/admin/users.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import type { StatusCategory, StatusOption } from "#lib/workflow/types.ts";

	interface Props {
		inWorkflow: Set<string>;
		onAddExisting: (statusId: string) => void;
		onClose: () => void;
	}

	let { inWorkflow, onAddExisting, onClose }: Props = $props();

	const NEW_STATUS = "__new__";
	const categoryLabel: Record<StatusCategory, string> = {
		new: "To Do",
		indeterminate: "In Progress",
		done: "Done",
	};

	const uid = $props.id();

	let options = $state<StatusOption[]>([]);
	let optionsError = $state<string | null>(null);
	let choice = $state("");
	let name = $state("");
	let category = $state<StatusCategory>("new");
	let creating = $state(false);
	let createError = $state<string | null>(null);
	let action = $derived(formAction(page.url, "createStatus"));

	let available = $derived(
		options.filter((status) => !inWorkflow.has(status.id)),
	);
	let isNew = $derived(choice === NEW_STATUS);
	let ready = $derived(isNew ? name.trim() !== "" : choice !== "");

	onMount(() => {
		const controller = new AbortController();
		(async () => {
			try {
				options = await api<StatusOption[]>(
					"/api/admin/workflows/status-options",
					{ signal: controller.signal },
				);
			} catch (cause) {
				if (!controller.signal.aborted) {
					optionsError =
						cause instanceof Error ? cause.message : "Could not load the statuses";
				}
			}
		})();
		return () => controller.abort();
	});

</script>

<Modal title="Add status" {onClose}>
	{#snippet footer()}
		<Button
			appearance="primary"
			type="submit"
			form={`${uid}-add-status-form`}
			isDisabled={!ready}
			isLoading={creating}
		>
			Add
		</Button>
		<Button appearance="subtle" onclick={onClose}>Cancel</Button>
	{/snippet}
	<form
		id={`${uid}-add-status-form`}
		method="POST"
		{action}
		use:enhance={({ cancel }) => {
			if (!ready) {
				cancel();
				return;
			}
			if (!isNew) {
				cancel();
				onAddExisting(choice);
				return;
			}
			creating = true;
			createError = null;
			return async ({ result }) => {
				creating = false;
				if (result.type === "success") {
					const created = (result.data as { created?: { id: string } } | null)
						?.created;
					if (created) onAddExisting(created.id);
					return;
				}
				if (result.type === "failure") {
					const failure = result.data as { error?: unknown } | null;
					createError =
						typeof failure?.error === "string"
							? failure.error
							: "Could not create the status";
					return;
				}
				createError = "Could not create the status";
			};
		}}
	>
		{#if optionsError}
			<Banner tone="danger">
				Could not load the statuses: {optionsError}
			</Banner>
		{/if}
		<FormField
			label="Status"
			htmlFor={`${uid}-status`}
			hint="Statuses are shared: the same status can be used by several workflows."
		>
			{#snippet children(aria)}
			<select id={`${uid}-status`} style={inputStyle} bind:value={choice} aria-describedby={aria.describedBy} aria-invalid={aria.invalid || undefined} aria-required={aria.required || undefined}>
				<option value="">Select a status</option>
				{#each available as status (status.id)}
					<option value={status.id}>
						{status.name} ({categoryLabel[status.category]})
					</option>
				{/each}
				<option value={NEW_STATUS}>Create a new status...</option>
			</select>
			{/snippet}
		</FormField>
		{#if isNew}
			<FormField label="New status name" htmlFor={`${uid}-name`}>
				<input
					id={`${uid}-name`}
					name="name"
					style={inputStyle}
					bind:value={name}
					maxLength={255}
				/>
			</FormField>
			<FormField label="Category" htmlFor={`${uid}-category`}>
				<select
					id={`${uid}-category`}
					name="category"
					style={inputStyle}
					bind:value={category}
				>
					{#each Object.keys(categoryLabel) as key (key)}
						<option value={key}>
							{categoryLabel[key as StatusCategory]}
						</option>
					{/each}
				</select>
			</FormField>
		{/if}
		{#if createError}
			<ErrorText>{createError}</ErrorText>
		{/if}
		<button type="submit" hidden aria-label="Submit form"></button>
	</form>
</Modal>

<style>
	form {
		margin: 0;
	}
</style>
