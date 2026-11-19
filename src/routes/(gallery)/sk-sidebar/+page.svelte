<script lang="ts">
	import LogoMark from "#lib/components/LogoMark.svelte";
	import ProjectFrame from "#lib/project/ProjectFrame.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>SK sidebar gallery - RVNA</title>
</svelte:head>

<header class="gallery-topbar">
	<LogoMark />
	<span>RVNA</span>
</header>

{#if data.sidebar}
	<ProjectFrame data={data.sidebar} active={data.active}>
		<div class="gallery-content">
			<h1>Sidebar gallery</h1>
			<p>
				{data.sidebar.project.name} ({data.sidebar.project.key}) ·
				active <code>{data.active}</code>
			</p>
			<p class="hint">
				Query: <code>?project=&lt;KEY&gt;&amp;active=&lt;item&gt;</code>
			</p>
		</div>
	</ProjectFrame>
{:else}
	<main class="empty">
		<h1>No project to show</h1>
		<p>Sign in as a user who can browse a project.</p>
	</main>
{/if}

<style>
	.gallery-topbar {
		position: sticky;
		top: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		gap: 6px;
		height: 56px;
		padding: 7px 10px 8px;
		background-color: var(--ds-surface, #1d2125);
		border-bottom: 1px solid var(--ds-border, #3b3d42);
		color: var(--ds-text, #cecfd2);
		font-size: 14px;
		font-weight: 600;
	}

	.gallery-content {
		padding: 24px 32px;
		color: var(--ds-text, #cecfd2);
	}

	h1 {
		margin: 0 0 16px;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
	}

	p {
		margin: 0 0 8px;
	}

	.hint {
		color: var(--ds-text-subtle, #a9abaf);
	}

	code {
		font-size: 13px;
	}

	.empty {
		padding: 24px 32px;
		color: var(--ds-text, #cecfd2);
	}
</style>
