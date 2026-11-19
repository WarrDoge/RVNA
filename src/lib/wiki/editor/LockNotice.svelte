<script lang="ts">
	import { relativeDate } from "#lib/dates.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import Button from "#lib/components/Button.svelte";
	import type { LockInfo } from "#lib/shared/wiki/index.ts";
	import Banner from "./Banner.svelte";

	interface Props {
		pageTitle: string;
		lock: LockInfo | null;
		waiting: boolean;
		onwait: () => void;
		ontakeover: () => void;
		viewHref: string;
	}

	let { pageTitle, lock, waiting, onwait, ontakeover, viewHref }: Props =
		$props();
</script>

<div class="wed-lock-card" role="alert">
	<p class="wed-lock-who">
		{#if lock}<Avatar user={lock.holder} size={32} />{/if}
		<span>
			<strong>{lock?.holder.displayName ?? "Someone else"}</strong> is editing
			<strong>{pageTitle}</strong>
			{#if lock}
				<span class="subtle"> since {relativeDate(lock.acquiredAt)}</span>
			{/if}
		</span>
	</p>
	<p class="text">
		Only one person can edit a page at a time. You can wait until they are done,
		or take over: their unpublished changes are kept as a draft.
	</p>
	{#if waiting}
		<p class="text subtle">
			Waiting for {lock?.holder.displayName ?? "them"} to finish. This page opens
			for editing as soon as the lock is free.
		</p>
	{/if}
	<div class="wed-actions lock-actions">
		<Button appearance="primary" onclick={onwait} isSelected={waiting}>
			{waiting ? "Stop waiting" : "Wait"}
		</Button>
		<Button onclick={ontakeover}>Edit anyway (take over)</Button>
		<Button appearance="subtle" href={viewHref}>View page</Button>
	</div>
</div>

<style>
	.subtle {
		color: var(--ds-text-subtle);
	}
	.text {
		margin: 0 0 16px;
	}
	.lock-actions {
		margin-top: 0;
	}
</style>
