<script lang="ts">
	import "#lib/wiki/wiki.css";
	import Avatar from "#lib/components/Avatar.svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import PageLinkList from "#lib/wiki/PageLinkList.svelte";
	import SpaceAvatar from "#lib/wiki/SpaceAvatar.svelte";
	import { formatRelative, pageHref, spaceHref } from "#lib/wiki/format.ts";
	import type { RecentPage } from "#lib/wiki/types.ts";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	type Tab = "all" | "created" | "watched";
	let tab = $state<Tab>("all");

	let updates = $derived(data.home.recent);
	let spaces = $derived(data.home.spaces);
	let created = $derived(data.home.created);
	let watched = $derived(data.home.watched);

	function recentContributors(pages: RecentPage[]) {
		const seen = new Map<string, RecentPage>();
		for (const page of pages) {
			if (page.author) seen.set(page.author, page);
		}
		return [...seen.values()].slice(0, 5);
	}

	let contributors = $derived(recentContributors(updates));
</script>

<PageTitle title="Wiki" />

<div class="wiki-home">
	<nav class="home-nav" aria-label="Wiki navigation">
		<div class="wiki-sidebar-section-title">Discover</div>
		<button
			type="button"
			class="wiki-directory-tab tab-button"
			class:is-active={tab === "all"}
			onclick={() => (tab = "all")}
		>
			All updates
		</button>
		<a class="wiki-directory-tab" href="/spacedirectory/view.action">Spaces</a>
		<div class="wiki-sidebar-section-title">My work</div>
		<button
			type="button"
			class="wiki-directory-tab tab-button"
			class:is-active={tab === "created"}
			onclick={() => (tab = "created")}
		>
			Pages I created
		</button>
		<button
			type="button"
			class="wiki-directory-tab tab-button"
			class:is-active={tab === "watched"}
			onclick={() => (tab = "watched")}
		>
			Watched pages
		</button>
	</nav>

	<div class="wiki-home-main">
		<h1 class="home-title">
			{tab === "all"
				? "All updates"
				: tab === "created"
					? "Pages you created"
					: "Pages you watch"}
		</h1>
		<p class="home-subtitle">
			{tab === "all"
				? "Recently updated pages across the spaces you can read."
				: tab === "created"
					? "Pages whose first version you wrote."
					: "Pages you asked to follow."}
		</p>

		{#if tab === "all"}
			{#each updates as page (page.id)}
				<div class="wiki-update">
					<span class="wiki-space-avatar update-avatar" aria-hidden="true">
						{page.spaceKey.slice(0, 2).toUpperCase()}
					</span>
					<div class="update-body">
						<div>
							<a class="update-link" href={pageHref(page)}>{page.title}</a>
						</div>
						<div class="wiki-update-meta">
							{page.spaceName} · updated {formatRelative(page.updated)}{page.author
								? ` by ${page.author}`
								: ""}
						</div>
					</div>
				</div>
			{/each}
		{/if}

		{#if tab === "created"}
			<PageLinkList pages={created} empty="You have not created any pages." />
		{/if}
		{#if tab === "watched"}
			<PageLinkList pages={watched} empty="You are not watching any pages." />
		{/if}
	</div>

	<aside class="wiki-home-side">
		<div class="wiki-card">
			<h2>Welcome to RVNA</h2>
			<p class="card-text">
				The wiki is where the team keeps its documentation: spaces for teams,
				pages for knowledge, and comments for discussion.
			</p>
			<p class="card-link">
				<a href="/spacedirectory/view.action">Browse the space directory</a>
			</p>
		</div>
		<div class="wiki-card">
			<h2>My spaces</h2>
			{#if spaces.length === 0}
				<p class="wiki-list-empty">No spaces are visible to you.</p>
			{:else}
				<ul class="wiki-list">
					{#each spaces.slice(0, 8) as space (space.id)}
						<li class="wiki-list-item">
							<SpaceAvatar name={space.name} iconPath={space.iconPath} size={20} />
							<a href={spaceHref(space.key)}>{space.name}</a>
							<span class="wiki-list-space">{space.pageCount} pages</span>
						</li>
					{/each}
				</ul>
			{/if}
			<p class="card-link card-link-last">
				<a href="/spacedirectory/view.action">View all spaces</a>
			</p>
		</div>
		<div class="wiki-card">
			<h2>Recent contributors</h2>
			<ul class="wiki-list">
				{#each contributors as page (page.id)}
					<li class="wiki-list-item">
						<Avatar
							user={{
								displayName: page.author ?? "",
								username: page.author ?? "",
								avatarUrl: null,
							}}
							size={20}
						/>
						<span>{page.author}</span>
					</li>
				{/each}
			</ul>
		</div>
	</aside>
</div>

<style>
	.home-nav {
		width: 190px;
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.wiki-directory-tab.tab-button {
		text-align: left;
		border: 0;
		background: transparent;
	}

	.wiki-directory-tab.tab-button.is-active {
		background: transparent;
	}

	.home-title {
		margin: 0 0 4px;
		font-size: 24px;
		font-weight: 500;
	}

	.home-subtitle {
		margin: 0 0 12px;
		color: var(--ds-text-subtle);
	}

	.update-avatar {
		width: 32px;
		height: 32px;
		font-size: 13px;
	}

	.update-body {
		min-width: 0;
	}

	.update-link {
		color: var(--ds-link);
		text-decoration: none;
		font-weight: 500;
	}

	.card-text {
		margin: 0 0 8px;
		color: var(--ds-text-subtle);
	}

	.card-link {
		margin: 0;
	}

	.card-link-last {
		margin-top: 8px;
	}
</style>
