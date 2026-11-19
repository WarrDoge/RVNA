<script lang="ts">
	import { untrack } from "svelte";
	import Button from "#lib/components/Button.svelte";

	interface Props {
		placeholder: string;
		submitLabel: string;
		onSubmit: (value: string) => void;
		onCancel?: () => void;
		pending: boolean;
		initialValue?: string;
	}

	let {
		placeholder,
		submitLabel,
		onSubmit,
		onCancel,
		pending,
		initialValue = "",
	}: Props = $props();

	let value = $state(untrack(() => initialValue));

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (value.trim() === "") return;
		onSubmit(value);
	}
</script>

<form class="comment-form" onsubmit={submit}>
	<textarea
		class="wiki-textarea"
		{placeholder}
		aria-label={placeholder}
		bind:value
	></textarea>
	<div class="buttons">
		<Button type="submit" appearance="primary" isDisabled={pending}>
			{submitLabel}
		</Button>
		{#if onCancel}
			<Button appearance="subtle" onclick={onCancel}>Cancel</Button>
		{/if}
	</div>
</form>

<style>
	.comment-form {
		margin-top: 8px;
	}

	.buttons {
		display: flex;
		gap: 8px;
		margin-top: 8px;
	}
</style>
