<script lang="ts">
	import type { StatusRef } from "#lib/api-types.ts";
	import Lozenge from "#lib/components/Lozenge.svelte";

	interface Props {
		status: Pick<StatusRef, "name" | "category">;
	}

	let { status }: Props = $props();

	let appearance: "default" | "success" | "inprogress" = $derived(
		status.category === "done"
			? "success"
			: status.category === "indeterminate"
				? "inprogress"
				: "default",
	);
</script>

<span class="fat-lozenge">
	<Lozenge {appearance}>{status.name}</Lozenge>
</span>
