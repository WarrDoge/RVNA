<script lang="ts">
	import { page } from "$app/state";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import PortalCard from "./PortalCard.svelte";
</script>

<PageTitle title={page.status === 404 ? "Page not found" : "Error"} />

<PortalCard>
	<h1 class="missing">
		{page.status === 404
			? (page.error?.message ?? "Not found")
			: `${page.status} ${page.error?.message ?? ""}`.trim()}
	</h1>
	<p class="back">
		<a href="/servicedesk/customer/portals">Back to the Help Center</a>
	</p>
</PortalCard>

<style>
	.missing {
		margin: 0;
		font-size: 24px;
		font-weight: 500;
	}

	.back {
		margin: 12px 0 0;
	}

	.back a {
		color: var(--ds-link);
	}
</style>
