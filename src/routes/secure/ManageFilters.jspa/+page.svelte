<script lang="ts">
	import { untrack } from "svelte";
	import { invalidate } from "$app/navigation";
	import type { Filter } from "#lib/api-types.ts";
	import { api } from "#lib/api.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import Icon from "#lib/components/Icon.svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import UserLink from "#lib/components/UserLink.svelte";
	import { relativeDate } from "#lib/dates.ts";
	import EditFilterDialog from "./EditFilterDialog.svelte";
	import { filterTabs } from "./tabs.ts";
	import type { PageData } from "./$types";

	type PageFilter = Omit<
		Filter,
		"jql" | "columns" | "sharedWith" | "favouriteCount" | "createdAt"
	> & {
		sharedSome: boolean;
		sharedWith?: {
			projectIds: string[];
			groups: string[];
			groupIds: string[];
		};
	};
	type EditableFilter = PageFilter & {
		sharedWith: NonNullable<PageFilter["sharedWith"]>;
	};

	let { data }: { data: PageData } = $props();

	let query = $state(untrack(() => data.query));
	let loadedQuery = untrack(() => data.query);
	$effect(() => {
		if (data.query === loadedQuery) return;
		loadedQuery = data.query;
		query = data.query;
	});

	let editing = $state<EditableFilter | null>(null);
	let deleting = $state<PageFilter | null>(null);
	let deletePending = $state(false);
	let error = $state<string | null>(null);

	async function toggleFavourite(filter: PageFilter) {
		error = null;
		try {
			await api(`/api/filters/${filter.id}/favourite`, {
				method: filter.favourite ? "DELETE" : "PUT",
			});
			await invalidate("app:filters");
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Something went wrong";
		}
	}

	async function confirmDelete() {
		if (!deleting) return;
		deletePending = true;
		error = null;
		try {
			await api(`/api/filters/${deleting.id}`, { method: "DELETE" });
			deleting = null;
			await invalidate("app:filters");
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Something went wrong";
		} finally {
			deletePending = false;
		}
	}
</script>

<PageTitle title="Manage filters" />

<section class="filters">
	<div class="heading">
		<h1>Manage filters</h1>
		<a class="new-filter" href="/issues/">New filter</a>
	</div>

	<form method="GET" action="/secure/ManageFilters.jspa" class="tabs-form">
		<nav class="tabs" aria-label="Filter lists">
			{#each filterTabs as item (item.id)}
				<button
					type="submit"
					name="tab"
					value={item.id}
					aria-pressed={data.tab === item.id}
					class:selected={data.tab === item.id}
				>
					{item.label}
				</button>
			{/each}
		</nav>
	</form>

	{#if data.tab === "search"}
		<form method="GET" action="/secure/ManageFilters.jspa" class="search-form">
			<input type="hidden" name="tab" value="search" />
			<input
				class="search-input"
				aria-label="Search filters"
				name="query"
				placeholder="Search filters by name"
				bind:value={query}
			/>
		</form>
	{/if}

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	<table class="fat-table">
		<thead>
			<tr>
				<th class="favourite-column" aria-label="Favourite"></th>
				<th>Name</th>
				<th class="owner-column">Owner</th>
				<th class="shared-column">Shared</th>
				<th class="updated-column">Updated</th>
				<th class="actions-column">Actions</th>
			</tr>
		</thead>
		<tbody>
			{#each data.filters as filter (filter.id)}
				<tr>
					<td>
						<button
							type="button"
							class="star"
							aria-label={filter.favourite
								? `Remove ${filter.name} from favourites`
								: `Add ${filter.name} to favourites`}
							aria-pressed={filter.favourite}
							onclick={() => void toggleFavourite(filter)}
							style="color: {filter.favourite ? '#ffab00' : 'var(--ds-text-subtle)'};"
						>
							<Icon
								name={filter.favourite ? "star-filled" : "star"}
								size={14}
							/>
						</button>
					</td>
					<td>
						<a class="filter-link" href={`/issues/?filter=${filter.id}`}>
							{filter.name}
						</a>
						{#if filter.description}
							<div class="description">{filter.description}</div>
						{/if}
					</td>
					<td>
						<span class="owner">
							<Avatar user={filter.owner} size={20} />
							<UserLink username={filter.owner.username}>
								{filter.owner.displayName}
							</UserLink>
						</span>
					</td>
					<td>
						{filter.shared ? "Yes" : filter.sharedSome ? "Some" : "No"}
					</td>
					<td title={filter.updatedAt}>{relativeDate(filter.updatedAt)}</td>
					<td>
						{#if filter.canEdit}
							<span class="actions">
								<button
									type="button"
									class="link-button"
									onclick={() => {
										if (filter.sharedWith) {
											editing = { ...filter, sharedWith: filter.sharedWith };
										}
									}}
								>
									Edit
								</button>
								<button
									type="button"
									class="link-button delete"
									onclick={() => (deleting = filter)}
								>
									Delete
								</button>
							</span>
						{:else}
							<span class="muted">—</span>
						{/if}
					</td>
				</tr>
			{:else}
				<tr>
					<td colspan="6" class="muted">
						{data.tab === "favourite"
							? "You have no favourite filters yet. Use the star in My or Popular."
							: "No filters here yet."}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

{#if editing}
	<EditFilterDialog filter={editing} onSaved={() => (editing = null)} />
{/if}

{#if deleting}
	<ConfirmDialog
		title="Delete filter"
		message={`Delete the filter "${deleting.name}"?`}
		onClose={() => (deleting = null)}
		onConfirm={() => void confirmDelete()}
		pending={deletePending}
	/>
{/if}

<style>
	.filters {
		padding: 24px 32px;
		max-width: 1100px;
	}

	h1 {
		margin: 0;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text);
	}

	.heading {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 16px;
	}

	.new-filter {
		margin-left: auto;
		color: var(--ds-link);
		text-decoration: none;
	}

	.tabs-form,
	.search-form {
		margin: 0;
	}

	.tabs {
		display: flex;
		gap: 24px;
		border-bottom: 1px solid var(--ds-border);
		margin-bottom: 16px;
	}

	.tabs button {
		padding: 8px 0;
		margin-bottom: -1px;
		background: transparent;
		border: 0;
		border-bottom: 2px solid transparent;
		color: var(--ds-text-subtle);
		cursor: pointer;
		font-size: 14px;
		font-weight: 400;
	}

	.tabs button.selected {
		border-bottom-color: var(--ds-border-selected);
		color: var(--ds-text);
		font-weight: 500;
	}

	.search-input {
		width: 320px;
		height: 32px;
		margin-bottom: 12px;
		padding: 0 8px;
		background: var(--ds-background-input);
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text);
	}

	.error {
		margin: 0 0 12px;
		color: #e5493a;
	}

	.fat-table {
		width: 100%;
	}

	.favourite-column {
		width: 32px;
	}

	.owner-column {
		width: 180px;
	}

	.shared-column {
		width: 90px;
	}

	.updated-column {
		width: 130px;
	}

	.actions-column {
		width: 120px;
	}

	.star {
		display: inline-flex;
		padding: 2px;
		background: transparent;
		border: 0;
		cursor: pointer;
	}

	.filter-link {
		color: var(--ds-link);
		text-decoration: none;
	}

	.description {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.owner {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.actions {
		display: flex;
		gap: 12px;
	}

	.link-button {
		padding: 0;
		background: transparent;
		border: 0;
		color: var(--ds-link);
		cursor: pointer;
		font-size: 14px;
	}

	.link-button.delete {
		color: #e5493a;
	}

	.muted {
		color: var(--ds-text-subtle);
	}
</style>
