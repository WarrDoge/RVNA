<script lang="ts">
	interface Props {
		colours: { name: string; value: string }[];
		defaultLabel: string;
		onpick: (value: string | null) => void;
	}

	let { colours, defaultLabel, onpick }: Props = $props();
</script>

<div class="wke-swatches">
	<button type="button" class="wke-menu-item" onclick={() => onpick(null)}>
		{defaultLabel}
	</button>
	<div class="wke-swatch-grid">
		{#each colours as colour (colour.value)}
			<button
				type="button"
				title={colour.name}
				aria-label={colour.name}
				class="wke-swatch"
				style="background: {colour.value}"
				onclick={() => onpick(colour.value)}
			></button>
		{/each}
	</div>
</div>
