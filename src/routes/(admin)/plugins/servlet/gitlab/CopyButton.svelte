<script lang="ts">
	import { onMount } from "svelte";
	import { copyToClipboard } from "#lib/admin/clipboard.ts";
	import Button from "#lib/components/Button.svelte";

	interface Props {
		value: string;
	}

	let { value }: Props = $props();
	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	onMount(() => () => {
		if (timer) clearTimeout(timer);
	});

	async function copy() {
		copied = await copyToClipboard(value);
		if (!copied) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => (copied = false), 2000);
	}
</script>

<Button spacing="compact" onclick={copy}>{copied ? "Copied" : "Copy"}</Button>
