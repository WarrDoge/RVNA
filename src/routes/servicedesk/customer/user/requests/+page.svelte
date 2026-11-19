<script lang="ts">
	import { untrack } from "svelte";
	import { page } from "$app/state";
	import { relativeDate } from "#lib/dates.ts";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import PortalBreadcrumb from "../../PortalBreadcrumb.svelte";
	import PortalCard from "../../PortalCard.svelte";
	import StatusLozenge from "#lib/issue-form/StatusLozenge.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let scopeSelect: HTMLSelectElement;
	let query = $state(untrack(() => data.filters.query));
	let loadedQuery = untrack(() => data.filters.query);
	$effect(() => {
		if (data.filters.query === loadedQuery) return;
		loadedQuery = data.filters.query;
		query = data.filters.query;
	});

	type StatusFilter = "open" | "closed" | "all";
	type ScopeFilter = "all" | "created" | "participating";

	const statusTabs: { id: StatusFilter; label: string }[] = [
		{ id: "open", label: "Open requests" },
		{ id: "closed", label: "Closed requests" },
		{ id: "all", label: "All requests" },
	];

	const scopeTabs: { id: ScopeFilter; label: string }[] = [
		{ id: "all", label: "All" },
		{ id: "created", label: "Created by me" },
		{ id: "participating", label: "Participating" },
	];

	function statusHref(status: StatusFilter) {
		const url = new URL(page.url.href);
		if (status === "open") url.searchParams.delete("status");
		else url.searchParams.set("status", status);
		return `${url.pathname}${url.search}`;
	}
</script>

<PageTitle title="My requests" />

<PortalCard>
	<PortalBreadcrumb
		items={[
			{ label: "Help Center", href: "/servicedesk/customer/portals" },
			{ label: "Requests" },
		]}
	/>
	<h1 class="title">My requests</h1>

	<div class="tabs">
		{#each statusTabs as tab (tab.id)}
			<a
				class="tab"
				class:active={data.filters.status === tab.id}
				aria-current={data.filters.status === tab.id ? "page" : undefined}
				href={statusHref(tab.id)}
			>
				{tab.label}
			</a>
		{/each}
	</div>

	<form method="GET" class="filters">
		<input type="hidden" name="status" value={data.filters.status} />
		<label for="requests-scope" class="scope-label">Show</label>
		<select
			id="requests-scope"
			name="scope"
			bind:this={scopeSelect}
			bind:value={() => data.filters.scope, () =>
				scopeSelect.form?.requestSubmit()}
			class="select"
		>
			{#each scopeTabs as tab (tab.id)}
				<option value={tab.id}>{tab.label}</option>
			{/each}
		</select>
		<input
			type="search"
			name="q"
			aria-label="Search requests"
			placeholder="Search requests"
			bind:value={query}
			class="search"
		/>
	</form>

	<table class="fat-table requests-table">
		<thead>
			<tr>
				<th class="col-reference">Reference</th>
				<th>Summary</th>
				<th class="col-status">Status</th>
				<th class="col-requester">Requester</th>
				<th class="col-created">Created</th>
			</tr>
		</thead>
		<tbody>
			{#each data.requests as request (request.key)}
				<tr>
					<td>
						<a
							href={`/servicedesk/customer/portal/${request.portalId}/${request.key}`}
							class="reference"
						>
							{request.key}
						</a>
					</td>
					<td>{request.summary}</td>
					<td><StatusLozenge status={request.status} /></td>
					<td>{request.reporter?.displayName ?? "—"}</td>
					<td>{relativeDate(request.created)}</td>
				</tr>
			{/each}
			{#if data.requests.length === 0}
				<tr>
					<td colspan="5" class="muted">No requests match these filters.</td>
				</tr>
			{/if}
		</tbody>
	</table>
	<p class="total">
		{data.total}
		{data.total === 1 ? "request" : "requests"}
	</p>
</PortalCard>

<style>
	.title {
		margin: 0 0 16px;
		font-size: 24px;
		font-weight: 600;
		line-height: 28px;
	}

	.tabs {
		display: flex;
		gap: 18px;
		border-bottom: 1px solid var(--ds-border);
		margin-bottom: 12px;
	}

	.tab {
		display: inline-block;
		padding: 4px 0 8px;
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
		font-weight: 600;
	}

	.filters {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 12px;
		flex-wrap: wrap;
	}

	.scope-label {
		color: var(--ds-text-subtle);
		font-size: 13px;
	}

	.select {
		height: 30px;
		padding: 0 8px;
		background-color: var(--ds-background-input);
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text);
	}

	.search {
		margin-left: auto;
		width: 240px;
		height: 30px;
		padding: 0 8px;
		background-color: var(--ds-background-input);
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text);
	}

	.requests-table {
		width: 100%;
	}

	.col-reference {
		width: 110px;
	}

	.col-status {
		width: 140px;
	}

	.col-requester {
		width: 170px;
	}

	.col-created {
		width: 140px;
	}

	.reference {
		color: var(--ds-link);
		font-weight: 500;
	}

	.muted {
		color: var(--ds-text-subtle);
	}

	.total {
		margin: 12px 0 0;
		color: var(--ds-text-subtle);
	}
</style>
