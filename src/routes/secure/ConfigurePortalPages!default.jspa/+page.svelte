<script lang="ts">
	import { untrack } from "svelte";
	import { invalidate } from "$app/navigation";
	import { api } from "#lib/api.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import Button from "#lib/components/Button.svelte";
	import Icon from "#lib/components/Icon.svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import { relativeDate } from "#lib/dates.ts";
	import CreateDashboardDialog from "#lib/dashboards/CreateDashboardDialog.svelte";
	import DeleteDashboardDialog from "#lib/dashboards/DeleteDashboardDialog.svelte";
	import {
		dashboardHref,
		errorMessage,
	} from "#lib/dashboards/gadget-helpers.ts";
	import type { Dashboard } from "#lib/dashboards/types.ts";
	import type { PageData } from "./$types";
	import { dashboardTabs, type DashboardTab } from "./tabs.ts";

	let { data }: { data: PageData } = $props();

	let creating = $state(false);
	let deleting = $state<Dashboard | null>(null);
	let error = $state<string | null>(null);
	let query = $state(untrack(() => data.query));
	let loadedQuery = untrack(() => data.query);
	$effect(() => {
		if (data.query === loadedQuery) return;
		loadedQuery = data.query;
		query = data.query;
	});

	function tabHref(tab: DashboardTab) {
		const params = new URLSearchParams({ tab });
		if (tab === "search" && data.query !== "") params.set("query", data.query);
		return `?${params}`;
	}

	async function toggleFavourite(dashboard: Dashboard) {
		try {
			await api(`/api/dashboards/${dashboard.id}/favourite`, {
				method: dashboard.favourite ? "DELETE" : "PUT",
			});
			await invalidate("app:dashboards");
		} catch (cause) {
			error = errorMessage(cause);
		}
	}

	async function refresh() {
		await invalidate("app:dashboards");
	}
</script>

<PageTitle title="Manage Dashboards" />

<section class="page">
	<div class="header">
		<h1>Manage dashboards</h1>
		<div class="header-action">
			<Button appearance="primary" onclick={() => (creating = true)}>
				Create dashboard
			</Button>
		</div>
	</div>

	<nav class="tabs">
		{#each dashboardTabs as item (item.id)}
			<a
				class="tab"
				class:active={data.tab === item.id}
				href={tabHref(item.id)}
				aria-current={data.tab === item.id ? "page" : undefined}
			>
				{item.label}
			</a>
		{/each}
	</nav>

	{#if data.tab === "search"}
		<form
			method="GET"
			action="/secure/ConfigurePortalPages!default.jspa"
			class="search-form"
		>
			<input type="hidden" name="tab" value="search" />
			<input
				aria-label="Search dashboards"
				placeholder="Search dashboards by name"
				class="search"
				name="query"
				bind:value={query}
			/>
			<Button type="submit">Search</Button>
		</form>
	{/if}

	{#if error}
		<p role="alert" class="error">{error}</p>
	{/if}

	<table class="fat-table">
		<thead>
			<tr>
				<th class="favourite-head" aria-label="Favourite"></th>
				<th>Name</th>
				<th class="owner">Owner</th>
				<th class="shared">Shared</th>
				<th class="updated">Updated</th>
				<th class="actions">Actions</th>
			</tr>
		</thead>
		<tbody>
			{#each data.dashboards as dashboard (dashboard.id)}
				<tr>
					<td>
						<button
							type="button"
							class="star"
							class:filled={dashboard.favourite}
							aria-label={dashboard.favourite
								? `Remove ${dashboard.name} from favourites`
								: `Add ${dashboard.name} to favourites`}
							aria-pressed={dashboard.favourite}
							onclick={() => void toggleFavourite(dashboard)}
						>
							<Icon
								name={dashboard.favourite ? "star-filled" : "star"}
								size={14}
							/>
						</button>
					</td>
					<td>
						<a href={dashboardHref(dashboard)} class="name">{dashboard.name}</a>
						{#if dashboard.description}
							<div class="description">{dashboard.description}</div>
						{/if}
					</td>
					<td>
						<span class="owner-cell">
							<Avatar user={dashboard.owner} size={20} />
							{dashboard.owner.displayName}
						</span>
					</td>
					<td>{dashboard.shared ? "Yes" : "No"}</td>
					<td title={dashboard.updatedAt}>{relativeDate(dashboard.updatedAt)}</td>
					<td>
						{#if dashboard.canEdit}
							<button
								type="button"
								class="delete"
								onclick={() => (deleting = dashboard)}
							>
								Delete
							</button>
						{:else}
							<span class="dash">—</span>
						{/if}
					</td>
				</tr>
			{/each}
			{#if data.dashboards.length === 0}
				<tr>
					<td colspan={6} class="empty">
						{data.tab === "favourite"
							? "You have no favourite dashboards yet. Use the star in Popular or Search."
							: "No dashboards here yet."}
					</td>
				</tr>
			{/if}
		</tbody>
	</table>

	{#if creating}
		<CreateDashboardDialog
			intent="create"
			onClose={() => (creating = false)}
			onsuccess={() => {
				creating = false;
				void refresh();
			}}
		/>
	{/if}
	{#if deleting}
		<DeleteDashboardDialog
			dashboard={deleting}
			intent="delete"
			onClose={() => (deleting = null)}
			onsuccess={() => {
				deleting = null;
				void refresh();
			}}
		/>
	{/if}
</section>

<style>
	.page {
		padding: 24px 32px;
		max-width: 1100px;
	}
	.header {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 16px;
	}
	h1 {
		margin: 0;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text);
	}
	.header-action {
		margin-left: auto;
	}
	.tabs {
		display: flex;
		gap: 24px;
		border-bottom: 1px solid var(--ds-border);
		margin-bottom: 16px;
	}
	.tab {
		padding: 8px 0;
		margin-bottom: -1px;
		background: transparent;
		border: 0;
		border-bottom: 2px solid transparent;
		color: var(--ds-text-subtle);
		font-weight: 400;
		cursor: pointer;
		font-size: 14px;
		text-decoration: none;
	}
	.tab.active {
		border-bottom-color: var(--ds-border-selected);
		color: var(--ds-text);
		font-weight: 500;
	}
	.search-form {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}
	.search {
		display: block;
		width: 320px;
		min-height: 32px;
		padding: 4px 8px;
		background: var(--ds-background-input);
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text);
		font-size: 14px;
	}
	.error {
		color: #e5493a;
	}
	table {
		width: 100%;
	}
	.favourite-head {
		width: 32px;
	}
	.owner {
		width: 200px;
	}
	.shared {
		width: 90px;
	}
	.updated {
		width: 130px;
	}
	.actions {
		width: 120px;
	}
	.star {
		display: inline-flex;
		padding: 2px;
		background: transparent;
		border: 0;
		color: var(--ds-text-subtle);
		cursor: pointer;
	}
	.star.filled {
		color: #ffab00;
	}
	.name {
		color: var(--ds-link);
		text-decoration: none;
	}
	.description {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}
	.owner-cell {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.delete {
		padding: 0;
		background: transparent;
		border: 0;
		color: #e5493a;
		cursor: pointer;
		font-size: 14px;
	}
	.dash {
		color: var(--ds-text-subtle);
	}
	.empty {
		color: var(--ds-text-subtle);
	}
</style>
