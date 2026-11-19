<script lang="ts">
	import { onMount } from "svelte";
	import { page } from "$app/state";
	import Icon from "#lib/components/Icon.svelte";
	import ProjectAvatar from "#lib/components/ProjectAvatar.svelte";
	import { recentBoards } from "#lib/recent-boards.ts";
	import BoardSwitcher from "./BoardSwitcher.svelte";
	import RailItem from "./RailItem.svelte";
	import ServiceDeskNav from "./ServiceDeskNav.svelte";
	import SidebarGlyph from "./SidebarGlyph.svelte";
	import SidebarItem from "./SidebarItem.svelte";
	import type {
		ProjectSidebarBoard,
		ProjectSidebarData,
		SidebarActive,
	} from "./types.ts";

	interface Props {
		data: ProjectSidebarData;
		active: SidebarActive;
		board?: ProjectSidebarBoard;
	}

	let { data, active, board: boardProp }: Props = $props();

	const collapsedKey = "rvna.sidebarCollapsed";

	let collapsed = $state(false);
	let mounted = $state(false);
	let recentBoardId = $state<number | null>(null);

	onMount(() => {
		collapsed = window.localStorage.getItem(collapsedKey) === "1";
		mounted = true;
	});

	$effect(() => {
		if (!mounted) return;
		void page.url.pathname;
		recentBoardId = findRecentBoard(data.project.key, data.boards);
	});

	let board = $derived(
		boardProp ??
			data.boards.find((item) => item.rapidViewId === recentBoardId) ??
			data.boards[0],
	);
	let canAdminister = $derived(data.canAdminister ?? data.user.isAdmin);

	function findRecentBoard(
		projectKey: string,
		projectBoards: ProjectSidebarBoard[],
	) {
		for (const recent of recentBoards(page.data.user?.id ?? "")) {
			if (recent.projectKey !== projectKey) continue;
			const match = projectBoards.find(
				(item) => item.rapidViewId === recent.rapidViewId,
			);
			if (match) return match.rapidViewId;
		}
		return null;
	}

	function toggle() {
		collapsed = !collapsed;
		window.localStorage.setItem(collapsedKey, collapsed ? "1" : "0");
	}
</script>

{#snippet backlogIcon()}
	<SidebarGlyph name="backlog" />
{/snippet}

{#snippet boardIcon()}
	<SidebarGlyph name="board" />
{/snippet}

{#snippet reportsIcon()}
	<SidebarGlyph name="board-reports" />
{/snippet}

{#snippet releasesIcon()}
	<SidebarGlyph name="releases" />
{/snippet}

{#snippet issuesIcon()}
	<Icon name="issues" />
{/snippet}

{#snippet settingsIcon()}
	<Icon name="settings" size={16} />
{/snippet}

{#if collapsed}
	<aside class="sidebar collapsed">
		<div class="project-avatar">
			<ProjectAvatar
				name={data.project.name}
				avatarUrl={data.project.avatarUrl}
				size={28}
			/>
		</div>
		{#if board}
			<RailItem
				href={`/secure/RapidBoard.jspa?rapidView=${board.rapidViewId}&view=planning`}
				label="Backlog"
				active={active === "backlog"}
				icon={backlogIcon}
			/>
			<RailItem
				href={`/secure/RapidBoard.jspa?rapidView=${board.rapidViewId}`}
				label={board.type === "scrum" ? "Active sprints" : "Kanban board"}
				active={active === "board"}
				icon={boardIcon}
			/>
			<RailItem
				href={`/secure/RapidBoard.jspa?rapidView=${board.rapidViewId}&view=releases`}
				label="Releases"
				active={active === "releases"}
				icon={releasesIcon}
			/>
			<RailItem
				href={`/secure/RapidBoard.jspa?rapidView=${board.rapidViewId}&view=reporting`}
				label="Reports"
				active={active === "reports"}
				icon={reportsIcon}
			/>
		{/if}
		{#if data.project.key}
			<RailItem
				href={`/projects/${data.project.key}/issues`}
				label="Issues"
				active={active === "issues"}
				icon={issuesIcon}
			/>
		{/if}
		<div class="bottom">
			{#if canAdminister && data.project.key}
				<RailItem
					href={`/plugins/servlet/project-config/${data.project.key}/summary`}
					label="Project settings"
					active={false}
					icon={settingsIcon}
				/>
			{/if}
			<button
				type="button"
				onclick={toggle}
				title="Expand sidebar"
				aria-label="Expand sidebar"
				class="toggle"
			>
				»
			</button>
		</div>
	</aside>
{:else}
	<aside class="sidebar">
		<div class="project-header">
			<ProjectAvatar
				name={data.project.name}
				avatarUrl={data.project.avatarUrl}
				size={40}
			/>
			<span class="project-name">{data.project.name}</span>
		</div>

		{#if board}
			<BoardSwitcher {board} boards={data.boards} />
		{/if}

		<nav>
			{#if board}
				<SidebarItem
					href={`/secure/RapidBoard.jspa?rapidView=${board.rapidViewId}&view=planning`}
					active={active === "backlog"}
					icon={backlogIcon}
					label="Backlog"
				/>
				<SidebarItem
					href={`/secure/RapidBoard.jspa?rapidView=${board.rapidViewId}`}
					active={active === "board"}
					icon={boardIcon}
					label={board.type === "scrum" ? "Active sprints" : "Kanban board"}
				/>
				<SidebarItem
					href={`/secure/RapidBoard.jspa?rapidView=${board.rapidViewId}&view=releases`}
					active={active === "releases"}
					icon={releasesIcon}
					label="Releases"
				/>
				<SidebarItem
					href={`/secure/RapidBoard.jspa?rapidView=${board.rapidViewId}&view=reporting`}
					active={active === "reports"}
					icon={reportsIcon}
					label="Reports"
				/>
			{/if}
			{#if data.project.key}
				<ServiceDeskNav
					project={data.project}
					{active}
					queues={data.queues}
					portals={data.portals}
				/>
				<SidebarItem
					href={`/projects/${data.project.key}/issues`}
					active={active === "issues"}
					icon={issuesIcon}
					label="Issues"
				/>
			{/if}
		</nav>

		<div class="bottom">
			{#if canAdminister && data.project.key}
				<SidebarItem
					href={`/plugins/servlet/project-config/${data.project.key}/summary`}
					active={active === "settings"}
					icon={settingsIcon}
					label="Project settings"
				/>
			{/if}
			<div class="collapse-row">
				<button
					type="button"
					onclick={toggle}
					title="Collapse sidebar"
					aria-label="Collapse sidebar"
					class="toggle"
				>
					«
				</button>
			</div>
		</div>
	</aside>
{/if}

<style>
	.sidebar {
		position: sticky;
		top: 56px;
		align-self: flex-start;
		height: calc(100vh - 56px);
		width: 280px;
		min-width: 280px;
		display: flex;
		flex-direction: column;
		background-color: var(--ds-surface-sunken, #101214);
		border-right: 1px solid var(--ds-border, #3b3d42);
		padding: 16px 8px 10px;
	}

	.sidebar.collapsed {
		width: 44px;
		min-width: 44px;
		align-items: center;
		gap: 2px;
		padding: 12px 0 10px;
	}

	.project-header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 8px 12px;
	}

	.project-avatar {
		margin-bottom: 8px;
	}

	.project-name {
		font-size: 16px;
		font-weight: 600;
		line-height: 20px;
		color: var(--ds-text, #cecfd2);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.bottom {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.collapsed .bottom {
		align-items: center;
	}

	.collapse-row {
		display: flex;
		justify-content: flex-end;
		padding: 0 7px;
	}

	.toggle {
		width: 24px;
		height: 24px;
		padding: 0;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text-subtle, #a9abaf);
		cursor: pointer;
		font-size: 16px;
	}

	.sidebar:not(.collapsed) .toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
</style>
