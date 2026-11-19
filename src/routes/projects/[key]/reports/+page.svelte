<script lang="ts">
	import EmptyState from "#lib/components/EmptyState.svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
</script>

<PageTitle title="Reports" />

<section class="page">
	<h1>Reports</h1>
	<EmptyState header="Nothing here yet" />
</section>

<style>
	.page {
		padding: 24px 32px;
	}

	h1 {
		margin: 0 0 16px;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text, #cecfd2);
	}
</style>
