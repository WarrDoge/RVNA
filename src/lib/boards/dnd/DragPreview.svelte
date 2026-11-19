<script lang="ts">
	import type {
		BoardIssue,
		CardColourStrategy,
		EstimationField,
	} from "#lib/api-types.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import IssueTypeIcon from "#lib/components/IssueTypeIcon.svelte";
	import PriorityIcon from "#lib/components/PriorityIcon.svelte";
	import { cardBackground, estimateLabel } from "./board-dnd.ts";
	import EpicLozenge from "./EpicLozenge.svelte";
	import FlagIcon from "./FlagIcon.svelte";

	interface Props {
		issue: BoardIssue;
		estimationField: EstimationField;
		cardColourStrategy?: CardColourStrategy;
	}

	let { issue, estimationField, cardColourStrategy = "none" }: Props = $props();

	let background = $derived(cardBackground(issue, cardColourStrategy));
	let estimate = $derived(estimateLabel(issue.estimate, estimationField));
	let done = $derived(issue.status.category === "done");
</script>

<div
	class="drag-preview"
	class:done
	style="--drag-preview-bg: {background};"
>
	<div class="preview-top">
		{#if issue.flagged}<FlagIcon />{/if}
		<span class="preview-key">{issue.key}</span>
		{#if issue.assignee}
			<span class="preview-avatar"><Avatar user={issue.assignee} size={24} /></span>
		{/if}
	</div>
	<div class="preview-summary">{issue.summary}</div>
	{#if issue.epic}
		<div class="preview-epic"><EpicLozenge epic={issue.epic} /></div>
	{/if}
	<div class="preview-footer">
		<IssueTypeIcon
			id={issue.type.id}
			name={issue.type.name}
			icon={issue.type.iconUrl}
		/>
		{#if issue.priority}<PriorityIcon name={issue.priority.name} />{/if}
		{#if estimate !== ""}
			<span class="preview-estimate">{estimate}</span>
		{/if}
	</div>
</div>

<style>
	.drag-preview {
		width: 260px;
		padding: 8px 10px;
		background-color: var(--drag-preview-bg);
		border: 1px solid var(--ds-border-selected, #669df1);
		border-radius: 2px;
		box-shadow: var(--ds-shadow-overlay, 0 8px 12px #0104045c);
		color: var(--ds-text, #cecfd2);
	}

	.preview-top {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 24px;
	}

	.preview-key {
		font-size: 12px;
		font-weight: 600;
		line-height: 16px;
		color: var(--ds-text-subtle, #a9abaf);
	}

	.drag-preview.done .preview-key {
		color: var(--ds-text-subtlest, #7a7d82);
		text-decoration: line-through;
	}

	.preview-avatar {
		margin-left: auto;
	}

	.preview-summary {
		margin-top: 4px;
		font-size: 14px;
		line-height: 20px;
		display: -webkit-box;
		line-clamp: 3;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: anywhere;
	}

	.drag-preview.done .preview-summary {
		color: var(--ds-text-subtlest, #7a7d82);
		text-decoration: line-through;
	}

	.preview-epic {
		margin-top: 6px;
	}

	.preview-footer {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 6px;
		min-height: 16px;
	}

	.preview-estimate {
		margin-left: auto;
		padding: 0 5px;
		border-radius: 3px;
		background-color: var(--ds-background-neutral, #2c2e33);
		font-size: 11px;
		font-weight: 600;
		line-height: 16px;
	}
</style>
