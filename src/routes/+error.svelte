<script lang="ts">
	import { page } from "$app/state";
	import AdminForbidden from "#lib/admin/AdminForbidden.svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import NotFound from "#lib/components/NotFound.svelte";

	let status = $derived(page.status);
	let message = $derived(page.error?.message ?? "");
	let adminRoute = $derived(page.route.id?.includes("(admin)") ?? false);
</script>

<PageTitle
	title={status === 404
		? "Page not found"
		: status === 403
			? "Forbidden"
			: String(status)}
/>

{#if status === 404}
	<NotFound />
{:else if status === 403 && adminRoute}
	<AdminForbidden />
{:else if status === 403}
	<section class="error">
		<h1>403 Forbidden</h1>
		<p>{message || "You do not have permission to view this page."}</p>
		<a href="/secure/Dashboard.jspa">Go to the dashboard</a>
	</section>
{:else}
	<section class="error">
		<h1>{status}</h1>
		<p>{message}</p>
		<a href="/secure/Dashboard.jspa">Go to the dashboard</a>
	</section>
{/if}

<style>
	.error {
		padding: 48px 32px;
		text-align: center;
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
</style>
