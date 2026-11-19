<script lang="ts">
	import { untrack } from "svelte";
	import Icon from "#lib/components/Icon.svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import IssueTypeIcon from "#lib/components/IssueTypeIcon.svelte";
	import StatusLozenge from "#lib/issue-form/StatusLozenge.svelte";
	import { relativeDate } from "#lib/dates.ts";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let q = $state(untrack(() => data.q));
	let loadedQ = untrack(() => data.q);
	$effect(() => {
		if (data.q === loadedQ) return;
		loadedQ = data.q;
		q = data.q;
	});

	let issues = $derived(data.results?.issues);
	let pages = $derived(data.results?.pages);

	function searchUrl(q: string, tab: "issues" | "pages", startAt: number) {
		const params = new URLSearchParams();
		if (q !== "") params.set("q", q);
		if (tab === "pages") params.set("tab", "pages");
		if (startAt > 0) params.set("startAt", String(startAt));
		const query = params.toString();
		return query === "" ? "/search" : `/search?${query}`;
	}

</script>

<PageTitle title="Search" />

<section class="search">
	<h1>Search</h1>

	<form method="GET" action="/search">
		{#if data.tab === "pages"}
			<input type="hidden" name="tab" value="pages" />
		{/if}
		<span class="input-shell">
			<Icon name="search" size={14} />
			<input
				aria-label="Search all content"
				name="q"
				placeholder="Search issues and pages"
				bind:value={q}
			/>
		</span>
		<button type="submit" class="submit">Search</button>
	</form>

	{#if data.q === ""}
		<p class="muted">Type a word or an issue key to search issues and pages.</p>
	{:else}
		<nav class="tabs" aria-label="Search results">
			<a
				href={searchUrl(data.q, "issues", 0)}
				class:selected={data.tab === "issues"}
				aria-current={data.tab === "issues" ? "page" : undefined}
			>
				Issues ({issues?.total ?? 0})
			</a>
			<a
				href={searchUrl(data.q, "pages", 0)}
				class:selected={data.tab === "pages"}
				aria-current={data.tab === "pages" ? "page" : undefined}
			>
				Pages ({pages?.total ?? 0})
			</a>
		</nav>

		{#if data.error}
			<p class="error" role="alert">{data.error}</p>
		{/if}

		{#if data.tab === "issues" && issues}
			<table class="fat-table">
				<thead>
					<tr>
						<th class="type-column" aria-label="Type"></th>
						<th class="key-column">Key</th>
						<th>Summary</th>
						<th class="status-column">Status</th>
						<th class="updated-column">Updated</th>
					</tr>
				</thead>
				<tbody>
					{#each issues.items as issue (issue.id)}
						<tr>
							<td>
								<IssueTypeIcon name={issue.type.name} size={14} />
							</td>
							<td>
								<a class="link" href={`/browse/${issue.key}`}>{issue.key}</a>
							</td>
							<td>{issue.summary}</td>
							<td>
								<StatusLozenge status={issue.status} />
							</td>
							<td>{issue.updated ? relativeDate(issue.updated) : ""}</td>
						</tr>
					{:else}
						<tr>
							<td colspan="5" class="muted">No issues match this search.</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if issues.total > issues.maxResults}
				<div class="pager">
					<span>
						{issues.startAt + 1}–{issues.startAt + issues.items.length} of {issues.total}
					</span>
					{#if issues.startAt === 0}
						<span class="pager-button disabled">Previous</span>
					{:else}
						<a
							class="pager-button"
							href={searchUrl(
								data.q,
								data.tab,
								Math.max(0, issues.startAt - issues.maxResults),
							)}
						>
							Previous
						</a>
					{/if}
					{#if issues.startAt + issues.items.length >= issues.total}
						<span class="pager-button disabled">Next</span>
					{:else}
						<a
							class="pager-button"
							href={searchUrl(
								data.q,
								data.tab,
								issues.startAt + issues.maxResults,
							)}
						>
							Next
						</a>
					{/if}
				</div>
			{/if}
		{/if}

		{#if data.tab === "pages" && pages}
			<ul class="pages">
				{#each pages.items as page (page.id)}
					<li>
						<span class="page-title">{page.title}</span>
						<span class="page-space">{page.spaceName}</span>
					</li>
				{:else}
					<li class="muted">No pages match this search.</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>

<style>
	.search {
		padding: 24px 32px;
		max-width: 1100px;
	}

	h1 {
		margin: 0 0 16px;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text);
	}

	form {
		display: flex;
		gap: 8px;
		margin: 0 0 16px;
	}

	.input-shell {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		width: 420px;
		height: 32px;
		padding: 0 8px;
		background: var(--ds-background-input);
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text-subtle);
	}

	.input-shell input {
		flex: 1;
		background: transparent;
		border: 0;
		outline: none;
		color: var(--ds-text);
		font-size: 14px;
	}

	.submit {
		height: 32px;
		padding: 0 12px;
		background-color: var(--ds-background-brand-bold);
		color: var(--ds-text-inverse);
		border: 0;
		border-radius: 3px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
	}

	.tabs {
		display: flex;
		gap: 24px;
		border-bottom: 1px solid var(--ds-border);
		margin-bottom: 16px;
	}

	.tabs a {
		padding: 8px 0;
		margin-bottom: -1px;
		border-bottom: 2px solid transparent;
		color: var(--ds-text-subtle);
		font-size: 14px;
		font-weight: 400;
		text-decoration: none;
	}

	.tabs a.selected {
		border-bottom-color: var(--ds-border-selected);
		color: var(--ds-text);
		font-weight: 500;
	}

	.error {
		color: #e5493a;
	}

	.fat-table {
		width: 100%;
	}

	.type-column {
		width: 28px;
	}

	.key-column {
		width: 110px;
	}

	.status-column {
		width: 140px;
	}

	.updated-column {
		width: 130px;
	}

	.link {
		color: var(--ds-link);
		text-decoration: none;
	}

	.muted {
		color: var(--ds-text-subtle);
	}

	.pager {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-top: 8px;
		font-size: 13px;
		color: var(--ds-text-subtle);
	}

	.pager-button {
		display: inline-flex;
		align-items: center;
		height: 26px;
		padding: 0 8px;
		background: transparent;
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		color: var(--ds-text-subtle);
		cursor: pointer;
		font-size: 12px;
		text-decoration: none;
	}

	.pager-button.disabled {
		color: var(--ds-text-disabled);
		cursor: default;
	}

	.pages {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.pages li {
		padding: 6px 0;
	}

	.page-title {
		font-weight: 500;
	}

	.page-space {
		margin-left: 8px;
		color: var(--ds-text-subtle);
	}
</style>
