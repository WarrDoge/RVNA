<script lang="ts">
	import type { BacklogPageData } from "./types.ts";
	import EpicPanelRow from "./EpicPanelRow.svelte";

	type BacklogState = Omit<BacklogPageData, "sprintPermissions">;

	interface Props {
		data: BacklogState;
		epic: string | null;
		version: string | null;
		onEpic: (key: string | null) => void;
		onVersion: (id: string | null) => void;
		onEpicDrop: (epicKey: string, keys: string[]) => void;
	}

	let { data, epic, version, onEpic, onVersion, onEpicDrop }: Props =
		$props();
</script>

<aside class="backlog-panels">
	<div class="panel-heading">EPICS</div>
	{#each data.epics as item (item.key)}
		<EpicPanelRow
			epic={item}
			active={epic === item.key}
			onClick={() => onEpic(epic === item.key ? null : item.key)}
			onDrop={onEpicDrop}
		/>
	{/each}
	{#if data.epics.length === 0}
		<div class="empty">No epics</div>
	{/if}

	<div class="panel-heading versions">VERSIONS</div>
	{#each data.versions as item (item.id)}
		<button
			type="button"
			class="version"
			class:active={version === item.id}
			aria-pressed={version === item.id}
			onclick={() => onVersion(version === item.id ? null : item.id)}
		>
			<span class="version-name">{item.name}</span>
			<span class="version-count">{item.issueCount}</span>
		</button>
	{/each}
	{#if data.versions.length === 0}
		<div class="empty">No versions</div>
	{/if}
</aside>

<style>
	.backlog-panels {
		width: 260px;
		flex: none;
		border-left: 1px solid var(--ds-border);
		padding: 10px 12px;
		overflow: auto;
		background-color: var(--ds-surface-sunken);
	}

	.panel-heading {
		margin-bottom: 6px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.4px;
		color: var(--ds-text-subtle);
	}

	.panel-heading.versions {
		margin: 16px 0 6px;
	}

	.empty {
		font-size: 12px;
		color: var(--ds-text-subtlest);
	}

	.version {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 4px 6px;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text);
		font-size: 13px;
		text-align: left;
		cursor: pointer;
	}

	.version.active {
		background-color: var(--ds-background-selected);
	}

	.version-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.version-count {
		color: var(--ds-text-subtle);
	}
</style>
