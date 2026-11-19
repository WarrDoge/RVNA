<script lang="ts">
	import "../reset.css";
	import "../theme.css";
	import "../app.css";
	import { page } from "$app/state";
	import { onMount, untrack, type Snippet } from "svelte";
	import { syncDateContext, useServerNow } from "#lib/shell/date-context.ts";
	import AppShell from "#lib/shell/AppShell.svelte";
	import type { LayoutData } from "./$types";

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	useServerNow(untrack(() => data.now));
	onMount(() => {
		// Browser tests wait for this mark before they click or type.
		document.documentElement.dataset.hydrated = "";
		return syncDateContext(data);
	});

	// Pages that draw their own frame: the sign-in page and the component kit gallery.
	const bare = new Set(["/login.jsp", "/(gallery)/sk-kit"]);

	let showShell = $derived(
		Boolean(data.user) &&
			!data.user?.mustChangePassword &&
			!bare.has(page.route.id ?? "") &&
			!page.url.pathname.startsWith("/servicedesk/customer/"),
	);
</script>

{#if showShell && data.user}
	<AppShell user={data.user} unread={data.unread}>
		{@render children()}
	</AppShell>
{:else}
	{@render children()}
{/if}
