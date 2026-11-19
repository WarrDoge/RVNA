<script lang="ts">
	import PageTitle from "#lib/components/PageTitle.svelte";
	import DashboardView from "./DashboardView.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();
</script>

<PageTitle title={data.dashboard?.name ?? "Dashboards"} />

{#if data.empty}
	<section class="welcome">
		<h1>Welcome</h1>
		<p>There is no dashboard to show yet. Start here:</p>
		<ul>
			<li><a href="/secure/BrowseProjects.jspa">Projects</a></li>
			<li><a href="/issues/">Issues</a></li>
			<li><a href="/servicedesk/customer/portals">Service desk portal</a></li>
		</ul>
	</section>
{:else if !data.dashboard}
	<section class="missing">
		<h1>Dashboard</h1>
		<p>This dashboard does not exist or you cannot see it.</p>
		<a href="/secure/ConfigurePortalPages!default.jspa">Manage dashboards</a>
	</section>
{:else}
	<DashboardView
		dashboard={data.dashboard}
		favourites={data.favourites}
		gadgetData={data.gadgetData}
	/>
{/if}

<style>
	.welcome,
	.missing {
		padding: 24px 32px;
		max-width: 720px;
	}
	h1 {
		margin: 0;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text);
	}
	p {
		color: var(--ds-text-subtle);
	}
	ul {
		line-height: 28px;
	}
	a {
		color: var(--ds-link);
	}
</style>
