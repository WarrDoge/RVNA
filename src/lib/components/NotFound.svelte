<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import EmptyState from "./EmptyState.svelte";

	const linkStyle = `color: ${token("color.link")}; text-decoration: none;`;
</script>

{#snippet primaryAction()}
	<span style="display: inline-flex; gap: 24px;">
		<button
			type="button"
			style={`${linkStyle} padding: 0; background: transparent; border: 0; cursor: pointer; font: inherit;`}
			onclick={() => window.history.back()}>Go back</button
		>
		<a href="/secure/Dashboard.jspa" style={linkStyle}>Go to the dashboard</a>
	</span>
{/snippet}

<section style="padding: 48px 32px;">
	<EmptyState
		header="This page does not exist"
		description="The link may be broken, or the page may have been moved or deleted."
		{primaryAction}
	/>
</section>
