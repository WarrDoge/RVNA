<script lang="ts">
	import { api } from "#lib/api.ts";
	import Modal from "#lib/components/Modal.svelte";
	import PermissionList from "./PermissionList.svelte";
	import type { PageDetail, Restrictions } from "./types.ts";

	interface Props {
		page: PageDetail;
		onClose: () => void;
	}

	let { page, onClose }: Props = $props();

	let restrictions = $state<Restrictions | null>(null);
	let failed = $state(false);

	$effect(() => {
		let cancelled = false;
		restrictions = null;
		failed = false;
		api<Restrictions>(
			`/api/wiki/pages/${encodeURIComponent(page.id)}/restrictions`,
		)
			.then((result) => {
				if (!cancelled) restrictions = result;
			})
			.catch(() => {
				if (!cancelled) failed = true;
			});
		return () => {
			cancelled = true;
		};
	});

	let pageRows = $derived(
		(restrictions?.page ?? []).map((row) => ({
			label: row.operation === "read" ? "Can view" : "Can edit",
			detail: row.user
				? row.user.displayName
				: (row.groupName ?? "everyone"),
		})),
	);
	let spaceRows = $derived(
		(restrictions?.space ?? []).map((row) => ({
			label: row.permission,
			detail: row.anonymous
				? "anonymous"
				: row.user
					? row.user.displayName
					: (row.groupName ?? "unknown"),
		})),
	);

</script>

{#snippet footer()}
	<span class="footer-note">This dialog is read-only.</span>
{/snippet}

<Modal title="Restrictions" {onClose} width={560} footer={footer}>
	{#if failed}
		<p>Unable to load restrictions.</p>
	{:else if !restrictions}
		<p>Loading…</p>
	{:else}
		<PermissionList
			title="Page restrictions"
			rows={pageRows}
			empty="This page inherits the space restrictions."
		/>
		{#if spaceRows.length > 0}
			<PermissionList title="Space permissions" rows={spaceRows} empty="" />
		{/if}
	{/if}
</Modal>

<style>
	.footer-note {
		color: var(--ds-text-subtle);
		font-size: 13px;
	}
</style>
