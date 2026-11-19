<script lang="ts">
	import type { Snippet } from "svelte";
	import { errorMessage } from "#lib/admin/config.ts";
	import ErrorText from "#lib/admin/ErrorText.svelte";
	import { inputStyle, textareaStyle } from "#lib/admin/styles.ts";

	interface Props {
		value: string;
		ariaLabel: string;
		placeholder?: string;
		multiline?: boolean;
		onSave: (next: string) => Promise<void>;
		display: Snippet;
	}

	let {
		value,
		ariaLabel,
		placeholder,
		multiline = false,
		onSave,
		display,
	}: Props = $props();

	let editing = $state(false);
	let draft = $state("");
	let error = $state<string | null>(null);
	let finished = false;

	function start() {
		finished = false;
		draft = value;
		error = null;
		editing = true;
	}

	async function finish(save: boolean) {
		if (finished) return;
		finished = true;
		const next = draft.trim();
		if (!save || next === value) {
			editing = false;
			return;
		}
		try {
			await onSave(next);
			editing = false;
		} catch (cause) {
			finished = false;
			error = errorMessage(cause);
		}
	}
</script>

<div>
	{#if editing}
		<div>
			{#if multiline}
				<textarea
					aria-label={ariaLabel}
					rows={3}
					bind:value={draft}
					onkeydown={(event) => {
						if (event.key === "Escape") {
							event.preventDefault();
							void finish(false);
						}
					}}
					onblur={() => void finish(true)}
					style={textareaStyle}
				></textarea>
			{:else}
				<!-- svelte-ignore a11y_autofocus -->
				<input
					aria-label={ariaLabel}
					{placeholder}
					autofocus
					bind:value={draft}
					onkeydown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							void finish(true);
						}
						if (event.key === "Escape") {
							event.preventDefault();
							void finish(false);
						}
					}}
					onblur={() => void finish(true)}
					style={inputStyle}
				/>
			{/if}
		</div>
	{:else}
		<button
			type="button"
			title={`Edit ${ariaLabel}`}
			class="inline-display"
			onclick={start}
		>
			{@render display()}
		</button>
	{/if}
	{#if error}
		<ErrorText>{error}</ErrorText>
	{/if}
</div>

<style>
	.inline-display {
		display: block;
		width: 100%;
		padding: 2px 4px;
		margin-left: -4px;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text);
		font-size: inherit;
		line-height: inherit;
		text-align: left;
		cursor: text;
	}
</style>
