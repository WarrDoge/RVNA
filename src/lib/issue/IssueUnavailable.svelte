<script lang="ts">
	interface Props {
		kind?: "hidden-or-missing" | "failed";
	}

	let { kind = "hidden-or-missing" }: Props = $props();

	let hiddenOrMissing = $derived(kind === "hidden-or-missing");
</script>

<div class="unavailable">
	<h1>
		{hiddenOrMissing
			? "You do not have permission to view this issue"
			: "Issue not found"}
	</h1>
	<p>
		{hiddenOrMissing
			? "It may have been deleted, or you may not have permission to view it."
			: "The issue could not be loaded."}
	</p>
	<a href="/issues/">Back to search</a>
</div>

<style>
	.unavailable {
		padding: 24px 32px;
		max-width: 720px;
	}

	h1 {
		margin: 0;
		font-size: 24px;
		font-weight: 500;
		color: var(--ds-text, #cecfd2);
	}

	p {
		color: var(--ds-text-subtle, #a9abaf);
	}

	a {
		color: var(--ds-link, #669df1);
	}
</style>
