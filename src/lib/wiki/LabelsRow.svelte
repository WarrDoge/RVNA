<script lang="ts">
	import { invalidate } from "$app/navigation";
	import Button from "#lib/components/Button.svelte";
	import Icon from "#lib/components/Icon.svelte";
	import { addLabel, removeLabel } from "./api.ts";
	import type { PageDetail } from "./types.ts";

	interface Props {
		page: PageDetail;
		canEdit?: boolean;
	}

	let { page, canEdit = false }: Props = $props();

	let adding = $state(false);
	let value = $state("");
	let input = $state<HTMLInputElement>();

	$effect(() => {
		if (adding) input?.focus();
	});

	async function add() {
		const label = value.trim();
		if (label === "") return;
		try {
			await addLabel(page.id, label);
			value = "";
			adding = false;
			await invalidate("app:wiki-page");
		} catch {
			// The input stays open when the request fails.
		}
	}

	async function remove(id: string) {
		try {
			await removeLabel(id);
			await invalidate("app:wiki-page");
		} catch {
			// A failed label removal shows no error.
		}
	}
</script>

<div class="wiki-label-row">
	<strong class="label-title">Labels:</strong>
	{#each page.labels as label (label.id)}
		<span class="wiki-label-chip">
			<a href={`/label/${encodeURIComponent(label.label)}`}>
				{label.label}
			</a>
			{#if canEdit}
				<button
					type="button"
					aria-label={`Remove label ${label.label}`}
					onclick={() => void remove(label.id)}
				>
					×
				</button>
			{/if}
		</span>
	{/each}
	{#if canEdit}
		{#if adding}
			<form
				class="add-form"
				onsubmit={(event) => {
					event.preventDefault();
					void add();
				}}
			>
				<input
					bind:this={input}
					bind:value
					aria-label="New label"
					placeholder="Label"
				/>
				<Button type="submit" appearance="subtle" spacing="compact">
					Add
				</Button>
				<Button
					appearance="subtle"
					spacing="compact"
					onclick={() => (adding = false)}
				>
					Cancel
				</Button>
			</form>
		{:else}
			<button type="button" class="wiki-action" onclick={() => (adding = true)}>
				<Icon name="plus" size={12} />
				Add label
			</button>
		{/if}
	{/if}
</div>

<style>
	.label-title {
		font-weight: 600;
	}

	.wiki-label-chip a {
		color: inherit;
		text-decoration: none;
	}

	.add-form {
		display: inline-flex;
		gap: 4px;
	}

	.add-form input {
		height: 24px;
		padding: 0 6px;
		background: var(--ds-background-input);
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text);
	}
</style>
