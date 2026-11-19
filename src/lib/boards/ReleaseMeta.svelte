<script lang="ts">
	import type { ReleaseSummary } from "#lib/api-types.ts";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import { formatDateOnly } from "#lib/dates.ts";

	interface Props {
		version: ReleaseSummary;
	}

	let { version }: Props = $props();
</script>

<span class="release-meta">
	{#if version.released}
		<Lozenge appearance="success">Released</Lozenge>
	{:else}
		<Lozenge appearance="default">Unreleased</Lozenge>
	{/if}
	{#if version.releaseDate}
		<span class="date">{formatDateOnly(version.releaseDate)}</span>
	{/if}
</span>

<style>
	.release-meta {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.date {
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 12px;
	}
</style>
