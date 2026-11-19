<script lang="ts">
	import { beforeNavigate, goto, invalidate } from "$app/navigation";
	import { navigating, page } from "$app/state";
	import { onMount } from "svelte";
	import { api } from "#lib/api.ts";
	import type { NavigatorPreferences } from "#lib/api-types.ts";
	import Icon from "#lib/components/Icon.svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import ShareLink from "#lib/components/ShareLink.svelte";
	import IssueTypeIcon from "#lib/components/IssueTypeIcon.svelte";
	import IssueDetailView from "#lib/issue/IssueDetailView.svelte";
	import IssueUnavailable from "#lib/issue/IssueUnavailable.svelte";
	import BasicMode from "#lib/jql/BasicMode.svelte";
	import JqlInput from "#lib/jql/JqlInput.svelte";
	import { jqlErrorText } from "#lib/jql/context.ts";
	import {
		basicToJql,
		emptyBasicQuery,
		jqlToBasic,
		parseJql,
		type BasicQuery,
	} from "#lib/shared/jql/index.ts";
	import { openCreateIssue } from "#lib/shell/CreateIssue.svelte";
	import { installShortcut } from "#lib/shell/shortcuts.ts";
	import ColumnsPicker from "./ColumnsPicker.svelte";
	import ExportMenu from "./ExportMenu.svelte";
	import IssueCell from "./IssueCell.svelte";
	import NavigatorSidebar from "./NavigatorSidebar.svelte";
	import Pager from "./Pager.svelte";
	import RowActions from "./RowActions.svelte";
	import SaveAsDialog from "./SaveAsDialog.svelte";
	import SaveFilterButton from "./SaveFilterButton.svelte";
	import {
		DEFAULT_JQL,
		columnHeader,
		columnJql,
		columnWidth,
		normalizeNavigatorColumns,
		shareUrl,
		sortState,
		withOrderBy,
		type StandardFilter,
	} from "./navigator.ts";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const SIDEBAR_KEY = "rvna.navigatorSidebar";

	let jqlDraft = $state<{ url: string; value: string } | null>(null);
	let columnsState = $state<{ filter: string; columns: string[] } | null>(null);
	let sidebarOpen = $state(true);
	let hydrated = $state(false);
	let mode = $state<"advanced" | "basic">("advanced");
	let editedBasic = $state<{ jql: string; query: BasicQuery } | null>(null);
	let runError = $state<string | null>(null);
	let saveAsOpen = $state(false);
	let shareResult = $state<{ url: string; copied: boolean } | null>(null);
	let pendingSelect = $state<{
		where: "first" | "last";
		startAt: number;
	} | null>(null);

	const ORDER_OPTIONS = new Set([
		"updated:desc",
		"updated:asc",
		"created:desc",
		"created:asc",
		"key:asc",
		"key:desc",
		"priority:desc",
		"status:asc",
		"assignee:asc",
	]);

	let filterId = $derived(data.filter?.id ?? "");
	let jqlInput = $derived(
		jqlDraft?.url === page.url.href ? jqlDraft.value : data.appliedJql,
	);
	let modified = $derived(
		Boolean(data.filter && data.appliedJql !== data.filter.jql),
	);
	let queryDirty = $derived(jqlInput !== data.appliedJql);
	let columns = $derived(
		columnsState && columnsState.filter === filterId
			? columnsState.columns
			: data.columns,
	);
	let issues = $derived(data.page.issues);
	let total = $derived(data.page.total);
	let order = $derived(sortState(data.appliedJql));
	let selectedIndex = $derived(
		data.selectedKey
			? issues.findIndex((issue) => issue.key === data.selectedKey)
			: -1,
	);
	let selectedKey = $derived(data.selectedKey ?? "");
	let basic = $derived(
		editedBasic && editedBasic.jql === data.appliedJql
			? editedBasic.query
			: (representationOf(data.appliedJql).query ?? emptyBasicQuery()),
	);
	let basicRepresentation = $derived(representationOf(jqlInput));
	let errorText = $derived(runError ?? data.searchError);
	let loading = $derived(navigating.to !== null);
	let navigation = $derived(
		data.view === "detail" && selectedIndex !== -1 && data.issueView
			? {
					position: data.startAt + selectedIndex + 1,
					total,
					onPrevious: () => move(-1),
					onNext: () => move(1),
				}
			: undefined,
	);
	let orderValue = $derived.by(() => {
		const first = order[0];
		return first
			? `${first.field.name.toLowerCase()}:${first.direction}`
			: "";
	});
	let orderLabel = $derived.by(() => {
		const first = order[0];
		return first ? `${first.field.name} (${first.direction})` : "";
	});

	function representationOf(value: string) {
		try {
			const representation = jqlToBasic(parseJql(value));
			if (representation.ok) {
				return { ok: true as const, query: representation.query, error: "" };
			}
			return { ok: false as const, query: null, error: representation.error };
		} catch {
			return {
				ok: false as const,
				query: null,
				error: "The query is not valid.",
			};
		}
	}

	onMount(() => {
		hydrated = true;
		sidebarOpen = window.localStorage.getItem(SIDEBAR_KEY) !== "0";
		if (page.url.searchParams.get("create") === "1") {
			openCreateIssue();
			const url = new URL(page.url.href);
			url.searchParams.delete("create");
			void goto(`${url.pathname}${url.search}`, {
				replace: true,
				reset: false,
			});
		}
	});

	beforeNavigate(() => {
		jqlDraft = null;
	});

	$effect(() => {
		if (mode === "basic" && !representationOf(data.appliedJql).ok) {
			mode = "advanced";
		}
	});

	$effect(() => {
		if (!pendingSelect) return;
		if (data.startAt !== pendingSelect.startAt) return;
		const issue =
			pendingSelect.where === "first" ? issues[0] : issues[issues.length - 1];
		if (!issue) {
			pendingSelect = null;
			return;
		}
		const pending = pendingSelect;
		pendingSelect = null;
		if (issue.key !== data.selectedKey) selectIssue(issue.key, pending.startAt);
	});

	$effect(() => {
		if (data.view !== "detail" || !data.page) return;
		return installShortcut((key) => {
			if (key === "j") move(1);
			if (key === "k") move(-1);
		});
	});

	function savePreferences(next: Partial<NavigatorPreferences>) {
		api<NavigatorPreferences>("/api/navigator/preferences", {
			method: "PUT",
			body: JSON.stringify(next),
		}).catch(() => undefined);
	}

	function refresh() {
		void invalidate("app:navigator");
	}

	function setJqlDraft(value: string) {
		jqlDraft = { url: page.url.href, value };
	}

	function navigateSearch(
		nextJql: string,
		options: {
			view?: "list" | "detail";
			startAt?: number;
			keepFilter?: boolean;
			selectedIssue?: string | null;
			replace?: boolean;
			recent?: boolean;
		} = {},
	) {
		const nextView = options.view ?? data.view;
		const nextStartAt = options.startAt ?? 0;
		const params = new URLSearchParams();
		if (options.recent) params.set("recent", "1");
		else params.set("jql", nextJql);
		if (options.keepFilter !== false && data.filter) {
			params.set("filter", data.filter.id);
		}
		params.set("view", nextView);
		if (nextStartAt > 0) params.set("startAt", String(nextStartAt));
		if (options.selectedIssue) {
			params.set("selectedIssue", options.selectedIssue);
		}
		void goto(`/issues/?${params.toString()}`, {
			replace: options.replace ?? false,
			reset: false,
		});
	}

	function go(
		nextJql: string,
		options: {
			view?: "list" | "detail";
			startAt?: number;
			keepFilter?: boolean;
			recent?: boolean;
		} = {},
	) {
		if (nextJql === "") jqlDraft = null;
		else setJqlDraft(nextJql);
		runError = null;
		pendingSelect = null;
		navigateSearch(nextJql, options);
	}

	function setView(nextView: "list" | "detail") {
		savePreferences({ view: nextView });
		navigateSearch(data.appliedJql, {
			view: nextView,
			startAt: data.startAt,
			selectedIssue: nextView === "detail" ? data.selectedKey : undefined,
		});
	}

	function selectIssue(key: string, at = data.startAt) {
		if (page.url.pathname.startsWith("/browse/")) {
			const params = new URLSearchParams();
			params.set("jql", data.appliedJql);
			if (at > 0) params.set("startAt", String(at));
			void goto(`/browse/${encodeURIComponent(key)}?${params.toString()}`, {
				replace: true,
				reset: false,
			});
			return;
		}
		navigateSearch(data.appliedJql, {
			view: "detail",
			startAt: at,
			selectedIssue: key,
			replace: true,
		});
	}

	function move(delta: number) {
		if (issues.length === 0) return;
		const pageSize = data.page.maxResults;
		const current = selectedIndex === -1 ? 0 : selectedIndex;
		const next = current + delta;
		if (next < 0) {
			if (data.startAt === 0) return;
			const nextStart = Math.max(0, data.startAt - pageSize);
			pendingSelect = { where: "last", startAt: nextStart };
			navigateSearch(data.appliedJql, {
				view: "detail",
				startAt: nextStart,
				replace: true,
			});
			return;
		}
		if (next >= issues.length) {
			if (data.startAt + pageSize >= total) return;
			const nextStart = data.startAt + pageSize;
			pendingSelect = { where: "first", startAt: nextStart };
			navigateSearch(data.appliedJql, {
				view: "detail",
				startAt: nextStart,
				replace: true,
			});
			return;
		}
		const issue = issues[next];
		if (issue) selectIssue(issue.key);
	}

	function switchToBasic() {
		if (!basicRepresentation.ok || !basicRepresentation.query) return;
		editedBasic = { jql: data.appliedJql, query: basicRepresentation.query };
		mode = "basic";
	}

	function runBasic(next: BasicQuery) {
		editedBasic = { jql: data.appliedJql, query: next };
		go(basicToJql(next, sortState(data.appliedJql)));
	}

	function runSearch() {
		runError = null;
		if (mode === "basic") {
			go(basicToJql(basic, sortState(data.appliedJql)));
			return;
		}
		const message = jqlErrorText(jqlInput);
		if (message) {
			runError = message;
			return;
		}
		go(jqlInput);
	}

	function runStandard(filter: StandardFilter) {
		if (filter.recent) {
			go("", { keepFilter: false, recent: true });
			return;
		}
		if (filter.jql) go(filter.jql, { keepFilter: false });
	}

	function changeColumns(next: string[]) {
		const columns = normalizeNavigatorColumns(next, data.customFields);
		columnsState = { filter: filterId, columns };
		savePreferences({ columns });
	}

	function toggleSort(column: string) {
		const field = columnJql(column, data.customFields);
		if (field === "") return;
		const current = order.find(
			(item) => item.field.name.toLowerCase() === field.toLowerCase(),
		);
		const direction = current?.direction === "asc" ? "desc" : "asc";
		const next = withOrderBy(data.appliedJql, field, direction);
		setJqlDraft(next);
		navigateSearch(next);
	}

	function toggleSidebar() {
		sidebarOpen = !sidebarOpen;
		window.localStorage.setItem(SIDEBAR_KEY, sidebarOpen ? "1" : "0");
	}

	function newSearch() {
		go(DEFAULT_JQL, { keepFilter: false });
	}

	async function share() {
		const url = shareUrl(window.location.origin, {
			filterId: data.filter && !modified ? data.filter.id : null,
			jql: data.appliedJql,
			selectedIssue: data.selectedKey,
			view: data.view,
			startAt: data.startAt,
		});
		try {
			await window.navigator.clipboard.writeText(url);
			shareResult = { url, copied: true };
		} catch {
			shareResult = { url, copied: false };
		}
		window.setTimeout(() => (shareResult = null), 4000);
	}

	function onSaved(created: { id: string }) {
		saveAsOpen = false;
		void goto(`/issues/?filter=${created.id}`);
	}

	function changeOrder(value: string) {
		if (value === "") return;
		const [field, direction] = value.split(":");
		if (!field) return;
		const next = withOrderBy(
			data.appliedJql,
			field,
			direction === "desc" ? "desc" : "asc",
		);
		setJqlDraft(next);
		navigateSearch(next, {
			view: "detail",
			startAt: data.startAt,
			selectedIssue: data.selectedKey ?? undefined,
		});
	}
</script>

<PageTitle title="Issue Navigator" />

<div class="navigator" data-hydrated={hydrated}>
	<NavigatorSidebar
		open={sidebarOpen}
		activeFilterId={filterId}
		favourites={data.favourites}
		onToggle={toggleSidebar}
		onNewSearch={newSearch}
		onRun={runStandard}
	/>

	<div class="content">
		<div class="header">
			<h1 class="title">
				{data.filter
					? modified
						? `${data.filter.name} (modified)`
						: data.filter.name
					: "Search"}
			</h1>
			<button
				type="button"
				onclick={() => (saveAsOpen = true)}
				disabled={queryDirty}
				title={queryDirty ? "Search before saving the new query" : undefined}
				class="header-button save-as"
			>
				Save as
			</button>
			{#if data.filter?.canEdit}
				<SaveFilterButton
					filter={data.filter}
					jql={data.appliedJql}
					{columns}
					disabled={queryDirty}
				/>
			{/if}
			<div class="header-right">
				<button
					type="button"
					onclick={() => void share()}
					class="header-button"
				>
					<Icon name="share" size={14} /> Share
				</button>
				<ExportMenu
					jql={data.appliedJql}
					{columns}
					customFields={data.customFields}
					name={data.filter?.name ?? "search"}
				/>
			</div>
		</div>

		{#if shareResult}
			<div class="share-row">
				<ShareLink url={shareResult.url} copied={shareResult.copied} />
			</div>
		{/if}

		<div class="search-row">
			{#if mode === "advanced"}
				<form
					id="jql-form"
					class="jql-form"
					method="GET"
					action="/issues/"
					data-sveltekit-reset="false"
					onsubmit={(event) => {
						event.preventDefault();
						runSearch();
					}}
				>
					{#if data.filter}
						<input type="hidden" name="filter" value={data.filter.id} />
					{/if}
					<input type="hidden" name="view" value={data.view} />
					<JqlInput
						name="jql"
						value={jqlInput}
						onChange={setJqlDraft}
						onSubmit={runSearch}
						customFields={data.customFields}
						rejected={errorText !== null}
					/>
				</form>
			{:else}
				<div class="basic-wrap">
					{#key data.appliedJql}
						<BasicMode
							query={basic}
							projects={data.projects}
							onChange={(next) =>
								(editedBasic = { jql: data.appliedJql, query: next })}
							onRun={runBasic}
						/>
					{/key}
				</div>
			{/if}
			<div class="modes">
				<button
					type="button"
					aria-pressed={mode === "basic"}
					disabled={!basicRepresentation.ok && mode !== "basic"}
					title={basicRepresentation.ok
						? "Build the query with pickers"
						: `Basic mode cannot show this query: ${basicRepresentation.error}`}
					onclick={switchToBasic}
					class="mode-button"
					class:active={mode === "basic"}
				>
					Basic
				</button>
				<button
					type="button"
					aria-pressed={mode === "advanced"}
					title="Write a JQL-compatible query"
					onclick={() => (mode = "advanced")}
					class="mode-button"
					class:active={mode === "advanced"}
				>
					Advanced
				</button>
			</div>
			{#if mode === "advanced"}
				<button type="submit" form="jql-form" class="primary-button">
					Search
				</button>
			{:else}
				<button type="button" onclick={runSearch} class="primary-button">
					Search
				</button>
			{/if}
			<div class="views">
				<button
					type="button"
					aria-label="List view"
					aria-pressed={data.view === "list"}
					title="List view"
					onclick={() => setView("list")}
					class="view-button"
					class:active={data.view === "list"}
				>
					<Icon name="list-view" size={14} />
				</button>
				<button
					type="button"
					aria-label="Detail view"
					aria-pressed={data.view === "detail"}
					title="Detail view"
					onclick={() => setView("detail")}
					class="view-button"
					class:active={data.view === "detail"}
				>
					<Icon name="detail-view" size={14} />
				</button>
			</div>
		</div>

		{#if errorText}
			<p class="error" role="alert">{errorText}</p>
		{/if}

		{#if data.view === "list"}
			<div class="list">
				<div class="list-header">
					<span class="count"
						>{loading
							? "Loading…"
							: `${total} ${total === 1 ? "issue" : "issues"}`}</span
					>
					<div class="columns-picker">
						<ColumnsPicker
							{columns}
							customFields={data.customFields}
							onChange={changeColumns}
						/>
					</div>
				</div>

				<div class="table-scroll">
					<table class="fat-table fat-issue-table">
						<thead>
							<tr>
								{#each columns as column (column)}
									{@const field = columnJql(column, data.customFields)}
									{@const sorted = order.find(
										(item) =>
											item.field.name.toLowerCase() === field.toLowerCase(),
									)}
									<th
										class={column === "summary" ? "fat-col-fill" : undefined}
										aria-sort={sorted
											? sorted.direction === "asc"
												? "ascending"
												: "descending"
											: undefined}
										style={columnWidth(column) === undefined
											? undefined
											: `width: ${columnWidth(column)}px`}
									>
										<button
											type="button"
											onclick={() => toggleSort(column)}
											class="sort-button"
											style:cursor={field === "" ? "default" : "pointer"}
										>
											{columnHeader(column, data.customFields)}
											{#if sorted}
												<span aria-hidden="true">
													{sorted.direction === "asc" ? "↑" : "↓"}
												</span>
											{/if}
										</button>
									</th>
								{/each}
								<th class="actions-header" aria-label="Actions"></th>
							</tr>
						</thead>
						<tbody>
							{#each issues as issue (issue.id)}
								<tr>
									{#each columns as column (column)}
										<td class={column === "summary" ? "fat-col-fill" : undefined}>
											<IssueCell
												{issue}
												{column}
												customFields={data.customFields}
											/>
										</td>
									{/each}
									<td>
										<RowActions
											{issue}
											isAdmin={data.me.isAdmin}
											onChanged={refresh}
										/>
									</td>
								</tr>
							{/each}
							{#if issues.length === 0}
								<tr>
									<td colspan={columns.length + 1} class="subtle">
										No issues match this query.
									</td>
								</tr>
							{/if}
						</tbody>
					</table>
				</div>

				<Pager
					startAt={data.startAt}
					pageSize={data.page.maxResults}
					{total}
					onChange={(next) =>
						navigateSearch(data.appliedJql, { view: "list", startAt: next })}
				/>
			</div>
		{:else}
			<div class="detail">
				<div class="detail-list">
					<div class="order">
						<select
							aria-label="Order by"
							bind:value={() => orderValue, (value) => changeOrder(value)}
							class="order-select"
						>
							<option value="">Order by…</option>
							{#if orderValue !== "" && !ORDER_OPTIONS.has(orderValue)}
								<option value={orderValue}>{orderLabel}</option>
							{/if}
							<option value="updated:desc">Updated (newest first)</option>
							<option value="updated:asc">Updated (oldest first)</option>
							<option value="created:desc">Created (newest first)</option>
							<option value="created:asc">Created (oldest first)</option>
							<option value="key:asc">Key (ascending)</option>
							<option value="key:desc">Key (descending)</option>
							<option value="priority:desc">Priority (highest first)</option>
							<option value="status:asc">Status</option>
							<option value="assignee:asc">Assignee</option>
						</select>
					</div>
					<div class="detail-scroll">
						{#each issues as issue (issue.id)}
							<button
								type="button"
								onclick={() => selectIssue(issue.key)}
								class="detail-item"
								class:selected={issue.key === selectedKey}
								aria-current={issue.key === selectedKey ? "true" : undefined}
							>
								<span class="detail-type">
									<IssueTypeIcon
										id={issue.type.id}
										name={issue.type.name}
										icon={issue.type.iconUrl}
										size={12}
									/>
								</span>
								<span class="detail-text">
									<span class="detail-key">{issue.key}</span>
									<span class="detail-summary">{issue.summary}</span>
								</span>
							</button>
						{/each}
					</div>
					<Pager
						startAt={data.startAt}
						pageSize={data.page.maxResults}
						{total}
						compact
						onChange={(next) => {
							pendingSelect = null;
							navigateSearch(data.appliedJql, {
								view: "detail",
								startAt: next,
							});
						}}
					/>
				</div>

				<div class="detail-pane">
					{#if data.issueView}
						{#key data.issueView.issue.key}
							<IssueDetailView
								view={data.issueView}
								embedded
								{navigation}
							/>
						{/key}
					{:else if data.selectedKey}
						<IssueUnavailable />
					{:else}
						<p class="select-hint">Select an issue from the list.</p>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	{#if saveAsOpen}
		<SaveAsDialog
			jql={data.appliedJql}
			{columns}
			onClose={() => (saveAsOpen = false)}
			onSaved={onSaved}
		/>
	{/if}
</div>

<style>
	.navigator {
		display: flex;
		min-height: calc(100vh - 56px);
	}

	.content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 14px 24px 10px;
	}

	.title {
		margin: 0;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text, #cecfd2);
		white-space: nowrap;
	}

	.header-button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 10px;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 14px;
		cursor: pointer;
	}

	.save-as {
		margin-left: 8px;
	}

	.header-button:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.share-row {
		padding: 0 24px 8px;
	}

	.header-right {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.search-row {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		padding: 0 24px 8px;
	}

	.jql-form {
		display: contents;
		margin: 0;
	}

	.basic-wrap {
		flex: 1;
		min-width: 0;
	}

	.modes {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 2px;
		border: 1px solid var(--ds-border, #3b3d42);
		border-radius: 3px;
	}

	.mode-button {
		height: 24px;
		padding: 0 10px;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 13px;
		cursor: pointer;
	}

	.mode-button.active {
		background: var(--ds-background-selected, #1c2b42);
		color: var(--ds-text-selected, #669df1);
	}

	.mode-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.primary-button {
		height: 32px;
		padding: 0 12px;
		background-color: var(--ds-background-brand-bold, #1868db);
		color: var(--ds-text-inverse, #fff);
		border: 0;
		border-radius: 3px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
	}

	.views {
		display: flex;
		gap: 2px;
		margin-left: 4px;
		padding: 2px;
		border: 1px solid var(--ds-border, #3b3d42);
		border-radius: 3px;
	}

	.view-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 24px;
		padding: 0;
		background: transparent;
		color: var(--ds-text-subtle, #a9abaf);
		border: 0;
		border-radius: 3px;
		cursor: pointer;
	}

	.view-button.active {
		background: var(--ds-background-selected, #1c2b42);
		color: var(--ds-text-selected, #669df1);
	}

	.error {
		margin: 0 24px 8px;
		color: #e5493a;
		font-size: 13px;
	}

	.list {
		flex: 1;
		min-height: 0;
		padding: 0 24px 32px;
	}

	.list-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}

	.count {
		color: var(--ds-text-subtle, #a9abaf);
	}

	.columns-picker {
		margin-left: auto;
	}

	.table-scroll {
		overflow-x: auto;
	}

	table {
		width: 100%;
	}

	.sort-button {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 0;
		background: transparent;
		border: 0;
		color: inherit;
		font: inherit;
	}

	.actions-header {
		width: 32px;
	}

	.subtle {
		color: var(--ds-text-subtle, #a9abaf);
	}

	.detail {
		flex: 1;
		min-height: 0;
		display: flex;
	}

	.detail-list {
		width: 260px;
		flex: none;
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--ds-border, #3b3d42);
		background: var(--ds-surface-sunken, #1d2125);
	}

	.order {
		padding: 8px 10px;
	}

	.order-select {
		width: 100%;
		height: 30px;
		background: var(--ds-background-input, #ffffff);
		border: 1px solid var(--ds-border-input, #8c8f97);
		border-radius: 3px;
		color: var(--ds-text, #292a2e);
	}

	.detail-scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	.detail-item {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		width: 100%;
		padding: 6px 10px;
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--ds-border, #3b3d42);
		text-align: left;
		color: var(--ds-text, #cecfd2);
		cursor: pointer;
		font-size: 12px;
		line-height: 16px;
	}

	.detail-item.selected {
		background: var(--ds-background-selected, #1c2b42);
		color: var(--ds-text-selected, #669df1);
	}

	.detail-type {
		margin-top: 2px;
	}

	.detail-text {
		min-width: 0;
	}

	.detail-key {
		display: block;
		font-weight: 500;
	}

	.detail-summary {
		display: block;
		color: var(--ds-text-subtle, #a9abaf);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.detail-pane {
		flex: 1;
		min-width: 0;
		overflow-y: auto;
	}

	.select-hint {
		padding: 24px;
		color: var(--ds-text-subtle, #a9abaf);
	}
</style>
