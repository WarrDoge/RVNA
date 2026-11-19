<script lang="ts">
	import type { IssueDevelopment } from "#lib/api-types.ts";
	import Icon from "#lib/components/Icon.svelte";
	import type { IconName } from "#lib/components/icons.ts";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import Module from "#lib/components/Module.svelte";
	import { absoluteDate, relativeDate } from "#lib/dates.ts";
	import DevelopmentDialog from "./DevelopmentDialog.svelte";
	import type { DevelopmentRow } from "./development-dialog.ts";

	type DialogKind = "branches" | "commits" | "mergeRequests";

	interface Props {
		data: IssueDevelopment | null;
	}

	let { data }: Props = $props();

	let dialog = $state<DialogKind | null>(null);

	function plural(count: number, singular: string, pluralForm: string) {
		return `${count} ${count === 1 ? singular : pluralForm}`;
	}

	function lozengeAppearance(state: "OPEN" | "MERGED" | "DECLINED") {
		if (state === "OPEN") return "inprogress" as const;
		if (state === "MERGED") return "success" as const;
		return "default" as const;
	}

	function pipelineIcon(status: string): IconName {
		const known = [
			"success",
			"failed",
			"running",
			"pending",
			"canceled",
			"skipped",
			"manual",
		];
		return `pipeline-${known.includes(status) ? status : "skipped"}` as IconName;
	}

	function hasAnything(development: IssueDevelopment) {
		return (
			development.counts.branches > 0 ||
			development.counts.commits > 0 ||
			development.counts.mergeRequests > 0 ||
			development.latestPipeline !== null
		);
	}
</script>

{#if data && hasAnything(data)}
	<Module title="Development">
		<div class="rows">
			<button
				type="button"
				class="row"
				disabled={data.counts.branches === 0}
				onclick={() => (dialog = "branches")}
			>
				<span class="icon"><Icon name="branch" /></span>
				<span>{plural(data.counts.branches, "branch", "branches")}</span>
			</button>
			<div class="row-line">
				<button
					type="button"
					class="row"
					disabled={data.counts.commits === 0}
					onclick={() => (dialog = "commits")}
				>
					<span class="icon"><Icon name="commit" /></span>
					<span>{plural(data.counts.commits, "commit", "commits")}</span>
				</button>
				{#if data.latestPipeline}
					<span class="trailing">
						{#if data.latestPipeline.webUrl}
							<a
								href={data.latestPipeline.webUrl}
								target="_blank"
								rel="noopener noreferrer"
								title={`Pipeline ${data.latestPipeline.status}`}
								class="icon-link"
							>
								<Icon
									name={pipelineIcon(data.latestPipeline.status)}
								/>
							</a>
						{:else}
							<span class="icon-link">
								<Icon
									name={pipelineIcon(data.latestPipeline.status)}
								/>
							</span>
						{/if}
					</span>
				{/if}
			</div>
			<button
				type="button"
				class="row"
				disabled={data.counts.mergeRequests === 0}
				onclick={() => (dialog = "mergeRequests")}
			>
				<span class="icon"><Icon name="merge-request" /></span>
				<span>
					{plural(
						data.counts.mergeRequests,
						"merge request",
						"merge requests",
					)}
				</span>
				{#if data.mergeRequestState}
					<span class="trailing">
						<span class="fat-lozenge">
							<Lozenge appearance={lozengeAppearance(data.mergeRequestState)}>
								{data.mergeRequestState}
							</Lozenge>
						</span>
					</span>
				{/if}
			</button>

			{#if data.latestCommit?.committedAt}
				<div class="latest">
					Latest commit{" "}
					<span title={absoluteDate(data.latestCommit.committedAt)}>
						{relativeDate(data.latestCommit.committedAt)}
					</span>
				</div>
			{/if}

			{#if data.createBranch}
				<a
					href={data.createBranch.url}
					target="_blank"
					rel="noopener noreferrer"
					class="create-branch"
				>
					<Icon name="branch" size={12} />
					Create branch
				</a>
			{/if}
		</div>
	</Module>
{/if}

{#if data && dialog === "branches"}
	<DevelopmentDialog
		title="Branches"
		width={760}
		columns={["Repository", "Branch", "Updated"]}
		empty="No branches."
		rows={data.branches.map<DevelopmentRow>((branch) => ({
			id: branch.id,
			cells: [
				{ text: branch.repository.path },
				{ text: branch.name, href: branch.webUrl ?? undefined },
				{
					text: relativeDate(branch.updatedAt),
					title: absoluteDate(branch.updatedAt),
				},
			],
		}))}
		onClose={() => (dialog = null)}
	/>
{/if}

{#if data && dialog === "commits"}
	<DevelopmentDialog
		title="Commits"
		width={760}
		columns={["Repository", "Commit", "Author", "Updated"]}
		empty="No commits."
		rows={data.commits.map<DevelopmentRow>((commit) => ({
			id: commit.id,
			cells: [
				{ text: commit.repository.path },
				{ text: commit.title, href: commit.webUrl ?? undefined },
				{ text: commit.authorName ?? "Unknown" },
				{
					text: commit.committedAt
						? relativeDate(commit.committedAt)
						: "—",
					title: commit.committedAt
						? absoluteDate(commit.committedAt)
						: undefined,
				},
			],
		}))}
		onClose={() => (dialog = null)}
	/>
{/if}

{#if data && dialog === "mergeRequests"}
	<DevelopmentDialog
		title="Merge requests"
		width={820}
		columns={["Repository", "Merge request", "Author", "State", "Updated"]}
		empty="No merge requests."
		rows={data.mergeRequests.map<DevelopmentRow>((mergeRequest) => ({
			id: mergeRequest.id,
			cells: [
				{ text: mergeRequest.repository.path },
				{ text: mergeRequest.title, href: mergeRequest.webUrl ?? undefined },
				{ text: mergeRequest.authorName ?? "Unknown" },
				mergeRequest.lozenge
					? {
							text: mergeRequest.lozenge,
							lozenge: lozengeAppearance(mergeRequest.lozenge),
						}
					: { text: mergeRequest.state },
				{
					text: relativeDate(mergeRequest.updatedAt),
					title: absoluteDate(mergeRequest.updatedAt),
				},
			],
		}))}
		onClose={() => (dialog = null)}
	/>
{/if}

<style>
	.rows {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 4px 6px;
		margin-left: -6px;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text, #172b4d);
		font-size: 14px;
		line-height: 20px;
		text-align: left;
		cursor: pointer;
	}

	.row:disabled {
		cursor: default;
		color: var(--ds-text-subtle, #596773);
	}

	.row-line {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.row-line .row {
		flex: 1;
	}

	.icon {
		display: inline-flex;
		color: var(--ds-text-subtle, #596773);
	}

	.trailing {
		margin-left: auto;
		display: inline-flex;
		gap: 6px;
	}

	.icon-link {
		display: inline-flex;
	}

	.latest {
		color: var(--ds-text-subtle, #596773);
		font-size: 12px;
		padding-top: 4px;
	}

	.create-branch {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-top: 4px;
		color: var(--ds-link, #0c66e4);
		text-decoration: none;
		font-size: 12px;
	}
</style>
