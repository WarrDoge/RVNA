<script lang="ts">
	import Button from "#lib/components/Button.svelte";

	interface Props {
		saved: boolean;
		error: string | null;
		pending: boolean;
		disabled?: boolean;
		onSave?: () => void;
	}

	let { saved, error, pending, disabled = false, onSave }: Props = $props();
</script>

<div class="save-row">
	<Button
		type={onSave ? "button" : "submit"}
		appearance="primary"
		isLoading={pending}
		isDisabled={disabled}
		onclick={onSave}
	>
		Save
	</Button>
	{#if saved}
		<span class="saved">Saved</span>
	{/if}
	{#if error}
		<span class="error" role="alert">{error}</span>
	{/if}
</div>

<style>
	.save-row {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.saved {
		color: var(--ds-text-subtle, #a9abaf);
	}

	.error {
		color: #e5493a;
	}
</style>
