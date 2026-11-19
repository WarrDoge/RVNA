<script lang="ts">
	import PageTitle from "#lib/components/PageTitle.svelte";

	interface Props {
		title: string;
		message: string;
		back?: boolean;
	}

	let { title, message, back = true }: Props = $props();
</script>

<PageTitle {title} />

<section class="message">
	<h1>{title}</h1>
	<p class="text">{message}</p>
	{#if back}
		<p class="back"><a href="/wiki">Back to the wiki home</a></p>
	{/if}
</section>

<style>
	.message {
		padding: 40px 32px;
		max-width: 720px;
	}

	h1 {
		margin: 0 0 8px;
		font-size: 24px;
		font-weight: 500;
	}

	.text {
		margin: 0;
		color: var(--ds-text-subtle);
	}

	.back {
		margin-top: 16px;
	}
</style>
