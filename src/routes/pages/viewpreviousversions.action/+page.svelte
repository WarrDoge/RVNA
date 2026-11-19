<script lang="ts">
	import "#lib/wiki/wiki.css";
	import { invalidate } from "$app/navigation";
	import PageMessage from "#lib/wiki/PageMessage.svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import WikiLayout from "#lib/wiki/WikiLayout.svelte";
	import { restoreVersion } from "#lib/wiki/api.ts";
	import { formatDateTime } from "#lib/wiki/format.ts";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let selected = $state<string[]>([]);
	let restoring = $state(false);
	let error = $state<string | null>(null);

	let compareHref = $derived(
		selected.length === 2 && data.page
			? `/pages/diffpagesbyversion.action?pageId=${encodeURIComponent(
					data.page.sourceId,
				)}&${selected
					.map((value) => `selectedPageVersions=${value}`)
					.join("&")}`
			: null,
	);

	function toggle(value: string) {
		selected = selected.includes(value)
			? selected.filter((entry) => entry !== value)
			: [...selected, value].slice(-2);
	}

	async function restore(version: number) {
		if (!data.page) return;
		restoring = true;
		error = null;
		try {
			await restoreVersion(data.page.id, version);
			await invalidate("app:wiki-page");
		} catch (cause) {
			error =
				cause instanceof Error ? cause.message : "Something went wrong";
		} finally {
			restoring = false;
		}
	}
</script>

{#if !data.page}
	<PageMessage
		title="Page not found"
		message="This page does not exist, or you do not have permission to view it."
		back={false}
	/>
{:else}
	{#key data.page.id}
		<PageTitle title={data.page.title} />
		<WikiLayout
			space={data.page.space}
			tree={data.tree}
			currentPageId={data.page.id}
			contextPageId={data.page.sourceId}
			ancestorIds={data.page.ancestors.map((ancestor) => ancestor.id)}
		>
			<div class="wiki-crumbs">
				<a href={`/display/${encodeURIComponent(data.page.space.key)}`}>
					{data.page.space.name}
				</a>
				<span>/</span>
				<a href={`/pages/viewpage.action?pageId=${data.page.sourceId}`}>
					{data.page.title}
				</a>
				<span>/</span>
				<span>Page history</span>
			</div>
			<div class="wiki-page-header">
				<h1 class="wiki-page-title">Page history</h1>
				<div class="wiki-actions">
					{#if compareHref}
						<a class="wiki-action" href={compareHref}>
							Compare selected versions
						</a>
					{:else}
						<span class="hint">Select two versions to compare</span>
					{/if}
				</div>
			</div>

			<table class="fat-table wiki-version-table table">
				<thead>
					<tr>
						<th>Compare</th>
						<th>Version</th>
						<th>Date</th>
						<th>Author</th>
						<th>Message</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.versions as version (version.number)}
						<tr>
							<td>
								<input
									type="checkbox"
									aria-label={`Select version ${version.number}`}
									bind:checked={() => selected.includes(String(version.number)), (value) => {
										if (value !== selected.includes(String(version.number))) {
											toggle(String(version.number));
										}
									}}
								/>
							</td>
							<td>
								<a
									href={`/pages/viewpage.action?pageId=${encodeURIComponent(
										data.page.sourceId,
									)}&pageVersion=${version.number}`}
								>
									{version.number}
								</a>{#if version.current}<span class="wiki-badge current">current</span>{/if}
							</td>
							<td>{formatDateTime(version.created)}</td>
							<td>{version.author?.displayName ?? "Unknown"}</td>
							<td>
								{version.message}{version.minorEdit ? " (minor edit)" : ""}
							</td>
							<td>
								{#if !version.current && data.canEdit}
									<button
										type="button"
										class="wiki-action"
										disabled={restoring}
										onclick={() => void restore(version.number)}
									>
										Restore
									</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if error}
				<p role="alert" class="error">{error}</p>
			{/if}
			{#if data.versions.length === 0}
				<p class="wiki-list-empty">No versions yet.</p>
			{/if}
		</WikiLayout>
	{/key}
{/if}

<style>
	.hint {
		color: var(--ds-text-subtle);
		font-size: 13px;
	}

	.table {
		margin-top: 16px;
	}

	.current {
		margin-left: 6px;
	}

	.error {
		color: var(--ds-text-danger);
	}
</style>
