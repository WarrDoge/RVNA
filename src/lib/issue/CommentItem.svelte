<script lang="ts">
	import { absoluteDate, relativeDate } from "#lib/dates.ts";
	import { api } from "#lib/api.ts";
	import type { Comment } from "#lib/api-types.ts";
	import Button from "#lib/components/Button.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import UserLink from "#lib/components/UserLink.svelte";
	import { isEditorEmpty } from "#lib/editor/editor-html.ts";
	import RichTextEditor from "#lib/editor/RichTextEditor.svelte";
	import { errorMessage } from "./activity-utils.ts";
	import TimelineAvatar from "./TimelineAvatar.svelte";

	interface Props {
		comment: Comment;
		issueKey: string;
		canEdit: boolean;
		canDelete: boolean;
		onChanged: () => Promise<void> | void;
		onError: (message: string) => void;
	}

	let { comment, issueKey, canEdit, canDelete, onChanged, onError }: Props =
		$props();

	let editing = $state(false);
	let draft = $state("");
	let confirming = $state(false);
	let saving = $state(false);
	let removing = $state(false);

	async function save() {
		if (saving) return;
		saving = true;
		try {
			await api(`/api/issues/${issueKey}/comments/${comment.id}`, {
				method: "PATCH",
				body: JSON.stringify({ body: draft }),
			});
			editing = false;
			await onChanged();
		} catch (cause) {
			onError(errorMessage(cause));
		} finally {
			saving = false;
		}
	}

	async function remove() {
		if (removing) return;
		removing = true;
		try {
			await api(`/api/issues/${issueKey}/comments/${comment.id}`, {
				method: "DELETE",
			});
			confirming = false;
			await onChanged();
		} catch (cause) {
			onError(errorMessage(cause));
		} finally {
			removing = false;
		}
	}
</script>

<div class="comment-row">
	<TimelineAvatar user={comment.author} />
	<div class="comment-body">
		<div class="comment-head">
			{#if comment.author}
				<UserLink username={comment.author.username}>
					<strong>{comment.author.displayName}</strong>
				</UserLink>
			{:else}
				<strong>Unknown user</strong>
			{/if}
			{#if comment.internal}
				<span class="internal-badge">Internal</span>
			{/if}
			<span class="comment-date" title={absoluteDate(comment.created)}>
				{relativeDate(comment.created)}
			</span>
			{#if comment.updated && comment.updated !== comment.created}
				<span class="comment-date" title={absoluteDate(comment.updated)}>
					· edited
				</span>
			{/if}
			{#if !editing && (canEdit || canDelete)}
				<span class="comment-actions">
					{#if canEdit}
						<button
							type="button"
							class="link-button"
							onclick={() => {
								draft = comment.bodyHtml ?? "";
								editing = true;
							}}
						>
							Edit
						</button>
					{/if}
					{#if canDelete}
						<button
							type="button"
							class="link-button danger"
							onclick={() => (confirming = true)}
						>
							Delete
						</button>
					{/if}
				</span>
			{/if}
		</div>
		{#if editing}
			<div class="comment-editor">
				<RichTextEditor
					value={draft}
					onChange={(next) => (draft = next)}
					minHeight={90}
					autoFocus
				/>
				<div class="comment-editor-actions">
					<Button
						appearance="primary"
						onclick={save}
						isLoading={saving}
						isDisabled={isEditorEmpty(draft)}
					>
						Save
					</Button>
					<Button
						appearance="subtle"
						onclick={() => {
							draft = comment.bodyHtml ?? "";
							editing = false;
						}}
					>
						Cancel
					</Button>
				</div>
			</div>
		{:else if comment.bodyHtml}
			<div class="fat-rich-text comment-html">
				{@html comment.bodyHtml}
			</div>
		{/if}
	</div>
	{#if confirming}
		<ConfirmDialog
			title="Delete comment"
			message="Delete this comment? This cannot be undone."
			onClose={() => (confirming = false)}
			onConfirm={remove}
			pending={removing}
		/>
	{/if}
</div>

<style>
	.comment-row {
		display: flex;
		gap: 10px;
		padding: 10px 0;
		border-bottom: 1px solid var(--ds-border, #091e4224);
	}
	.comment-body {
		flex: 1;
		min-width: 0;
	}
	.comment-head {
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex-wrap: wrap;
	}
	.comment-date {
		color: var(--ds-text-subtle, #505258);
		font-size: 12px;
	}
	.comment-actions {
		margin-left: auto;
		display: flex;
		gap: 8px;
	}
	.link-button {
		padding: 0;
		background: transparent;
		border: 0;
		color: var(--ds-link, #1868db);
		cursor: pointer;
		font-size: inherit;
	}
	.link-button.danger {
		color: #e5493a;
	}
	.internal-badge {
		display: inline-flex;
		align-items: center;
		height: 16px;
		padding: 0 6px;
		border-radius: 2px;
		background-color: #fff0b3;
		color: #172b4d;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.3px;
		text-transform: uppercase;
	}
	.comment-editor {
		margin-top: 6px;
	}
	.comment-editor-actions {
		display: flex;
		gap: 8px;
		margin-top: 6px;
	}
	.comment-html {
		margin-top: 4px;
	}
</style>
