<script lang="ts">
	import Avatar from "#lib/components/Avatar.svelte";
	import Icon from "#lib/components/Icon.svelte";
	import { formatDate } from "./format.ts";
	import type { PageDetail } from "./types.ts";

	interface Props {
		page: PageDetail;
		onHistory: () => void;
		onRestrictions: () => void;
	}

	let { page, onHistory, onRestrictions }: Props = $props();
</script>

<div class="wiki-byline">
	<span>
		Created by {page.creator?.displayName ?? "Unknown user"}, last modified
	</span>
	{#if page.lastModifier}
		<Avatar user={page.lastModifier} size={20} />
	{/if}
	<span
		>{page.lastModifier?.displayName ?? "Unknown user"} on{" "}{formatDate(
			page.updated,
		)}</span
	>
	<button type="button" class="wiki-action" onclick={onHistory}>
		<Icon name="history" size={13} />
		Page history
	</button>
	{#if page.restricted}
		<button
			type="button"
			class="wiki-action"
			onclick={onRestrictions}
			aria-label="Restrictions"
			title="This page is restricted"
		>
			<span aria-hidden="true">🔒</span>
			Restrictions
		</button>
	{/if}
</div>
