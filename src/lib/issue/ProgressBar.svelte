<script lang="ts">
	interface Props {
		category: string;
	}

	let { category }: Props = $props();

	let percent = $derived(
		category === "done" ? 100 : category === "indeterminate" ? 50 : 0,
	);
</script>

<span class="progress">
	<span
		class="fill"
		class:done={percent === 100}
		style="width: {percent}%;"
	></span>
</span>

<style>
	.progress {
		display: inline-block;
		width: 70px;
		height: 6px;
		border-radius: 3px;
		background-color: var(--ds-background-neutral, #0515240f);
		overflow: hidden;
		vertical-align: middle;
	}

	.fill {
		display: block;
		height: 100%;
		background-color: var(--ds-background-brand-bold, #0c66e4);
	}

	.fill.done {
		background-color: #22a06b;
	}
</style>
