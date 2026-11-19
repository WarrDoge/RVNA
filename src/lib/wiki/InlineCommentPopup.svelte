<script lang="ts">
	import { invalidate } from "$app/navigation";
	import { dismiss } from "#lib/components/dismiss.ts";
	import { resolveComment } from "./api.ts";
	import { formatDateTime } from "./format.ts";
	import type { PageComment } from "./types.ts";

	interface Props {
		comment: PageComment;
		position: { top: number; left: number };
		onClose: () => void;
	}

	let { comment, position, onClose }: Props = $props();

	let panel = $state<HTMLDivElement>();

	$effect(() => {
		const previous = document.activeElement as HTMLElement | null;
		panel?.focus();
		return () => previous?.focus();
	});

	async function toggle() {
		try {
			await resolveComment(comment.id, !comment.resolved);
			await invalidate("app:wiki-page");
		} catch {
			// A failed resolve shows no error.
		}
	}
</script>

<div
	bind:this={panel}
	class="wiki-inline-popup"
	role="dialog"
	aria-label="Inline comment"
	tabindex="-1"
	style="top: {position.top}px; left: {position.left}px"
	{@attach dismiss(() => true, onClose)}
>
	<div class="wiki-comment-head head">
		<span class="wiki-comment-author">
			{comment.author?.displayName ?? "Unknown user"}
		</span>
		<span>{formatDateTime(comment.created)}</span>
	</div>
	{#if comment.inlineSelection}
		<p class="selection">“{comment.inlineSelection}”</p>
	{/if}
	<div class="fat-rich-text">{@html comment.bodyHtml ?? ""}</div>
	<div class="actions">
		<button type="button" class="wiki-action" onclick={toggle}>
			{comment.resolved ? "Reopen" : "Resolve"}
		</button>
		<button type="button" class="wiki-action" onclick={onClose}>Close</button>
	</div>
</div>

<style>
	.head {
		margin-bottom: 6px;
	}

	.selection {
		margin: 0 0 6px;
		color: var(--ds-text-subtle);
	}

	.actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
		margin-top: 8px;
	}
</style>
