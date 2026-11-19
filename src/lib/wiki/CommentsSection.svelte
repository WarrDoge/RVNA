<script lang="ts">
	import { invalidate } from "$app/navigation";
	import Button from "#lib/components/Button.svelte";
	import { createComment } from "./api.ts";
	import CommentBody from "./CommentBody.svelte";
	import CommentForm from "./CommentForm.svelte";
	import { textToHtml } from "./format.ts";
	import type { PageComment } from "./types.ts";

	interface Props {
		pageId: string;
		comments: PageComment[];
		locatedMarkers: Set<string>;
	}

	let { pageId, comments, locatedMarkers }: Props = $props();

	let composing = $state(false);
	let pending = $state(false);

	let visible = $derived(
		comments.filter(
			(comment) =>
				!comment.inline ||
				!comment.inlineMarkerRef ||
				!locatedMarkers.has(comment.inlineMarkerRef),
		),
	);
	let roots = $derived(visible.filter((comment) => comment.parentId === null));

	function repliesOf(id: string) {
		return visible.filter((comment) => comment.parentId === id);
	}

	async function create(value: string) {
		pending = true;
		try {
			await createComment(pageId, { bodyHtml: textToHtml(value) });
			composing = false;
			await invalidate("app:wiki-page");
		} catch {
			// A failed comment write shows no error.
		} finally {
			pending = false;
		}
	}
</script>

<section class="wiki-comments" aria-label="Comments">
	<h2 class="comments-title">Comments ({visible.length})</h2>
	{#each roots as comment (comment.id)}
		<div>
			<CommentBody {comment} {pageId} />
			<div class="wiki-comment-replies">
				{#each repliesOf(comment.id) as reply (reply.id)}
					<CommentBody comment={reply} {pageId} />
				{/each}
			</div>
		</div>
	{/each}
	{#if composing}
		<CommentForm
			placeholder="Add a comment"
			submitLabel="Save"
			pending={pending}
			onSubmit={create}
			onCancel={() => (composing = false)}
		/>
	{:else}
		<Button appearance="subtle" onclick={() => (composing = true)}>
			Add a comment
		</Button>
	{/if}
</section>

<style>
	.comments-title {
		font-size: 18px;
		font-weight: 600;
		margin: 0 0 4px;
	}
</style>
