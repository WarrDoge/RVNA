<script lang="ts">
	let {
		value,
		onChange,
		placeholder,
		width = 240,
	}: {
		value: string;
		onChange: (value: string) => void;
		placeholder: string;
		width?: number;
	} = $props();
</script>

<div class="search-field">
	<input
		type="search"
		class="search-input"
		aria-label={placeholder}
		{placeholder}
		bind:value={() => value, (next) => onChange(next)}
		style:width={`${width}px`}
	/>
</div>

<style>
	.search-field {
		margin-bottom: 12px;
	}

	.search-input {
		height: 32px;
		padding: 0 8px;
		background-color: var(--ds-background-input);
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text);
		font-size: 14px;
	}
</style>
