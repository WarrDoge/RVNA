<script lang="ts">
	import type { Snippet } from "svelte";
	import LogoMark from "#lib/components/LogoMark.svelte";

	interface Props {
		title: string;
		children: Snippet;
	}

	let { title, children }: Props = $props();
</script>

<div class="outer">
	<main class="card">
		<div class="logo"><LogoMark size={40} /></div>
		<h1>{title}</h1>
		{@render children()}
	</main>
</div>

<style>
	.outer {
		min-height: 100vh;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 96px 16px 32px;
		background-color: var(--ds-surface);
		color: var(--ds-text);
	}

	.card {
		width: 400px;
		max-width: 100%;
		padding: 32px 40px 40px;
		background-color: var(--ds-surface-raised);
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		box-shadow: var(--ds-shadow-raised);
	}

	.logo {
		display: flex;
		justify-content: center;
	}

	h1 {
		margin: 16px 0 24px;
		text-align: center;
		font-size: 20px;
		font-weight: 500;
		line-height: 24px;
	}
</style>
