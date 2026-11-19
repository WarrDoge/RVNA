<script lang="ts">
	import { untrack } from "svelte";
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import EmptyRow from "#lib/admin/EmptyRow.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import { dismiss } from "#lib/components/dismiss.ts";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import ProjectAvatar from "#lib/components/ProjectAvatar.svelte";
	import ArchiveDialog from "./ArchiveDialog.svelte";
	import DeleteProjectDialog from "./DeleteProjectDialog.svelte";
	import ProjectDialog from "./ProjectDialog.svelte";
	import type { PageData } from "./$types";
	import type { ProjectSummary, ProjectType } from "./types.ts";

	let { data }: { data: PageData } = $props();

	const typeLabels: Record<ProjectType, string> = {
		software: "Software",
		service_desk: "Service management",
	};

	const filters = [
		{ value: "active", label: "Active" },
		{ value: "archived", label: "Archived" },
		{ value: "all", label: "All" },
	] as const;

	type Filter = (typeof filters)[number]["value"];

	let creating = $state(false);
	let editing = $state<ProjectSummary | null>(null);
	let archiving = $state<ProjectSummary | null>(null);
	let deleting = $state<ProjectSummary | null>(null);
	let openMenu = $state<string | null>(null);
	let query = $state(untrack(() => data.query));
	let loadedQuery = untrack(() => data.query);
	$effect(() => {
		if (data.query === loadedQuery) return;
		loadedQuery = data.query;
		query = data.query;
	});

	let rows = $derived(data.projects);

	function filterHref(value: Filter) {
		return `?${new URLSearchParams({ query: data.query, filter: value })}`;
	}
</script>

{#snippet actions()}
	<Button appearance="primary" onclick={() => (creating = true)}>
		Create project
	</Button>
{/snippet}

<AdminPage
	title="Projects"
	description="Projects hold the issues of one team or one office area. Archived projects are read-only."
	{actions}
>
	<div class="filters">
		<form method="GET" class="search-form">
			<input type="hidden" name="filter" value={data.filter} />
			<input
				aria-label="Filter projects"
				name="query"
				placeholder="Filter projects"
				bind:value={query}
				style="{inputStyle} width: 280px;"
			/>
		</form>
		<fieldset class="filter-group">
			<legend class="visually-hidden">Show projects</legend>
			{#each filters as option (option.value)}
				<a
					href={filterHref(option.value)}
					aria-current={data.filter === option.value ? "page" : undefined}
					class:active={data.filter === option.value}
				>
					{option.label}
				</a>
			{/each}
		</fieldset>
		<span class="count">
			{rows.length}
			{rows.length === 1 ? "project" : "projects"}
		</span>
	</div>

	<table class="fat-table projects-table">
		<thead>
			<tr>
				<th>Name</th>
				<th class="key-column">Key</th>
				<th class="type-column">Type</th>
				<th class="lead-column">Lead</th>
				<th class="issues-column">Issues</th>
				<th class="status-column">Status</th>
				<th class="actions-column"><span class="visually-hidden">Actions</span></th>
			</tr>
		</thead>
		<tbody>
			{#if rows.length === 0}
				<EmptyRow columns={7}>
					{#if data.query === "" && data.filter === "active"}
						<p class="empty-message">No projects yet</p>
						<Button appearance="primary" onclick={() => (creating = true)}>
							Create project
						</Button>
					{:else}
						No projects match this filter.
					{/if}
				</EmptyRow>
			{/if}
			{#each rows as project (project.id)}
				<tr>
					<td>
						<span class="name-cell">
							<ProjectAvatar
								name={project.name}
								avatarUrl={project.avatarUrl}
								size={24}
							/>
							<a class="project-link" href={`/projects/${project.key}/issues`}>
								{project.name}
							</a>
						</span>
					</td>
					<td>{project.key}</td>
					<td>{typeLabels[project.type]}</td>
					<td>{project.lead?.displayName ?? "—"}</td>
					<td>{project.issueCount}</td>
					<td>
						{#if project.archived}
							<span class="fat-lozenge">
								<Lozenge appearance="default">Archived</Lozenge>
							</span>
						{/if}
					</td>
					<td>
						<div
							class="menu-container"
							{@attach dismiss(
								() => openMenu === project.id,
								() => (openMenu = null),
							)}
						>
							<button
								type="button"
								class="menu-trigger"
								aria-label={`Actions for ${project.name}`}
								aria-haspopup="menu"
								aria-expanded={openMenu === project.id}
								onclick={() =>
									(openMenu = openMenu === project.id ? null : project.id)}
							>
								•••
							</button>
							{#if openMenu === project.id}
								<div
									role="menu"
									aria-label={`Actions for ${project.name}`}
									class="menu"
								>
									<button
										type="button"
										role="menuitem"
										class="fat-menu-item"
										onclick={() => {
											openMenu = null;
											editing = project;
										}}
									>
										Edit project
									</button>
									<a
										role="menuitem"
										class="fat-menu-item"
										href={`/plugins/servlet/project-config/${project.key}/workflows`}
									>
										Workflows
									</a>
									<a
										role="menuitem"
										class="fat-menu-item"
										href={`/plugins/servlet/project-config/${project.key}/roles`}
									>
										Users and roles
									</a>
									<button
										type="button"
										role="menuitem"
										class="fat-menu-item"
										onclick={() => {
											openMenu = null;
											archiving = project;
										}}
									>
										{project.archived ? "Restore" : "Archive"}
									</button>
									<button
										type="button"
										role="menuitem"
										class="fat-menu-item"
										onclick={() => {
											openMenu = null;
											deleting = project;
										}}
									>
										Delete
									</button>
								</div>
							{/if}
						</div>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	{#if creating}
		<ProjectDialog
			project={null}
			projects={data.projects}
			me={data.me}
			onClose={() => (creating = false)}
		/>
	{/if}
	{#if editing}
		<ProjectDialog
			project={editing}
			projects={data.projects}
			me={data.me}
			onClose={() => (editing = null)}
		/>
	{/if}
	{#if archiving}
		<ArchiveDialog project={archiving} onClose={() => (archiving = null)} />
	{/if}
	{#if deleting}
		<DeleteProjectDialog
			project={deleting}
			onClose={() => (deleting = null)}
		/>
	{/if}
</AdminPage>

<style>
	.filters {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 12px;
		flex-wrap: wrap;
	}

	.filter-group {
		display: inline-flex;
		margin: 0;
		padding: 0;
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		overflow: hidden;
	}

	.filter-group a {
		height: 30px;
		padding: 0 12px;
		display: inline-flex;
		align-items: center;
		background: transparent;
		border: 0;
		color: var(--ds-text);
		cursor: pointer;
	}

	.filter-group a.active {
		background: var(--ds-background-selected);
		color: var(--ds-text-selected);
		font-weight: 600;
	}

	.search-form {
		margin: 0;
	}

	.count {
		color: var(--ds-text-subtle);
	}

	.projects-table {
		width: 100%;
	}

	.key-column {
		width: 110px;
	}

	.type-column,
	.lead-column {
		width: 170px;
	}

	.issues-column {
		width: 80px;
	}

	.status-column {
		width: 110px;
	}

	.actions-column {
		width: 48px;
	}

	.name-cell {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.project-link {
		color: var(--ds-link);
		font-weight: 500;
	}

	.empty-message {
		margin: 0 0 12px;
	}

	.menu-container {
		position: relative;
		display: inline-block;
	}

	.menu-trigger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text-subtle);
		cursor: pointer;
		font-size: 16px;
		line-height: 1;
	}

	.menu {
		position: absolute;
		top: 30px;
		right: 0;
		z-index: 100;
		min-width: 200px;
		padding-block: 4px;
		background-color: var(--ds-surface-overlay);
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		box-shadow: var(--ds-shadow-overlay);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
</style>
