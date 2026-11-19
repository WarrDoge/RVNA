<script lang="ts">
	import { page } from "$app/state";
	import PageTitle from "#lib/components/PageTitle.svelte";
</script>

<PageTitle
	title={page.status === 404
		? "Page not found"
		: page.status === 403
			? "Forbidden"
			: String(page.status)}
/>

<div class="missing">
	<h1>{page.error?.message ?? "Not found"}</h1>
</div>

<style>
	.missing {
		padding: 24px 32px;
	}

	h1 {
		margin: 0;
		font-size: 24px;
		font-weight: 500;
		color: var(--ds-text);
	}
</style>
