<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		tone?: "warning" | "danger" | "info";
		title?: string;
		actions?: Snippet;
		children: Snippet;
	}

	let { tone = "warning", title, actions, children }: Props = $props();
</script>

<div
	class="wed-banner"
	data-tone={tone}
	role={tone === "danger" ? "alert" : "status"}
>
	<div class="wed-banner-main">
		{#if title}<p class="wed-banner-title">{title}</p>{/if}
		<p class="wed-banner-text">{@render children()}</p>
		{#if actions}
			<div class="wed-banner-actions">{@render actions()}</div>
		{/if}
	</div>
</div>
