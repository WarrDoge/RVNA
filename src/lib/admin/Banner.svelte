<script lang="ts">
	import type { Snippet } from "svelte";

	type Tone = "information" | "warning" | "danger" | "success";

	let {
		tone = "information",
		children,
	}: { tone?: Tone; children: Snippet } = $props();
</script>

<div
	class="banner"
	class:information={tone === "information"}
	class:warning={tone === "warning"}
	class:danger={tone === "danger"}
	class:success={tone === "success"}
	role={tone === "danger" ? "alert" : "status"}
>
	{@render children()}
</div>

<style>
	.banner {
		margin: 0 0 16px;
		padding: 8px 12px;
		border-radius: 3px;
		color: var(--ds-text);
	}

	.banner.information {
		background-color: var(--ds-background-information);
	}

	.banner.warning {
		background-color: var(--ds-background-warning);
	}

	.banner.danger {
		background-color: var(--ds-background-danger);
	}

	.banner.success {
		background-color: var(--ds-background-success);
	}
</style>
