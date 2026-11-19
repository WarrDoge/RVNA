<script lang="ts">
	import PageTitle from "#lib/components/PageTitle.svelte";
</script>

<PageTitle title="Board not found" />

<div class="missing-board">
	<h1>Board not found</h1>
	<p>
		This board does not exist.
		<a href="/secure/ManageRapidViews.jspa">View all boards</a>.
	</p>
</div>

<style>
	.missing-board {
		padding: 32px 40px;
		color: var(--ds-text, #cecfd2);
	}

	h1 {
		margin: 0 0 12px;
		font-size: 24px;
		font-weight: 500;
	}

	p {
		color: var(--ds-text-subtle, #a9abaf);
	}

	a {
		color: var(--ds-link, #669df1);
	}
</style>
