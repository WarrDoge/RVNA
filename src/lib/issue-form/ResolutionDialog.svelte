<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { ResolutionRef, Transition } from "#lib/api-types.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";

	interface Props {
		transition: Transition;
		resolutions: ResolutionRef[];
		pending: boolean;
		onConfirm: (resolutionId: string) => void;
		onClose: () => void;
	}

	let { transition, resolutions, pending, onConfirm, onClose }: Props =
		$props();

	function requestClose() {
		onClose();
	}

	const id = $props.id();
	let resolutionId = $state("");

	const labelStyle = `display: block; margin-bottom: 4px; font-size: 12px; font-weight: 600; color: ${token(
		"color.text.subtle",
	)};`;
	const selectStyle = `width: 100%; height: 32px; padding: 0 8px; background-color: ${token(
		"color.background.input",
	)}; border: 1px solid ${token(
		"color.border.input",
	)}; border-radius: 3px; color: ${token(
		"color.text",
	)}; font-size: 14px;`;
	const mutedStyle = `color: ${token("color.text.subtle")};`;
</script>

{#snippet footer()}
	<Button
		appearance="primary"
		isDisabled={resolutionId === ""}
		isLoading={pending}
		onclick={() => onConfirm(resolutionId)}
	>
		{transition.name}
	</Button>
	<Button appearance="subtle" onclick={requestClose}>Cancel</Button>
{/snippet}

<Modal title={transition.name} onClose={requestClose} {footer}>
	<label for={id} style={labelStyle}>Resolution</label>
	<select
		{id}
		value={resolutionId}
		onchange={(event) => (resolutionId = event.currentTarget.value)}
		style={selectStyle}
	>
		<option value="">None</option>
		{#each resolutions as resolution (resolution.id)}
			<option value={resolution.id}>{resolution.name}</option>
		{/each}
	</select>
	{#if resolutions.length === 0}
		<p style={mutedStyle}>
			No resolutions exist yet. An administrator can add them under
			Administration, Resolutions.
		</p>
	{/if}
</Modal>
