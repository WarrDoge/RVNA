<script lang="ts">
	import Button from "./Button.svelte";
	import Modal from "./Modal.svelte";

	interface Props {
		title: string;
		message: string;
		confirmLabel?: string;
		onConfirm: () => void;
		onClose: () => void;
		pending?: boolean;
	}

	let {
		title,
		message,
		confirmLabel = "Delete",
		onConfirm,
		onClose,
		pending = false,
	}: Props = $props();
</script>

{#snippet footer()}
	<Button appearance="danger" isLoading={pending} onclick={onConfirm}
		>{confirmLabel}</Button
	>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal {title} {onClose} {footer}>
	<p style="margin: 0;">{message}</p>
</Modal>
