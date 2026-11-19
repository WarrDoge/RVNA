<script lang="ts">
	import BoardShell from "#lib/boards/BoardShell.svelte";
	import MissingBoard from "#lib/boards/MissingBoard.svelte";
	import ReleaseMeta from "#lib/boards/ReleaseMeta.svelte";
	import ReleaseProgressBar from "#lib/boards/ReleaseProgressBar.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();
</script>

{#if data.missing || !data.board || !data.sidebar}
	<MissingBoard />
{:else}
	<BoardShell board={data.board} sidebar={data.sidebar} active="releases">
		<div class="releases">
			<div class="board-name">{data.board.name}</div>
			<h1>Releases</h1>
			{#if !data.board.project}
				<p class="muted">
					This board has no project. Releases are grouped by project.
				</p>
			{/if}
			{#if data.releasesError}
				<p class="alert" role="alert">{data.releasesError}</p>
			{/if}
			{#if data.releases}
				{@const releases = data.releases}
				<p class="summary">
					{releases.project.name} · {releases.versions.length}
					{releases.versions.length === 1 ? "version" : "versions"}
				</p>
				{#if releases.versions.length === 0}
					<div class="empty-card">
						No fix versions in this project yet.
					</div>
				{:else}
					<table class="fat-table">
						<thead>
							<tr>
								<th class="head">Version</th>
								<th class="head">Status</th>
								<th class="head">Progress</th>
								<th class="head">Issues</th>
							</tr>
						</thead>
						<tbody>
							{#each releases.versions as version (version.id)}
								<tr>
									<td class="cell">
										<a
											class="version-link"
											href={`/projects/${releases.project.key}/versions/${version.id}`}
										>
											{version.name}
										</a>
										{#if version.description}
											<div class="description">{version.description}</div>
										{/if}
									</td>
									<td class="cell">
										<ReleaseMeta {version} />
									</td>
									<td class="cell">
										<div class="progress">
											<ReleaseProgressBar
												counts={version.counts}
												total={version.total}
											/>
											<div class="counts">
												{version.counts.done} done · {version.counts.indeterminate}
												in progress · {version.counts.new} to do
											</div>
										</div>
									</td>
									<td class="cell">{version.total}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			{/if}
		</div>
	</BoardShell>
{/if}

<style>
	.releases {
		flex: 1;
		min-width: 0;
		padding: 20px 24px 40px;
	}

	.board-name {
		font-size: 12px;
		color: var(--ds-text-subtle, #a9abaf);
	}

	h1 {
		margin: 0 0 16px;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text, #cecfd2);
	}

	.summary {
		margin-top: 0;
		color: var(--ds-text-subtle, #a9abaf);
	}

	.muted {
		color: var(--ds-text-subtle, #a9abaf);
	}

	.alert {
		color: var(--ds-text-danger, #fd9891);
	}

	.empty-card {
		padding: 16px;
		background-color: var(--ds-surface-raised, #22272b);
		border: 1px solid var(--ds-border, #3b3d42);
		border-radius: 3px;
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

	.version-link {
		color: var(--ds-link, #669df1);
		font-weight: 500;
	}

	.description {
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 12px;
	}

	.progress {
		min-width: 180px;
	}

	.counts {
		margin-top: 4px;
		font-size: 11px;
		color: var(--ds-text-subtle, #a9abaf);
	}
</style>
