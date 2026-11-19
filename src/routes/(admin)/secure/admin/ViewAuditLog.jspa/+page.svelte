<script lang="ts">
	import { goto } from "$app/navigation";
	import { untrack } from "svelte";
	import { absoluteDate, relativeDate } from "#lib/dates.ts";
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import Banner from "#lib/admin/Banner.svelte";
	import EmptyRow from "#lib/admin/EmptyRow.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import Icon from "#lib/components/Icon.svelte";
	import type { PageData } from "./$types";

	type Filters = PageData["filters"];
	type Entry = PageData["audit"]["entries"][number];

	const pageSize = 50;
	const auditPath = "/secure/admin/ViewAuditLog.jspa";

	let { data }: { data: PageData } = $props();

	let expanded = $state(new Set<string>());
	let queryDraft = $state(untrack(() => data.filters.query));
	let draftDirty = $state(false);
	let pendingFilters = $state<Filters | null>(null);
	let searchTimer: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		const loaded = data.filters.query;
		if (loaded === queryDraft) draftDirty = false;
		else if (!draftDirty) queryDraft = loaded;
	});

	$effect(() => {
		const loaded = data.filters;
		const pending = pendingFilters;
		if (pending && sameFilters(loaded, pending)) pendingFilters = null;
	});

	$effect(() => () => {
		if (searchTimer) clearTimeout(searchTimer);
	});

	function sameFilters(left: Filters, right: Filters) {
		return (
			left.actor === right.actor &&
			left.action === right.action &&
			left.entityType === right.entityType &&
			left.from === right.from &&
			left.to === right.to &&
			left.query === right.query
		);
	}

	function currentFilters() {
		return pendingFilters ?? data.filters;
	}

	function hasAuditFilters(filters: Filters) {
		return Object.values(filters).some((value) => value !== "");
	}

	function auditUrl(filters: Filters, offset: number) {
		const params = new URLSearchParams();
		if (filters.actor) params.set("actor", filters.actor);
		if (filters.action) params.set("action", filters.action);
		if (filters.entityType) params.set("entityType", filters.entityType);
		if (filters.from) params.set("from", filters.from);
		if (filters.to) params.set("to", filters.to);
		if (filters.query) params.set("query", filters.query);
		if (offset > 0) params.set("offset", String(offset));
		const query = params.toString();
		return query === "" ? auditPath : `${auditPath}?${query}`;
	}

	/** Applies a filter patch and keeps a pending search draft. */
	function setFilters(patch: Partial<Filters>, nextOffset = 0) {
		if (searchTimer) {
			clearTimeout(searchTimer);
			searchTimer = null;
		}
		if (patch.query !== undefined) {
			queryDraft = patch.query;
		}
		const next = { ...currentFilters(), query: queryDraft, ...patch };
		pendingFilters = next;
		void goto(auditUrl(next, nextOffset), {
			replace: true,
			reset: false,
		});
	}

	function changeQuery(value: string) {
		queryDraft = value;
		draftDirty = true;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			if (value !== currentFilters().query) {
				setFilters({ query: value });
			} else {
				draftDirty = false;
			}
		}, 350);
	}

	function toggle(id: string) {
		const next = new Set(expanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expanded = next;
	}

	function actionGroups(actions: string[]) {
		const groups = new Map<string, string[]>();
		for (const action of actions) {
			const dot = action.indexOf(".");
			const entity = dot === -1 ? action : action.slice(0, dot);
			const list = groups.get(entity) ?? [];
			list.push(action);
			groups.set(entity, list);
		}
		return [...groups.entries()];
	}

	/** A change value as the diff shows it: absent, cleared, or the value itself. */
	function formatChangeValue(value: unknown) {
		if (value === undefined) return "—";
		if (value === null) return "None";
		if (typeof value === "boolean") return value ? "Yes" : "No";
		if (typeof value === "string") return value === "" ? "(empty)" : value;
		if (typeof value === "number") return String(value);
		return JSON.stringify(value);
	}

	function changeFields(changes: unknown) {
		if (typeof changes !== "object" || changes === null) return [];
		const record = changes as { from?: unknown; to?: unknown };
		const from =
			typeof record.from === "object" && record.from !== null
				? (record.from as Record<string, unknown>)
				: {};
		const to =
			typeof record.to === "object" && record.to !== null
				? (record.to as Record<string, unknown>)
				: {};
		const fields = [...new Set([...Object.keys(from), ...Object.keys(to)])];
		return fields.map((field) => ({
			field,
			from: from[field],
			to: to[field],
		}));
	}

	/** The settings rows store ids; show the names an administrator recognises. */
	function display(field: string, value: unknown) {
		const isName =
			field === "defaultIssueTypeId" || field === "defaultPriorityId";
		if (
			isName &&
			typeof value === "string" &&
			Object.hasOwn(data.names, value)
		) {
			return data.names[value] as string;
		}
		return formatChangeValue(value);
	}

	function csvUrl() {
		const params = new URLSearchParams();
		if (data.filters.actor) params.set("actor", data.filters.actor);
		if (data.filters.action) params.set("action", data.filters.action);
		if (data.filters.entityType) {
			params.set("entityType", data.filters.entityType);
		}
		if (data.fromIso) params.set("from", data.fromIso);
		if (data.toIso) params.set("to", data.toIso);
		if (data.filters.query) params.set("query", data.filters.query);
		return `/api/admin/audit.csv?${params.toString()}`;
	}

	let filtered = $derived(hasAuditFilters(data.filters));
	let total = $derived(data.audit.total);
	let start = $derived(total === 0 ? 0 : data.offset + 1);
	let end = $derived(Math.min(data.offset + pageSize, total));
</script>

{#snippet changeDetails(entry: Entry)}
	{@const fields = changeFields(entry.changes)}
	<div class="change-details">
		<div class="entity-line">
			{entry.entityType}
			{entry.entityId ? ` · ${entry.entityId}` : ""}
		</div>
		{#if fields.length === 0}
			<div class="no-fields">No field details were recorded.</div>
		{:else}
			<div class="changes-grid">
				<div></div>
				<div class="detail-label">From</div>
				<div class="detail-label">To</div>
				{#each fields as change (change.field)}
					<div class="detail-label">{change.field}</div>
					<div class="detail-value">{display(change.field, change.from)}</div>
					<div class="detail-value">{display(change.field, change.to)}</div>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

<AdminPage
	title="Audit log"
	description="Every change made through the administration screens, newest first."
>
	{#snippet actions()}
		<Button href={csvUrl()} appearance="subtle">Export CSV</Button>
	{/snippet}

	<section class="filters" aria-label="Filters">
		<label class="filter">
			<span class="filter-label">Who</span>
			<select
				bind:value={() => data.filters.actor, (value) =>
					setFilters({ actor: value })}
				style="{inputStyle} height: 32px;"
			>
				<option value="">Anyone</option>
				{#each data.filterOptions.actors as actor (`${actor.id ?? actor.name}`)}
					<option value={actor.id ?? actor.name}>{actor.name}</option>
				{/each}
			</select>
		</label>

		<label class="filter">
			<span class="filter-label">Action</span>
			<select
				bind:value={() => data.filters.action, (value) =>
					setFilters({ action: value })}
				style="{inputStyle} height: 32px;"
			>
				<option value="">All actions</option>
				{#each actionGroups(data.filterOptions.actions) as [entity, actions] (entity)}
					<optgroup label={entity}>
						{#each actions as action (action)}
							<option value={action}>{action}</option>
						{/each}
					</optgroup>
				{/each}
			</select>
		</label>

		<label class="filter">
			<span class="filter-label">Entity</span>
			<select
				bind:value={() => data.filters.entityType, (value) =>
					setFilters({ entityType: value })}
				style="{inputStyle} height: 32px;"
			>
				<option value="">All entities</option>
				{#each data.filterOptions.entityTypes as entityType (entityType)}
					<option value={entityType}>{entityType}</option>
				{/each}
			</select>
		</label>

		<label class="filter">
			<span class="filter-label">From</span>
			<input
				type="date"
				bind:value={() => data.filters.from, (value) =>
					setFilters({ from: value })}
				style="{inputStyle} height: 32px;"
			/>
		</label>

		<label class="filter">
			<span class="filter-label">To</span>
			<input
				type="date"
				bind:value={() => data.filters.to, (value) =>
					setFilters({ to: value })}
				style="{inputStyle} height: 32px;"
			/>
		</label>

		<label class="filter">
			<span class="filter-label">Search</span>
			<input
				type="search"
				bind:value={() => queryDraft, (value) => changeQuery(value)}
				placeholder="Summary, action or person"
				style="{inputStyle} height: 32px;"
			/>
		</label>

		{#if filtered && data.audit.entries.length > 0}
			<div class="clear-row">
				<Button
					appearance="subtle"
					onclick={() =>
						setFilters({
							actor: "",
							action: "",
							entityType: "",
							from: "",
							to: "",
							query: "",
						})}
				>
					Clear filters
				</Button>
			</div>
		{/if}
	</section>

	<table class="fat-table audit-table">
		<thead>
			<tr>
				<th class="details-column" aria-label="Details"></th>
				<th class="when-column">When</th>
				<th class="who-column">Who</th>
				<th class="action-column">Action</th>
				<th>Summary</th>
			</tr>
		</thead>
		<tbody>
			{#each data.audit.entries as entry (entry.id)}
				{@const open = expanded.has(entry.id)}
				<tr>
					<td>
						<button
							type="button"
							aria-expanded={open}
							aria-label={open ? "Hide details" : "Show details"}
							onclick={() => toggle(entry.id)}
							class="expand"
							class:open
						>
							<Icon name="chevron-down" size={12} />
						</button>
					</td>
					<td>
						<div>{absoluteDate(entry.createdAt)}</div>
						<div class="relative">{relativeDate(entry.createdAt)}</div>
					</td>
					<td>{entry.actor.name}</td>
					<td class="mono">{entry.action}</td>
					<td>{entry.summary}</td>
				</tr>
				{#if open}
					<tr>
						<td colspan={5} class="details-cell">
							{@render changeDetails(entry)}
						</td>
					</tr>
				{/if}
			{:else}
				<EmptyRow columns={5}>
					<div class="empty-message">
						{filtered
							? "No audit entries match these filters"
							: "No audit entries yet"}
					</div>
					{#if filtered}
						<Button
							appearance="subtle"
							onclick={() =>
								setFilters({
									actor: "",
									action: "",
									entityType: "",
									from: "",
									to: "",
									query: "",
								})}
						>
							Clear filters
						</Button>
					{/if}
				</EmptyRow>
			{/each}
		</tbody>
	</table>

	<div class="pager-row">
		<span class="range">{start}–{end} of {total}</span>
		<div class="pager-buttons">
			<button
				type="button"
				class="pager"
				disabled={data.offset === 0}
				onclick={() =>
					setFilters({}, Math.max(0, data.offset - pageSize))}
			>
				Previous
			</button>
			<button
				type="button"
				class="pager"
				disabled={end >= total}
				onclick={() => setFilters({}, data.offset + pageSize)}
			>
				Next
			</button>
		</div>
	</div>
</AdminPage>

<style>
	.filters {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 12px;
		align-items: end;
		margin-bottom: 16px;
		padding: 12px;
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		background-color: var(--ds-surface-sunken);
	}

	.filter {
		min-width: 0;
	}

	.filter-label {
		display: block;
		margin-bottom: 4px;
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle);
	}

	.clear-row {
		grid-column: 1 / -1;
	}

	.audit-table {
		width: 100%;
	}

	.details-column {
		width: 32px;
	}

	.when-column {
		width: 200px;
	}

	.who-column {
		width: 170px;
	}

	.action-column {
		width: 220px;
	}

	.expand {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text-subtle);
		cursor: pointer;
		transform: rotate(-90deg);
	}

	.expand.open {
		transform: none;
	}

	.relative {
		font-size: 12px;
		color: var(--ds-text-subtle);
	}

	.mono {
		font-family: monospace;
	}

	.details-cell {
		padding: 0;
	}

	.change-details {
		padding: 8px 12px 12px 36px;
		background-color: var(--ds-surface-sunken);
	}

	.entity-line {
		margin-bottom: 8px;
		font-size: 12px;
		color: var(--ds-text-subtle);
	}

	.no-fields {
		color: var(--ds-text-subtle);
	}

	.changes-grid {
		display: grid;
		grid-template-columns: 160px 1fr 1fr;
		gap: 6px 16px;
		max-width: 960px;
	}

	.detail-label {
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle);
		overflow-wrap: anywhere;
	}

	.detail-value {
		font-size: 13px;
		color: var(--ds-text);
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}

	.empty-message {
		margin-bottom: 0;
	}

	.pager-row {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 12px;
	}

	.range {
		color: var(--ds-text-subtle);
	}

	.pager-buttons {
		margin-left: auto;
		display: flex;
		gap: 8px;
	}

	.pager {
		height: 28px;
		padding: 0 10px;
		background-color: var(--ds-background-neutral);
		color: var(--ds-text);
		border: 0;
		border-radius: 3px;
		cursor: pointer;
		font-size: 13px;
	}

	.pager:disabled {
		opacity: 0.5;
	}
</style>
