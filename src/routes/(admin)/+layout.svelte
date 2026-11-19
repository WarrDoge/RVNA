<script lang="ts">
	import type { Snippet } from "svelte";
	import AdminForbidden from "#lib/admin/AdminForbidden.svelte";
	import AdminNav from "#lib/admin/AdminNav.svelte";
	import type { LayoutData } from "./$types";

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

{#if data.user?.isAdmin}
	<div class="admin-frame">
		<AdminNav />
		{@render children()}
	</div>
{:else}
	<AdminForbidden />
{/if}

<style>
	.admin-frame {
		display: flex;
		min-height: calc(100vh - 56px);
	}
</style>
