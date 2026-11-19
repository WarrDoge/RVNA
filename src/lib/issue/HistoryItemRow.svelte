<script lang="ts">
	import { absoluteDate, relativeDate } from "#lib/dates.ts";
	import type { HistoryEntry } from "#lib/api-types.ts";
	import UserLink from "#lib/components/UserLink.svelte";
	import { describeHistoryItem } from "./history.ts";
	import TimelineAvatar from "./TimelineAvatar.svelte";

	interface Props {
		entry: HistoryEntry;
	}

	let { entry }: Props = $props();
</script>

<div class="history-row">
	<TimelineAvatar user={entry.author} />
	<div class="history-body">
		<div class="history-head">
			{#if entry.author}
				<UserLink username={entry.author.username}>
					<strong>{entry.author.displayName}</strong>
				</UserLink>
			{:else}
				<strong>Unknown user</strong>
			{/if}
			<span class="history-date" title={absoluteDate(entry.created)}>
				{relativeDate(entry.created)}
			</span>
			{#if entry.via === "gitlab"}
				<span class="history-date">via GitLab</span>
			{/if}
		</div>
		<ul class="history-items">
			{#each entry.items as item, index (index)}
				<li>{describeHistoryItem(item)}</li>
			{/each}
		</ul>
	</div>
</div>

<style>
	.history-row {
		display: flex;
		gap: 10px;
		padding: 10px 0;
		border-bottom: 1px solid var(--ds-border, #091e4224);
	}
	.history-body {
		flex: 1;
		min-width: 0;
	}
	.history-head {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.history-date {
		color: var(--ds-text-subtle, #505258);
		font-size: 12px;
	}
	.history-items {
		margin: 4px 0 0;
		padding-left: 18px;
	}
</style>
