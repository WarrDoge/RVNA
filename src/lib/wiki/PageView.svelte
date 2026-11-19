<script lang="ts">
	import { goto, invalidate } from "$app/navigation";
	import { onDestroy } from "svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import Icon from "#lib/components/Icon.svelte";
	import ShareLink from "#lib/components/ShareLink.svelte";
	import ActionMenu from "./ActionMenu.svelte";
	import Byline from "./Byline.svelte";
	import CommentsSection from "./CommentsSection.svelte";
	import InlineCommentPopup from "./InlineCommentPopup.svelte";
	import LabelsRow from "./LabelsRow.svelte";
	import PageInformationDialog from "./PageInformationDialog.svelte";
	import PageLinkList from "./PageLinkList.svelte";
	import RestrictionsDialog from "./RestrictionsDialog.svelte";
	import { toggleLike, togglePageWatch } from "./api.ts";
	import { pageHref, spaceHref } from "./format.ts";
	import type { PageDetail, PageRef } from "./types.ts";
	import WikiLayout from "./WikiLayout.svelte";

	interface Props {
		page: PageDetail;
		tree: PageRef[];
		version?: number;
		canEdit?: boolean;
		canDelete?: boolean;
	}

	let {
		page,
		tree,
		version,
		canEdit = false,
		canDelete = false,
	}: Props = $props();

	let bodyRef = $state<HTMLElement>();
	let locatedMarkers = $state<Set<string>>(new Set());
	let popup = $state<{
		commentId: string;
		top: number;
		left: number;
	} | null>(null);
	let showRestrictions = $state(false);
	let showInformation = $state(false);
	let shareState = $state<"idle" | "copied" | "failed">("idle");
	let shareLink = $state("");
	let watchOverride = $state<{ count: number; watching: boolean } | null>(null);
	let likeOverride = $state<{ count: number; liked: boolean } | null>(null);

	let watchers = $derived(watchOverride ?? page.watchers);
	let likes = $derived(likeOverride ?? page.likes);

	$effect(() => {
		page.watchers;
		watchOverride = null;
	});
	$effect(() => {
		page.likes;
		likeOverride = null;
	});

	$effect(() => {
		const container = bodyRef;
		// Re-attach the marker handlers whenever the rendered body or its comments change.
		void page.bodyHtml;
		if (!container) return;
		const found = new Set<string>();
		const handlers: [HTMLElement, (event: Event) => void][] = [];
		for (const element of container.querySelectorAll<HTMLElement>(
			".wiki-inline-marker",
		)) {
			const marker = element.dataset.marker;
			if (!marker) continue;
			found.add(marker);
			const comment = page.comments.find(
				(candidate) => candidate.inlineMarkerRef === marker,
			);
			if (!comment) continue;
			const open = () => {
				const rect = element.getBoundingClientRect();
				popup = {
					commentId: comment.id,
					top: Math.min(rect.bottom + 6, window.innerHeight - 220),
					left: Math.max(8, Math.min(rect.left, window.innerWidth - 340)),
				};
			};
			const handler = (event: Event) => {
				if (event instanceof KeyboardEvent) {
					if (event.key !== "Enter" && event.key !== " ") return;
					event.preventDefault();
				}
				open();
			};
			element.setAttribute("role", "button");
			element.setAttribute("aria-label", "Open inline comment");
			element.tabIndex = 0;
			element.addEventListener("click", handler);
			element.addEventListener("keydown", handler);
			handlers.push([element, handler]);
		}
		locatedMarkers = found;
		return () => {
			for (const [element, handler] of handlers) {
				element.removeEventListener("click", handler);
				element.removeEventListener("keydown", handler);
			}
		};
	});

	let popupComment = $derived(
		popup
			? page.comments.find((comment) => comment.id === popup?.commentId)
			: undefined,
	);

	async function watch() {
		try {
			watchOverride = await togglePageWatch(page.id, !watchers.watching);
			await invalidate("app:wiki-page");
		} catch {
			// A failed watch toggle shows no error.
		}
	}

	async function like() {
		try {
			likeOverride = await toggleLike(page.id);
			await invalidate("app:wiki-page");
		} catch {
			// A failed like toggle shows no error.
		}
	}

	let shareTimer: ReturnType<typeof setTimeout> | undefined;
	onDestroy(() => clearTimeout(shareTimer));

	async function share() {
		try {
			await navigator.clipboard.writeText(window.location.href);
			shareState = "copied";
			clearTimeout(shareTimer);
			shareTimer = setTimeout(() => (shareState = "idle"), 2000);
		} catch {
			shareLink = window.location.href;
			shareState = "failed";
			clearTimeout(shareTimer);
			shareTimer = setTimeout(() => (shareState = "idle"), 4000);
		}
	}
</script>

<PageTitle title={page.title} />

<WikiLayout
	space={page.space}
	{tree}
	currentPageId={page.id}
	contextPageId={page.sourceId}
	ancestorIds={page.ancestors.map((ancestor) => ancestor.id)}
>
	<div class="wiki-crumbs">
		<a href="/wiki">Wiki</a>
		<span>/</span>
		<a href={spaceHref(page.space.key)}>{page.space.name}</a>
		{#each page.ancestors as ancestor (ancestor.id)}
			<span class="crumb-group">
				<span>/</span>
				<a href={pageHref(ancestor)}>{ancestor.title}</a>
			</span>
		{/each}
	</div>

	<div class="wiki-page-header">
		<div class="title-block">
			<h1 class="wiki-page-title">{page.title}</h1>
			{#if version === undefined}
				<Byline
					{page}
					onHistory={() =>
						void goto(
							`/pages/viewpreviousversions.action?pageId=${encodeURIComponent(page.sourceId)}`,
						)}
					onRestrictions={() => (showRestrictions = true)}
				/>
			{/if}
		</div>
		{#if version === undefined}
			<div class="wiki-actions">
				<a
					class="wiki-action"
					href={`/pages/editpage.action?pageId=${encodeURIComponent(page.sourceId)}`}
				>
					Edit
				</a>
				<button
					type="button"
					class="wiki-action"
					aria-pressed={watchers.watching}
					onclick={watch}
				>
					{watchers.watching ? "Unwatch" : "Watch"}
				</button>
				<button type="button" class="wiki-action" onclick={share}>
					{#if shareState === "copied"}
						<Icon name="copy" size={13} /> Link copied
					{:else}
						<Icon name="link" size={13} /> Share
					{/if}
				</button>
				<ActionMenu {page} {canEdit} {canDelete} onInformation={() => (showInformation = true)} />
			</div>
		{/if}
	</div>

	{#if shareState === "failed"}
		<ShareLink url={shareLink} />
	{/if}

	{#if version !== undefined}
		<div class="wiki-old-version">
			<Icon name="clock" size={14} />
			<span
				>You are viewing version {version} of this page, which is read-only.</span
			>
			<a href={pageHref(page)}>View the current version</a>
		</div>
	{/if}

	<article bind:this={bodyRef} class="fat-rich-text wiki-page-body">{@html page.bodyHtml ?? ""}</article>

	{#if version === undefined}
		<LabelsRow {page} {canEdit} />
	{/if}

	<div class="wiki-like-row">
		<button
			type="button"
			class="wiki-like"
			aria-pressed={likes.liked}
			aria-label={likes.liked ? "Unlike this page" : "Like this page"}
			onclick={like}
		>
			👍 Like
			<span>{likes.count}</span>
		</button>
		{#if page.attachments.length > 0}
			<a
				class="wiki-action"
				href={`/pages/viewpageattachments.action?pageId=${encodeURIComponent(page.sourceId)}`}
			>
				<Icon name="attachment" size={13} />
				{page.attachments.length} attachment{page.attachments.length === 1
					? ""
					: "s"}
			</a>
		{/if}
	</div>

	{#if page.children.length > 0}
		<section class="children">
			<h2>Child pages</h2>
			<PageLinkList
				pages={page.children.map((child) => ({
					id: child.id,
					sourceId: child.sourceId,
					title: child.title,
				}))}
				empty="No child pages."
			/>
		</section>
	{/if}

	{#if version === undefined}
		<CommentsSection
			pageId={page.id}
			comments={page.comments}
			{locatedMarkers}
		/>
	{/if}

	{#if popup && popupComment}
		<InlineCommentPopup
			comment={popupComment}
			position={{ top: popup.top, left: popup.left }}
			onClose={() => (popup = null)}
		/>
	{/if}
	{#if showRestrictions}
		<RestrictionsDialog {page} onClose={() => (showRestrictions = false)} />
	{/if}
	{#if showInformation}
		<PageInformationDialog {page} onClose={() => (showInformation = false)} />
	{/if}
</WikiLayout>

<style>
	.crumb-group {
		display: contents;
	}

	.title-block {
		min-width: 0;
		flex: 1;
	}

	.children {
		margin-top: 24px;
	}

	.children h2 {
		font-size: 16px;
		font-weight: 600;
		margin: 0 0 6px;
	}

	.wiki-old-version a {
		color: inherit;
	}
</style>
