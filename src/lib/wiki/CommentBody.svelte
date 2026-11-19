<script lang="ts">
	import { invalidate } from "$app/navigation";
	import Avatar from "#lib/components/Avatar.svelte";
	import {
		createComment,
		deleteComment,
		resolveComment,
		updateComment,
	} from "./api.ts";
	import CommentForm from "./CommentForm.svelte";
	import { formatDateTime, htmlToText, textToHtml } from "./format.ts";
	import type { PageComment } from "./types.ts";

	interface Props {
		comment: PageComment;
		pageId: string;
	}

	let { comment, pageId }: Props = $props();

	let editing = $state(false);
	let replying = $state(false);
	let pending = $state(false);

	async function run(action: () => Promise<unknown>, done?: () => void) {
		pending = true;
		try {
			await action();
			done?.();
			await invalidate("app:wiki-page");
		} catch {
			// A failed comment write shows no error.
		} finally {
			pending = false;
		}
	}

	function edit(value: string) {
		void run(() => updateComment(comment.id, textToHtml(value)), () => {
			editing = false;
		});
	}

	function remove() {
		void run(() => deleteComment(comment.id));
	}

	function reply(value: string) {
		void run(
			() =>
				createComment(pageId, {
					bodyHtml: textToHtml(value),
					parentId: comment.id,
				}),
			() => {
				replying = false;
			},
		);
	}

	function resolve() {
		void run(() => resolveComment(comment.id, !comment.resolved));
	}
</script>

<div class="wiki-comment">
	{#if comment.author}
		<Avatar user={comment.author} size={28} />
	{:else}
		<span class="wiki-space-avatar no-avatar">?</span>
	{/if}
	<div class="wiki-comment-body">
		<div class="wiki-comment-head">
			<span class="wiki-comment-author">
				{comment.author?.displayName ?? "Unknown user"}
			</span>
			<span>{formatDateTime(comment.created)}</span>
			{#if comment.updated && comment.updated !== comment.created}
				<span>(edited {formatDateTime(comment.updated)})</span>
			{/if}
			{#if comment.inline}<span class="wiki-badge">inline</span>{/if}
			{#if comment.resolved}<span class="wiki-badge">resolved</span>{/if}
			<span class="wiki-comment-actions">
				{#if comment.inline}
					<button type="button" onclick={resolve}>
						{comment.resolved ? "Reopen" : "Resolve"}
					</button>
				{/if}
				<button type="button" onclick={() => (replying = true)}>Reply</button>
				{#if comment.canEdit}
					<button type="button" onclick={() => (editing = true)}>Edit</button>
					<button type="button" onclick={remove}>Delete</button>
				{/if}
			</span>
		</div>
		{#if comment.inlineSelection}
			<blockquote class="selection">{comment.inlineSelection}</blockquote>
		{/if}
		{#if editing}
			<CommentForm
				placeholder="Edit your comment"
				submitLabel="Save"
				pending={pending}
				initialValue={htmlToText(comment.bodyHtml)}
				onSubmit={edit}
				onCancel={() => (editing = false)}
			/>
		{:else}
			<div class="fat-rich-text comment-body">{@html comment.bodyHtml ?? ""}</div>
		{/if}
		{#if replying}
			<CommentForm
				placeholder="Reply"
				submitLabel="Reply"
				pending={pending}
				onSubmit={reply}
				onCancel={() => (replying = false)}
			/>
		{/if}
	</div>
</div>

<style>
	.no-avatar {
		width: 28px;
		height: 28px;
	}

	.selection {
		margin: 4px 0;
		padding-left: 8px;
		border-left: 3px solid var(--ds-border);
		color: var(--ds-text-subtle);
		font-size: 13px;
	}

	.comment-body {
		margin-top: 4px;
	}
</style>
