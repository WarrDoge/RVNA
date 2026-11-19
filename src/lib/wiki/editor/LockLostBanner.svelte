<script lang="ts">
	import Button from "#lib/components/Button.svelte";
	import type { LockInfo } from "#lib/shared/wiki/index.ts";
	import Banner from "./Banner.svelte";

	interface Props {
		lock: LockInfo | null;
		ontakeover: () => void;
		viewHref: string;
	}

	let { lock, ontakeover, viewHref }: Props = $props();
</script>

{#snippet actions()}
	<Button onclick={ontakeover}>Edit anyway (take over)</Button>
	<Button appearance="subtle" href={viewHref}>View page</Button>
{/snippet}

<Banner tone="danger" {actions}>
	{lock?.holder.displayName ?? "Someone else"} took over editing this page; your
	changes are kept as a draft
</Banner>
