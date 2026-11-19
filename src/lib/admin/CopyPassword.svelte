<script lang="ts">
	import Button from "#lib/components/Button.svelte";
	import { inputStyle } from "./styles.ts";

	let {
		password,
		copied,
		onCopy,
	}: { password: string; copied: boolean; onCopy: () => void } = $props();
</script>

<div class="copy-password">
	<input
		readonly
		aria-label="Generated password"
		value={password}
		onfocus={(event) => event.currentTarget.select()}
		style="{inputStyle} font-family: monospace;"
	/>
	<Button onclick={onCopy}>{copied ? "Copied" : "Copy"}</Button>
</div>

<style>
	.copy-password {
		display: flex;
		gap: 8px;
		align-items: center;
	}
</style>
