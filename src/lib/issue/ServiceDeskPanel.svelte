<script lang="ts">
	import Module from "#lib/components/Module.svelte";
	import type { ServiceDeskRequest } from "./panels-types.ts";

	interface Props {
		data: ServiceDeskRequest | null;
	}

	let { data }: Props = $props();

	const channelLabels: Record<string, string> = {
		portal: "Customer portal",
		email: "Email",
		agent: "Agent",
		api: "API",
		chat: "Chat",
	};
</script>

{#if data?.requestType}
	<Module title="Service desk request">
		<div class="rows">
			<div class="row">
				<div class="label">Request type</div>
				<div>{data.requestType.name}</div>
			</div>
			<div class="row">
				<div class="label">Channel</div>
				<div>
					{data.channel ? (channelLabels[data.channel] ?? data.channel) : "—"}
				</div>
			</div>
			{#if data.customerUrl && data.isAgent}
				<a href={data.customerUrl} class="link">View customer request</a>
			{/if}
		</div>
	</Module>
{/if}

<style>
	.rows {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.row {
		display: flex;
		gap: 8px;
	}

	.label {
		width: 82px;
		flex: none;
		color: var(--ds-text-subtle, #596773);
	}

	.link {
		color: var(--ds-link, #0c66e4);
	}
</style>
