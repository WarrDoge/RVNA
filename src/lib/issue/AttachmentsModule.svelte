<script lang="ts">
	import type { Attachment, IssueDetail, Me } from "#lib/api-types.ts";
	import { api } from "#lib/api.ts";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import Icon from "#lib/components/Icon.svelte";
	import Module from "#lib/components/Module.svelte";
	import { formatBytes, relativeDate } from "#lib/dates.ts";
	import { isRasterImageType } from "#lib/shared/served-type.ts";
	import { errorMessage } from "./panels-format.ts";

	interface Props {
		issue: IssueDetail;
		me: Me | null;
		canAttach: boolean;
		canDeleteAll: boolean;
		canDeleteOwn: boolean;
		onBrowse: () => void;
		onFiles: (files: File[]) => void;
		onChanged: () => Promise<void>;
		onError: (message: string) => void;
		uploading: boolean;
		uploadError: string | null;
	}

	let {
		issue,
		me,
		canAttach,
		canDeleteAll,
		canDeleteOwn,
		onBrowse,
		onFiles,
		onChanged,
		onError,
		uploading,
		uploadError,
	}: Props = $props();

	let deleting = $state<Attachment | null>(null);
	let deletePending = $state(false);

	async function confirmDelete() {
		if (!deleting) return;
		deletePending = true;
		try {
			await api(`/api/attachments/${deleting.id}`, { method: "DELETE" });
			deleting = null;
			await onChanged();
		} catch (cause) {
			onError(errorMessage(cause));
		} finally {
			deletePending = false;
		}
	}
</script>

<Module title="Attachments">
	{#if canAttach}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="drop"
			ondragover={(event) => event.preventDefault()}
			ondrop={(event) => {
				event.preventDefault();
				onFiles(Array.from(event.dataTransfer?.files ?? []));
			}}
		>
			<span>Drop files to attach, or</span>
			<button type="button" class="link-button" onclick={onBrowse}>browse</button>
			<span>.</span>
		</div>
	{/if}
	{#if uploading}
		<p class="muted">Uploading…</p>
	{/if}
	{#if uploadError}
		<p class="error" role="alert">{uploadError}</p>
	{/if}
	{#if issue.attachments.length === 0}
		<p class="empty">No attachments.</p>
	{:else}
		<div class="attachments">
			{#each issue.attachments as attachment (attachment.id)}
				{@const image = isRasterImageType(attachment.mimeType)}
				{@const canDelete =
					canDeleteAll ||
					(canDeleteOwn && me?.id === attachment.author?.id)}
				<div class="row">
					{#if image}
						<a
							href={`/api/attachments/${attachment.id}`}
							target="_blank"
							rel="noreferrer"
							class="thumb"
						>
							<img
								src={`/api/attachments/${attachment.id}`}
								alt={attachment.fileName}
							/>
						</a>
					{:else}
						<span class="file-icon">
							<Icon name="attachment" />
						</span>
					{/if}
					<div class="details">
						<a
							href={`/api/attachments/${attachment.id}`}
							class="name"
						>
							{attachment.fileName}
						</a>
						<div class="meta">
							{formatBytes(attachment.size)}{attachment.author
								? ` · ${attachment.author.displayName}`
								: ""}{attachment.created
								? ` · ${relativeDate(attachment.created)}`
								: ""}
						</div>
					</div>
					{#if canDelete}
						<button
							type="button"
							aria-label={`Delete ${attachment.fileName}`}
							onclick={() => (deleting = attachment)}
							class="delete"
						>
							<Icon name="trash" size={14} />
						</button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</Module>

{#if deleting}
	<ConfirmDialog
		title="Delete attachment"
		message={`Delete "${deleting.fileName}"?`}
		pending={deletePending}
		onConfirm={confirmDelete}
		onClose={() => (deleting = null)}
	/>
{/if}

<style>
	.drop {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-height: 56px;
		margin-bottom: 12px;
		padding: 12px;
		border: 1px dashed var(--ds-border, #0b120e24);
		border-radius: 3px;
		color: var(--ds-text-subtle, #596773);
		font-size: 14px;
		text-align: center;
	}

	.link-button {
		color: var(--ds-link, #0c66e4);
		text-decoration: none;
		cursor: pointer;
		font-size: inherit;
	}

	.muted {
		color: var(--ds-text-subtle, #596773);
	}

	.error {
		color: #e5493a;
	}

	.empty {
		margin: 0;
		color: var(--ds-text-subtle, #596773);
	}

	.attachments {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 4px 0;
	}

	.thumb {
		display: inline-flex;
	}

	.thumb img {
		width: 80px;
		height: 60px;
		object-fit: cover;
		border-radius: 3px;
		border: 1px solid var(--ds-border, #0b120e24);
	}

	.file-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: 3px;
		background-color: var(--ds-background-neutral, #0515240f);
		color: var(--ds-text-subtle, #596773);
	}

	.details {
		min-width: 0;
		flex: 1;
	}

	.name {
		color: var(--ds-link, #0c66e4);
		text-decoration: none;
		font-weight: 500;
	}

	.meta {
		color: var(--ds-text-subtle, #596773);
		font-size: 12px;
	}

	.delete {
		display: inline-flex;
		padding: 4px;
		background: transparent;
		border: 0;
		color: var(--ds-text-subtle, #596773);
		cursor: pointer;
	}
</style>
