<script lang="ts">
	import { untrack } from "svelte";
	import FormField from "#lib/components/FormField.svelte";
	import ErrorText from "#lib/admin/ErrorText.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import type {
		WorkflowStatus,
		WorkflowTransition,
	} from "#lib/workflow/types.ts";

	interface Props {
		statuses: WorkflowStatus[];
		transition: WorkflowTransition | null;
		presetFrom: string | null;
		onSave: (transition: WorkflowTransition) => void;
		onClose: () => void;
	}

	let { statuses, transition, presetFrom, onSave, onClose }: Props = $props();

	const ANY_STATUS = "";
	const uid = $props.id();

	function newId() {
		if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
		const bytes = crypto.getRandomValues(new Uint8Array(16));
		bytes[6] = (bytes[6] & 0x0f) | 0x40;
		bytes[8] = (bytes[8] & 0x3f) | 0x80;
		const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
		return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
	}

	let name = $state(untrack(() => transition?.name ?? ""));
	let from = $state(
		untrack(() =>
			transition ? (transition.fromStatusId ?? ANY_STATUS) : (presetFrom ?? ""),
		),
	);
	let to = $state(untrack(() => transition?.toStatusId ?? ""));
	let asks = $state(untrack(() => transition?.asksResolution ?? false));

	let problem = $derived.by(() => {
		if (name.trim() === "") return "Enter a name for the transition.";
		if (to === "") return "Choose the status the transition leads to.";
		if (from === to) return "A transition must lead to a different status.";
		return null;
	});

	function save() {
		if (problem) return;
		onSave({
			id: transition?.id ?? newId(),
			name: name.trim(),
			fromStatusId: from === ANY_STATUS ? null : from,
			toStatusId: to,
			asksResolution: asks,
		});
	}
</script>

<Modal
	title={transition ? "Edit transition" : "Add transition"}
	{onClose}
>
	{#snippet footer()}
		<Button
			appearance="primary"
			type="submit"
			form={`${uid}-transition-form`}
			isDisabled={problem !== null}
		>
			{transition ? "Save" : "Add"}
		</Button>
		<Button appearance="subtle" onclick={onClose}>Cancel</Button>
	{/snippet}
	<form
		id={`${uid}-transition-form`}
		method="POST"
		onsubmit={(event) => {
			event.preventDefault();
			save();
		}}
	>
		<FormField
			label="Transition name"
			htmlFor={`${uid}-name`}
			hint="The button people click on an issue, for example Start progress."
		>
			{#snippet children(aria)}
			<input
				id={`${uid}-name`}
				style={inputStyle}
				bind:value={name}
				maxLength={255} aria-describedby={aria.describedBy} aria-invalid={aria.invalid || undefined} aria-required={aria.required || undefined}/>
			{/snippet}
		</FormField>
		<FormField label="From status" htmlFor={`${uid}-from`}>
			<select id={`${uid}-from`} style={inputStyle} bind:value={from}>
				<option value={ANY_STATUS}>Any status</option>
				{#each statuses as status (status.id)}
					<option value={status.id}>{status.name}</option>
				{/each}
			</select>
		</FormField>
		<FormField label="To status" htmlFor={`${uid}-to`}>
			<select id={`${uid}-to`} style={inputStyle} bind:value={to}>
				{#if to === ""}
					<option value="">Select a status</option>
				{/if}
				{#each statuses as status (status.id)}
					<option value={status.id}>{status.name}</option>
				{/each}
			</select>
		</FormField>
		<label class="resolution" for={`${uid}-resolution`}>
			<input id={`${uid}-resolution`} type="checkbox" bind:checked={asks} />
			Ask for a resolution
		</label>
		{#if name.trim() !== "" && problem}
			<ErrorText>{problem}</ErrorText>
		{/if}
		<button type="submit" hidden aria-label="Submit form"></button>
	</form>
</Modal>

<style>
	.resolution {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	form {
		margin: 0;
	}
</style>
