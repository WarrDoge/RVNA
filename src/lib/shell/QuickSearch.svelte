<script lang="ts">
	import { goto } from "$app/navigation";
	import { onMount } from "svelte";
	import type { QuickSearchResult } from "#lib/api-types.ts";
	import { api } from "#lib/api.ts";
	import Icon from "#lib/components/Icon.svelte";
	import IssueTypeIcon from "#lib/components/IssueTypeIcon.svelte";
	import ProjectAvatar from "#lib/components/ProjectAvatar.svelte";
	import { dismiss } from "#lib/components/dismiss.ts";
	import { resultPath } from "./quicksearch.ts";
	import { installShortcut } from "./shortcuts.ts";

	const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

	let query = $state("");
	let debounced = $state("");
	let open = $state(false);
	let active = $state(0);
	let results = $state<QuickSearchResult | null>(null);
	let pending = $state(false);
	let input: HTMLInputElement;

	let issues = $derived(results?.issues ?? []);
	let projects = $derived(results?.projects ?? []);
	let pages = $derived(results?.pages ?? []);
	let rows = $derived(issues.length + projects.length + pages.length);
	let activeId = $derived(
		open && rows > 0 ? `quicksearch-option-${Math.min(active, rows - 1)}` : undefined,
	);

	$effect(() => {
		const value = query.trim();
		const timer = window.setTimeout(() => {
			debounced = value;
		}, 150);
		return () => window.clearTimeout(timer);
	});

	$effect(() => {
		if (!open || debounced === "") {
			results = null;
			pending = false;
			return;
		}

		let cancelled = false;
		pending = true;
		api<QuickSearchResult>(
			`/api/quicksearch?q=${encodeURIComponent(debounced)}`,
		)
			.then((data) => {
				if (!cancelled) results = data;
			})
			.catch(() => {
				if (!cancelled) results = null;
			})
			.finally(() => {
				if (!cancelled) pending = false;
			});

		return () => {
			cancelled = true;
		};
	});

	onMount(() =>
		installShortcut((key) => {
			if (key !== "/") return;
			input?.focus();
			open = true;
		}),
	);

	function go(path: string) {
		open = false;
		input?.blur();
		void goto(path);
	}

	function submit() {
		if (open && rows > 0) {
			const path = resultPath(results, Math.min(active, rows - 1));
			if (path) {
				go(path);
				return;
			}
		}
		const value = query.trim();
		if (value === "") return;
		open = false;
		input?.blur();
		if (ISSUE_KEY.test(value)) {
			go(`/browse/${value.toUpperCase()}`);
			return;
		}
		go(
			`/issues/?jql=${encodeURIComponent(
				`text ~ "${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
			)}`,
		);
	}
</script>

<div
	class="quick-search"
	{@attach dismiss(() => open, () => (open = false))}
>
	<div class="field">
		<span class="search-icon"><Icon name="search" size={14} /></span>
		<input
			bind:this={input}
			type="text"
			placeholder="Search"
			aria-label="Search"
			role="combobox"
			aria-expanded={open}
			aria-controls="quicksearch-results"
			aria-activedescendant={activeId}
			bind:value={() => query, (value) => {
				query = value;
				open = true;
				active = 0;
			}}
			onfocus={() => {
				open = true;
			}}
			onkeydown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					submit();
				}
				if (event.key === "ArrowDown" && rows > 0) {
					event.preventDefault();
					active = (active + 1) % rows;
				}
				if (event.key === "ArrowUp" && rows > 0) {
					event.preventDefault();
					active = (active - 1 + rows) % rows;
				}
			}}
		/>
	</div>

	{#if open && debounced !== ""}
		<div
			id="quicksearch-results"
			role="listbox"
			aria-label="Search results"
			class="results"
		>
			{#if pending}
				<p class="notice">Searching…</p>
			{/if}
			{#if !pending && rows === 0}
				<p class="notice">No matching issues, projects or pages.</p>
			{/if}
			{#each issues as issue, index (issue.id)}
				<button
					id={`quicksearch-option-${index}`}
					type="button"
					role="option"
					aria-selected={index === active}
					class="fat-menu-item row"
					class:active={index === active}
					onmousedown={(event) => event.preventDefault()}
					onclick={() => go(`/browse/${issue.key}`)}
				>
					<IssueTypeIcon
						id={issue.type.id}
						name={issue.type.name}
						icon={issue.type.iconUrl}
						size={14}
					/>
					<span class="key">{issue.key}</span>
					<span class="summary">{issue.summary}</span>
				</button>
			{/each}
			{#each projects as project, index (project.key)}
				<button
					id={`quicksearch-option-${issues.length + index}`}
					type="button"
					role="option"
					aria-selected={issues.length + index === active}
					class="fat-menu-item row"
					class:active={issues.length + index === active}
					onmousedown={(event) => event.preventDefault()}
					onclick={() => go(`/projects/${project.key}/issues`)}
				>
					<ProjectAvatar
						name={project.name}
						avatarUrl={project.avatarUrl}
						size={16}
					/>
					<span class="name">{project.name}</span>
					<span class="project-key">{project.key}</span>
				</button>
			{/each}
			{#if pages.length > 0}
				<div role="presentation" class="heading">Pages</div>
				{#each pages as page, index (page.id)}
					<button
						id={`quicksearch-option-${issues.length + projects.length + index}`}
						type="button"
						role="option"
						aria-selected={issues.length + projects.length + index === active}
						class="fat-menu-item row"
						class:active={issues.length + projects.length + index === active}
						onmousedown={(event) => event.preventDefault()}
						onclick={() => go(`/pages/${page.id}`)}
					>
						<span class="name">{page.title}</span>
						<span class="project-key">{page.spaceName}</span>
					</button>
				{/each}
			{/if}
		</div>
	{/if}
</div>

<style>
	.quick-search {
		position: relative;
	}

	.field {
		position: relative;
		display: inline-flex;
		align-items: center;
		width: 200px;
		height: 28px;
	}

	.search-icon {
		position: absolute;
		left: 7px;
		display: inline-flex;
		color: var(--ds-text-subtle);
	}

	input {
		width: 100%;
		height: 28px;
		padding: 0 8px 0 26px;
		background: transparent;
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text);
		outline: none;
		font-size: 14px;
	}

	.results {
		position: absolute;
		right: 0;
		top: 34px;
		z-index: 150;
		width: 420px;
		padding-block: 4px;
		background-color: var(--ds-surface-overlay);
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		box-shadow: var(--ds-shadow-overlay);
	}

	.notice {
		margin: 0;
		padding: 6px 12px;
		color: var(--ds-text-subtle);
	}

	.heading {
		padding: 6px 12px 2px;
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle);
		text-transform: uppercase;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.row.active {
		background-color: var(--ds-background-neutral-subtle-hovered);
	}

	.key {
		color: var(--ds-text-subtle);
		width: 80px;
	}

	.summary {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.name {
		flex: 1;
	}

	.project-key {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}
</style>
