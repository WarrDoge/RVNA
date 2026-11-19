<script lang="ts">
	import PageTitle from "#lib/components/PageTitle.svelte";
	import { formatDateOnly } from "#lib/dates.ts";
	import StatusLozenge from "#lib/issue-form/StatusLozenge.svelte";
	import ProjectFrame from "#lib/project/ProjectFrame.svelte";
	import ReleaseMeta from "#lib/boards/ReleaseMeta.svelte";
	import ReleaseProgressBar from "#lib/boards/ReleaseProgressBar.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let board = $derived(
		data.sidebar?.boards.find(
			(item) => item.project?.key === data.payload?.project.key,
		),
	);
</script>

<PageTitle title={data.payload?.version.name ?? "Version not found"} />

{#if !data.payload || !data.sidebar}
	<div class="not-found">
		<h1>Version not found</h1>
		<p>This version does not exist or belongs to another project.</p>
		<a href="/secure/BrowseProjects.jspa">View all projects</a>
	</div>
{:else}
	{@const version = data.payload.version}
	{@const project = data.payload.project}
	<ProjectFrame data={data.sidebar} active="releases" {board}>
		<div class="version-page">
			<div class="breadcrumb">
				<a
					href={board
						? `/secure/RapidBoard.jspa?rapidView=${board.rapidViewId}&view=releases`
						: `/projects/${project.key}/issues`}
				>
					Releases
				</a>
				/ {project.name}
			</div>
			<div class="title-row">
				<h1>{version.name}</h1>
				<ReleaseMeta {version} />
			</div>
			<div class="card">
				<div class="progress-header">
					<strong>{version.counts.done} of {version.total} issues done</strong>
					<span class="dates">
						{version.startDate
							? `Starts ${formatDateOnly(version.startDate)}`
							: "No start date"}
						{" · "}
						{version.releaseDate
							? `Releases ${formatDateOnly(version.releaseDate)}`
							: "No release date"}
					</span>
				</div>
				<ReleaseProgressBar
					counts={version.counts}
					total={version.total}
					height={12}
				/>
				<div class="counts">
					<span>{version.counts.done} done</span>
					<span>{version.counts.indeterminate} in progress</span>
					<span>{version.counts.new} to do</span>
				</div>
				{#if version.description}
					<p class="description">{version.description}</p>
				{/if}
			</div>
			<table class="fat-table">
				<thead>
					<tr>
						<th class="head">Key</th>
						<th class="head">Summary</th>
						<th class="head">Type</th>
						<th class="head">Status</th>
						<th class="head">Assignee</th>
					</tr>
				</thead>
				<tbody>
					{#if data.payload.issues.length === 0}
						<tr>
							<td class="cell empty" colspan={5}>
								No issues are assigned to this version.
							</td>
						</tr>
					{:else}
						{#each data.payload.issues as issue (issue.id)}
							<tr>
								<td class="cell">
									<a class="issue-link" href={`/browse/${issue.key}`}>
										{issue.key}
									</a>
								</td>
								<td class="cell">{issue.summary}</td>
								<td class="cell">{issue.typeName}</td>
								<td class="cell">
									<StatusLozenge status={issue.status} />
								</td>
								<td class="cell">{issue.assignee ?? "Unassigned"}</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>
	</ProjectFrame>
{/if}

<style>
	.not-found {
		padding: 24px 32px;
	}

	h1 {
		margin: 0 0 16px;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text, #cecfd2);
	}

	.not-found p {
		color: var(--ds-text-subtle, #a9abaf);
	}

	.not-found a {
		color: var(--ds-link, #669df1);
	}

	.version-page {
		flex: 1;
		min-width: 0;
		padding: 20px 24px 40px;
	}

	.breadcrumb {
		font-size: 12px;
		color: var(--ds-text-subtle, #a9abaf);
	}

	.breadcrumb a {
		color: var(--ds-link, #669df1);
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 16px;
		flex-wrap: wrap;
	}

	.title-row h1 {
		margin: 0;
	}

	.card {
		padding: 16px;
		margin-bottom: 20px;
		background-color: var(--ds-surface-raised, #22272b);
		border: 1px solid var(--ds-border, #3b3d42);
		border-radius: 3px;
	}

	.progress-header {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-bottom: 12px;
		flex-wrap: wrap;
	}

	.progress-header strong {
		font-size: 16px;
	}

	.dates {
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 13px;
	}

	.counts {
		display: flex;
		gap: 16px;
		margin-top: 8px;
		font-size: 12px;
		color: var(--ds-text-subtle, #a9abaf);
	}

	.description {
		margin-bottom: 0;
		color: var(--ds-text-subtle, #a9abaf);
	}

	table {
		width: 100%;
	}

	.head {
		padding: 8px 12px;
		text-align: left;
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle, #a9abaf);
		border-bottom: 1px solid var(--ds-border, #3b3d42);
		white-space: nowrap;
	}


	.cell {
		padding: 10px 12px;
		border-bottom: 1px solid var(--ds-border, #3b3d42);
		color: var(--ds-text, #cecfd2);
		vertical-align: middle;
	}

	.empty {
		color: var(--ds-text-subtle, #a9abaf);
	}

	.issue-link {
		color: var(--ds-link, #669df1);
		font-weight: 500;
		white-space: nowrap;
	}
</style>
