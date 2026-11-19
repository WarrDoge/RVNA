<script lang="ts">
	import Button from "#lib/components/Button.svelte";
	import {
		attachmentUrl,
		formatDate,
		formatSize,
		isPreviewable,
	} from "#lib/wiki/format.ts";
	import type { Attachment } from "#lib/wiki/types.ts";

	interface Props {
		attachment: Attachment;
		pageSourceId: string;
		onPreview: (attachment: Attachment) => void;
		onDelete: (attachment: Attachment) => void;
	}

	let { attachment, pageSourceId, onPreview, onDelete }: Props = $props();

	let expanded = $state(false);
	let versions = $derived(attachment.versions ?? []);
</script>

<tr>
	<td>
		<div class="name-cell">
			<a
				href={attachmentUrl(
					pageSourceId,
					attachment.fileName,
					attachment.version,
				)}
			>
				{attachment.fileName}
			</a>
			{#if isPreviewable(attachment.mimeType)}
				<Button
					appearance="subtle"
					spacing="compact"
					onclick={() => onPreview(attachment)}
				>
					Preview
				</Button>
			{/if}
		</div>
	</td>
	<td>{formatSize(attachment.size)}</td>
	<td>{attachment.author?.displayName ?? "Unknown"}</td>
	<td>{formatDate(attachment.created)}</td>
	<td>
		{#if versions.length > 1}
			<button
				type="button"
				class="wiki-action"
				aria-expanded={expanded}
				onclick={() => (expanded = !expanded)}
			>
				{versions.length} versions
			</button>
		{:else}
			1 version
		{/if}
	</td>
	<td class="delete-cell">
		{#if attachment.canDelete}
			<Button
				appearance="subtle"
				spacing="compact"
				onclick={() => onDelete(attachment)}
			>
				Delete
			</Button>
		{/if}
	</td>
</tr>
{#if expanded}
	{#each versions as version (version.version)}
		<tr class="version-row">
			<td class="version-name">
				<a
					href={attachmentUrl(
						pageSourceId,
						attachment.fileName,
						version.version,
					)}
				>
					Version {version.version}
				</a>
			</td>
			<td>{formatSize(version.size)}</td>
			<td>{version.author?.displayName ?? "Unknown"}</td>
			<td>{formatDate(version.created)}</td>
			<td></td>
			<td></td>
		</tr>
	{/each}
{/if}

<style>
	.name-cell {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.delete-cell {
		text-align: right;
	}

	.version-row {
		background: var(--ds-background-neutral);
	}

	.version-name {
		padding-left: 32px;
	}
</style>
