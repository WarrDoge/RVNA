<script lang="ts">
	import Modal from "#lib/components/Modal.svelte";
	import { formatDateTime } from "./format.ts";
	import type { PageDetail } from "./types.ts";

	interface Props {
		page: PageDetail;
		onClose: () => void;
	}

	let { page, onClose }: Props = $props();

	let rows = $derived<[string, string][]>([
		["Title", page.title],
		["Page ID", page.sourceId],
		["Space", `${page.space.name} (${page.space.key})`],
		["Version", String(page.versionNumber)],
		["Created by", page.creator?.displayName ?? "Unknown"],
		["Created", formatDateTime(page.created)],
		["Last modified by", page.lastModifier?.displayName ?? "Unknown"],
		["Last modified", formatDateTime(page.updated)],
		["Watchers", String(page.watchers.count)],
		["Likes", String(page.likes.count)],
		["Labels", page.labels.map((label) => label.label).join(", ") || "None"],
		["Restrictions", page.restricted ? "Restricted" : "None"],
	]);
</script>

{#snippet footer()}{/snippet}

<Modal title="Page information" {onClose} width={520} footer={footer}>
	<dl>
		{#each rows as [term, value] (term)}
			<div class="row">
				<dt>{term}</dt>
				<dd>{value}</dd>
			</div>
		{/each}
	</dl>
</Modal>

<style>
	dl {
		display: grid;
		grid-template-columns: 150px 1fr;
		row-gap: 8px;
		margin: 0;
		font-size: 14px;
	}

	.row {
		display: contents;
	}

	dt {
		color: var(--ds-text-subtle);
	}

	dd {
		margin: 0;
	}
</style>
