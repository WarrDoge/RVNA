<script lang="ts">
	import { page } from "$app/state";
	import PageTitle from "#lib/components/PageTitle.svelte";

	let { forbidden }: { forbidden: string } = $props();

	let message = $derived(
		page.status === 404
			? "Project not found"
			: (page.error?.message ?? forbidden),
	);
</script>

<PageTitle title={page.status === 404 ? "Project not found" : "Forbidden"} />

<div class="card">
	<h1>{message}</h1>
	{#if page.status === 404}
		<a href="/secure/BrowseProjects.jspa">View all projects</a>
	{:else}
		<a href="/secure/Dashboard.jspa">Go to the dashboard</a>
	{/if}
</div>

<style>
	.card {
		padding: 48px 32px;
		text-align: center;
	}

	h1 {
		margin: 0 0 8px;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text);
	}

	a {
		color: var(--ds-link);
		text-decoration: none;
	}
</style>
