<script lang="ts">
	import { untrack } from "svelte";
	import type { ProjectGitlabSettings } from "#lib/api-types.ts";
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";
	import GitlabTransitionList from "./GitlabTransitionList.svelte";

	interface Props {
		projectKey: string;
		settings: ProjectGitlabSettings;
	}

	let { projectKey, settings }: Props = $props();

	// svelte-ignore state_referenced_locally
	let draft = $state<ProjectGitlabSettings>(settings);
	let saveError = $state<string | null>(null);
	let saved = $state(false);
	let pending = $state(false);
	let defaultRepositoryId = $state(
		untrack(() => draft.defaultRepositoryId),
	);

	$effect(() => {
		if (defaultRepositoryId !== draft.defaultRepositoryId) {
			update({ defaultRepositoryId });
		}
	});

	function update(patch: Partial<ProjectGitlabSettings>) {
		draft = { ...draft, ...patch };
		saved = false;
	}

	function toggleRepository(id: string, linked: boolean) {
		const linkedIds = linked
			? [...draft.linkedRepositoryIds, id]
			: draft.linkedRepositoryIds.filter((item) => item !== id);
		const nextDefault =
			draft.defaultRepositoryId === id && !linked
				? (linkedIds[0] ?? null)
				: draft.defaultRepositoryId;
		defaultRepositoryId = nextDefault;
		update({
			linkedRepositoryIds: linkedIds,
			defaultRepositoryId: nextDefault,
		});
	}

	async function save() {
		pending = true;
		saveError = null;
		try {
			draft = await api<ProjectGitlabSettings>(
				`/api/projects/${encodeURIComponent(projectKey)}/gitlab`,
				{
					method: "PATCH",
					body: JSON.stringify({
						linkedRepositoryIds: draft.linkedRepositoryIds,
						defaultRepositoryId: draft.defaultRepositoryId,
						smartCommitsEnabled: draft.smartCommitsEnabled,
						mergeRequestOpenedEnabled: draft.mergeRequestOpenedEnabled,
						mergeRequestOpenedTransitions: draft.mergeRequestOpenedTransitions,
						mergeRequestMergedEnabled: draft.mergeRequestMergedEnabled,
						mergeRequestMergedTransitions: draft.mergeRequestMergedTransitions,
					}),
				},
			);
			saved = true;
		} catch (cause) {
			saveError =
				cause instanceof Error ? cause.message : "Something went wrong";
		} finally {
			pending = false;
		}
	}
</script>

<section class="section">
		<h2>GitLab</h2>
		<p class="hint">
			Link repositories to this project so the Development panel can offer a
			branch. Repositories appear here after their first webhook or back-fill.
		</p>
		{#if saveError}
			<p class="error" role="alert">{saveError}</p>
		{/if}

		<table class="fat-table repositories">
			<thead>
				<tr>
					<th>Repository</th>
					<th class="linked">Linked</th>
					<th class="linked">Default</th>
				</tr>
			</thead>
			<tbody>
				{#each draft.repositories as repository (repository.id)}
					{@const linked = draft.linkedRepositoryIds.includes(repository.id)}
					<tr>
						<td>
							<a
								class="link"
								href={repository.webUrl}
								target="_blank"
								rel="noopener noreferrer"
							>
								{repository.path}
							</a>
						</td>
						<td>
							<input
								type="checkbox"
								aria-label={`Link ${repository.path}`}
								bind:checked={() => linked, (value) =>
									toggleRepository(repository.id, value)}
							/>
						</td>
						<td>
							<input
								type="radio"
								name="gitlab-default-repository"
								aria-label={`Default ${repository.path}`}
								bind:group={defaultRepositoryId}
								value={repository.id}
								disabled={!linked}
							/>
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="3" class="muted">No repositories yet.</td>
					</tr>
				{/each}
			</tbody>
		</table>

		<div class="options">
			<label class="option">
				<input
					type="checkbox"
					bind:checked={() => draft.smartCommitsEnabled, (value) =>
						update({ smartCommitsEnabled: value })}
				/>
				<span>
					Smart commits
					<span class="option-hint">
						Apply #comment, #time and #transition commands in commit messages as
						the GitLab author.
					</span>
				</span>
			</label>

			<div>
				<label class="option-row">
					<input
						type="checkbox"
						bind:checked={() => draft.mergeRequestOpenedEnabled, (value) =>
							update({ mergeRequestOpenedEnabled: value })}
					/>
					<span>When a merge request opens, apply the first available:</span>
				</label>
				<div class="transition-block">
					<GitlabTransitionList
						names={draft.mergeRequestOpenedTransitions}
						available={draft.availableTransitions}
						disabled={!draft.mergeRequestOpenedEnabled}
						onChange={(names) => update({ mergeRequestOpenedTransitions: names })}
					/>
				</div>
			</div>

			<div>
				<label class="option-row">
					<input
						type="checkbox"
						bind:checked={() => draft.mergeRequestMergedEnabled, (value) =>
							update({ mergeRequestMergedEnabled: value })}
					/>
					<span>When a merge request merges, apply the first available:</span>
				</label>
				<div class="transition-block">
					<GitlabTransitionList
						names={draft.mergeRequestMergedTransitions}
						available={draft.availableTransitions}
						disabled={!draft.mergeRequestMergedEnabled}
						onChange={(names) => update({ mergeRequestMergedTransitions: names })}
					/>
				</div>
			</div>
		</div>

		<div class="save-row">
			<Button appearance="primary" isLoading={pending} onclick={save}>Save</Button>
			{#if saved}
				<span class="status">Saved</span>
			{/if}
		</div>
	</section>

<style>
	.section {
		margin-bottom: 32px;
	}

	h2 {
		margin: 0 0 12px;
		font-size: 20px;
		font-weight: 500;
	}

	.hint {
		margin: 0 0 12px;
		color: var(--ds-text-subtle);
		font-size: 12px;
		line-height: 18px;
	}

	.error {
		margin: 0 0 12px;
		color: #e5493a;
	}

	.repositories {
		width: 100%;
		margin-bottom: 16px;
	}

	.linked {
		width: 90px;
	}

	.link {
		color: var(--ds-link);
	}

	.muted {
		color: var(--ds-text-subtle);
	}

	.options {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.option {
		display: flex;
		gap: 8px;
		align-items: flex-start;
	}

	.option-row {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.option-hint {
		display: block;
		margin: 0;
		color: var(--ds-text-subtle);
		font-size: 12px;
		line-height: 18px;
	}

	.transition-block {
		margin-left: 24px;
		margin-top: 8px;
	}

	.save-row {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 16px;
	}

	.status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}
</style>
