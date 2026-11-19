<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { onMount, type Snippet } from "svelte";
	import type { Filter, Me, RecentIssue } from "#lib/api-types.ts";
	import { api } from "#lib/api.ts";
	import { installGoShortcuts } from "#lib/go-shortcuts.ts";
		import { type RecentBoard, recentBoards } from "#lib/recent-boards.ts";
	import {
		type RecentProject,
		recentProjects,
	} from "#lib/recent-projects.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import Icon from "#lib/components/Icon.svelte";
	import IssueTypeIcon from "#lib/components/IssueTypeIcon.svelte";
	import LogoMark from "#lib/components/LogoMark.svelte";
	import ProjectAvatar from "#lib/components/ProjectAvatar.svelte";
	import { adminMenu } from "#lib/admin/navigation.ts";
	import { setShellContext } from "./context.ts";
	import CreateIssue from "./CreateIssue.svelte";
	import { menuDismiss } from "./menu.ts";
	import Notifications from "./Notifications.svelte";
	import QuickSearch from "./QuickSearch.svelte";
	import { installShortcut } from "./shortcuts.ts";
	import { isWikiPath, recentSpaces } from "#lib/wiki/context.ts";
	import WikiSearch from "#lib/wiki/WikiSearch.svelte";
	import ShortcutHelp from "./ShortcutHelp.svelte";

	interface Props {
		user: Me;
		unread: number;
		children: Snippet;
	}

	let { user, unread, children }: Props = $props();

	let avatarUrl = $derived(user.avatarUrl);
	let displayUser = $derived({ ...user, avatarUrl });
	setShellContext({
		setAvatarUrl(url: string) {
			avatarUrl = url;
		},
	});
	let helpOpen = $state(false);
	let onWiki = $derived(isWikiPath(page.url.pathname));

	let projectsOpen = $state(false);
	let projectsTrigger = $state<HTMLButtonElement>();
	let projects = $state<RecentProject[]>([]);

	let issuesOpen = $state(false);
	let issuesTrigger = $state<HTMLButtonElement>();
	let recentIssues = $state<RecentIssue[]>([]);
	let favouriteFilters = $state<Filter[]>([]);
	let issuesRequest = 0;

	let boardsOpen = $state(false);
	let boardsTrigger = $state<HTMLButtonElement>();
	let boards = $state<RecentBoard[]>([]);

	let spacesOpen = $state(false);
	let spacesTrigger = $state<HTMLButtonElement>();
	let spaces = $state<{ key: string; name: string }[]>([]);
	let recentSpaceKeys = $state<string[]>([]);

	let adminOpen = $state(false);
	let adminTrigger = $state<HTMLButtonElement>();

	let accountOpen = $state(false);
	let accountTrigger = $state<HTMLButtonElement>();

	onMount(() => {
		const stopGoShortcuts = installGoShortcuts((path) => void goto(path));
		const stopHelpShortcut = installShortcut((key) => {
			if (key === "?") helpOpen = true;
		});
		return () => {
			stopGoShortcuts();
			stopHelpShortcut();
		};
	});

	function toggleProjects() {
		projectsOpen = !projectsOpen;
		if (projectsOpen) projects = recentProjects(user.id);
	}

	function toggleIssues() {
		issuesOpen = !issuesOpen;
		if (!issuesOpen) return;
		const request = ++issuesRequest;
		recentIssues = [];
		favouriteFilters = [];
		api<{ issues: RecentIssue[] }>("/api/issues/recent?limit=5")
			.then((result) => {
				if (request === issuesRequest) recentIssues = result.issues;
			})
			.catch(() => undefined);
		api<Filter[]>("/api/filters?scope=favourite&query=")
			.then((result) => {
				if (request === issuesRequest) favouriteFilters = result;
			})
			.catch(() => undefined);
	}

	function toggleBoards() {
		boardsOpen = !boardsOpen;
		if (boardsOpen) boards = recentBoards(user.id);
	}

	function toggleSpaces() {
		spacesOpen = !spacesOpen;
		if (!spacesOpen) return;
		recentSpaceKeys = recentSpaces();
		api<{ key: string; name: string }[]>("/api/wiki/spaces")
			.then((result) => {
				spaces = result;
			})
			.catch(() => {
				spaces = [];
			});
	}

	let recentSpaceRows = $derived(
		recentSpaceKeys
			.map((key) => spaces.find((space) => space.key === key))
			.filter((space): space is { key: string; name: string } =>
				Boolean(space),
			)
			.slice(0, 5),
	);

	async function logout() {
		accountOpen = false;
		try {
			const result = await api<{ redirect: string }>("/auth/logout", {
				method: "POST",
			});
			window.location.assign(result.redirect);
		} catch {
			// The menu stays closed; the user can retry.
		}
	}
</script>

<div class="app">
	<header class="header">
		<a
			href="/secure/Dashboard.jspa"
			aria-label="RVNA home"
			class="logo"
		>
			<LogoMark />
			<span>RVNA</span>
		</a>

		<nav class="nav">
			<a
				href="/secure/Dashboard.jspa"
				class="nav-item"
			>
				Dashboards
			</a>

			<div
				class="menu-root"
				{@attach menuDismiss(
					() => projectsOpen,
					() => (projectsOpen = false),
					() => projectsTrigger,
				)}
			>
				<button
					bind:this={projectsTrigger}
					type="button"
					aria-haspopup="menu"
					aria-expanded={projectsOpen}
					onclick={toggleProjects}
					class="menu-trigger"
				>
					Projects
					<span class="chevron"><Icon name="chevron-down" /></span>
				</button>
				{#if projectsOpen}
					<div role="menu" aria-label="Projects" class="menu projects-menu">
						<div class="heading">Recent projects</div>
						{#if projects.length === 0}
							<div class="empty">No recent projects.</div>
						{:else}
							{#each projects as project (project.key)}
								<a
									href={`/projects/${project.key}/issues`}
									role="menuitem"
									class="fat-menu-item row"
								>
									<ProjectAvatar
										name={project.name}
										avatarUrl={project.avatarUrl}
										size={20}
									/>
									<span class="grow">{project.name}</span>
									<span class="small-muted">{project.key}</span>
								</a>
							{/each}
						{/if}
						<div class="divider"></div>
						<a
							href="/secure/BrowseProjects.jspa"
							role="menuitem"
							class="fat-menu-item"
						>
							View all projects
						</a>
					</div>
				{/if}
			</div>

			<div
				class="menu-root"
				{@attach menuDismiss(
					() => issuesOpen,
					() => (issuesOpen = false),
					() => issuesTrigger,
				)}
			>
				<button
					bind:this={issuesTrigger}
					type="button"
					aria-haspopup="menu"
					aria-expanded={issuesOpen}
					onclick={toggleIssues}
					class="menu-trigger"
				>
					Issues
					<span class="chevron"><Icon name="chevron-down" /></span>
				</button>
				{#if issuesOpen}
					<div role="menu" aria-label="Issues" class="menu issues-menu">
						<a
							href="/issues/"
							role="menuitem"
							class="fat-menu-item"
						>
							Search for issues
						</a>
						<div class="heading tight">Recent issues</div>
						{#if recentIssues.length > 0}
							{#each recentIssues as issue (issue.id)}
								<a
									href={`/browse/${issue.key}`}
									role="menuitem"
									class="fat-menu-item row"
								>
									<IssueTypeIcon
										id={issue.type.id}
										name={issue.type.name}
										icon={issue.type.iconUrl}
										size={14}
									/>
									<span class="issue-key">{issue.key}</span>
									<span class="summary">{issue.summary}</span>
								</a>
							{/each}
						{:else}
							<div class="empty tight">No recently viewed issues.</div>
						{/if}
						<div class="heading tight">Favourite filters</div>
						{#if favouriteFilters.length > 0}
							{#each favouriteFilters as filter (filter.id)}
								<a
									href={`/issues/?filter=${filter.id}`}
									role="menuitem"
									class="fat-menu-item row"
								>
									<span class="star"><Icon name="star-filled" size={12} /></span>
									{filter.name}
								</a>
							{/each}
						{:else}
							<div class="empty tight">No favourite filters yet.</div>
						{/if}
						<div class="divider"></div>
						<a
							href="/secure/ManageFilters.jspa"
							role="menuitem"
							class="fat-menu-item"
						>
							Manage filters
						</a>
					</div>
				{/if}
			</div>

			<div
				class="menu-root"
				{@attach menuDismiss(
					() => boardsOpen,
					() => (boardsOpen = false),
					() => boardsTrigger,
				)}
			>
				<button
					bind:this={boardsTrigger}
					type="button"
					aria-haspopup="menu"
					aria-expanded={boardsOpen}
					onclick={toggleBoards}
					class="menu-trigger"
				>
					Boards
					<span class="chevron"><Icon name="chevron-down" /></span>
				</button>
				{#if boardsOpen}
					<div role="menu" aria-label="Boards" class="menu boards-menu">
						<div class="heading">Recent boards</div>
						{#if boards.length === 0}
							<div class="empty">No recent boards.</div>
						{:else}
							{#each boards as board (board.rapidViewId)}
								<a
									href={`/secure/RapidBoard.jspa?rapidView=${board.rapidViewId}`}
									role="menuitem"
									class="fat-menu-item row"
								>
									<span class="grow">{board.name}</span>
									<span class="small-muted"
										>{board.type === "scrum" ? "Scrum" : "Kanban"}</span
									>
								</a>
							{/each}
						{/if}
						<div class="divider"></div>
						<a
							href="/secure/ManageRapidViews.jspa"
							role="menuitem"
							class="fat-menu-item"
						>
							View all boards
						</a>
					</div>
				{/if}
			</div>

			<div
				class="menu-root"
				{@attach menuDismiss(
					() => spacesOpen,
					() => (spacesOpen = false),
					() => spacesTrigger,
				)}
			>
				<button
					bind:this={spacesTrigger}
					type="button"
					aria-haspopup="menu"
					aria-expanded={spacesOpen}
					onclick={toggleSpaces}
					class="menu-trigger"
				>
					Spaces
					<span class="chevron"><Icon name="chevron-down" /></span>
				</button>
				{#if spacesOpen}
					<div role="menu" aria-label="Spaces" class="menu spaces-menu">
						<div class="heading">Recent spaces</div>
						{#if recentSpaceRows.length === 0}
							<div class="empty">No recent spaces.</div>
						{:else}
							{#each recentSpaceRows as space (space.key)}
								<a
									href={`/display/${encodeURIComponent(space.key)}`}
									role="menuitem"
									class="fat-menu-item"
								>
									{space.name}
								</a>
							{/each}
						{/if}
						<div class="divider"></div>
						<a
							href="/spacedirectory/view.action"
							role="menuitem"
							class="fat-menu-item"
						>
							Space directory
						</a>
					</div>
				{/if}
			</div>

			<a href="/wiki" class="nav-item">Wiki</a>
		</nav>

		<CreateIssue />

		<div class="right">
			{#if onWiki}
				<WikiSearch />
			{:else}
				<QuickSearch />
			{/if}
			<Notifications {unread} />
			<button
				type="button"
				aria-label="Help"
				title="Help"
				class="icon-button"
				onclick={() => {
					helpOpen = true;
				}}
			>
				<Icon name="help" />
			</button>
			{#if helpOpen}
				<ShortcutHelp onClose={() => (helpOpen = false)} />
			{/if}
			{#if user.isAdmin}
				<div
					class="menu-root"
					{@attach menuDismiss(
						() => adminOpen,
						() => (adminOpen = false),
						() => adminTrigger,
					)}
				>
					<button
						bind:this={adminTrigger}
						type="button"
						aria-label="Administration"
						title="Administration"
						aria-haspopup="menu"
						aria-expanded={adminOpen}
						onclick={() => (adminOpen = !adminOpen)}
						class="icon-button"
					>
						<Icon name="settings" />
					</button>
					{#if adminOpen}
						<div role="menu" aria-label="Administration" class="menu admin-menu">
							<div role="presentation" class="heading">Administration</div>
							{#each adminMenu as item (item.href)}
								<a
									href={item.href}
									role="menuitem"
									class="fat-menu-item"
								>
									{item.label}
								</a>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
			<div
				class="menu-root"
				{@attach menuDismiss(
					() => accountOpen,
					() => (accountOpen = false),
					() => accountTrigger,
				)}
			>
				<button
					bind:this={accountTrigger}
					type="button"
					aria-label="Account menu"
					aria-haspopup="menu"
					aria-expanded={accountOpen}
					onclick={() => (accountOpen = !accountOpen)}
					class="icon-button account"
				>
					<Avatar user={displayUser} />
				</button>
				{#if accountOpen}
					<div role="menu" aria-label="Account" class="menu account-menu">
						<div role="presentation" class="account-name">
							{displayUser.displayName}
						</div>
						<a
							href="/secure/ViewProfile.jspa"
							role="menuitem"
							class="fat-menu-item"
						>
							Profile
						</a>
						<a
							href="/secure/ViewProfile.jspa?selectedTab=notifications"
							role="menuitem"
							class="fat-menu-item"
						>
							Notification settings
						</a>
						<a
							href="/secure/ViewProfile.jspa?selectedTab=tokens"
							role="menuitem"
							class="fat-menu-item"
						>
							Personal access tokens
						</a>
						<button
							class="fat-menu-item"
							role="menuitem"
							type="button"
							onclick={() => void logout()}
						>
							Log out
						</button>
					</div>
				{/if}
			</div>
		</div>
	</header>
	<main>
		{@render children()}
	</main>
</div>

<style>
	.app {
		min-height: 100vh;
		background-color: var(--ds-surface);
		color: var(--ds-text);
	}

	.header {
		position: sticky;
		top: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		height: 56px;
		padding: 7px 10px 8px;
		background-color: var(--ds-surface);
		border-bottom: 1px solid var(--ds-border);
	}

	.logo {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 92px;
		height: 40px;
		margin-right: 20px;
		flex: none;
		text-decoration: none;
	}

	.logo span {
		font-size: 14px;
		font-weight: 600;
		line-height: 20px;
		color: var(--ds-text);
		white-space: nowrap;
	}

	.nav {
		display: flex;
		align-items: center;
	}

	.nav-item {
		position: relative;
		display: inline-flex;
		align-items: center;
		height: 40px;
		padding: 5px 10px;
		font-size: 14px;
		line-height: 20px;
		font-weight: 400;
		color: var(--ds-text-subtle);
		text-decoration: none;
		white-space: nowrap;
	}

	.menu-root {
		position: relative;
	}

	.menu-trigger {
		position: relative;
		display: inline-flex;
		align-items: center;
		height: 40px;
		padding: 5px 24px 5px 10px;
		background: transparent;
		border: 0;
		font-size: 14px;
		line-height: 20px;
		font-weight: 400;
		color: var(--ds-text-subtle);
		cursor: pointer;
		white-space: nowrap;
	}

	.chevron {
		position: absolute;
		right: 7px;
		top: 50%;
		transform: translateY(-50%);
		display: inline-flex;
		color: inherit;
	}

	.menu {
		position: absolute;
		top: 42px;
		left: 0;
		z-index: 100;
		padding-block: 4px;
		background-color: var(--ds-surface-overlay);
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		box-shadow: var(--ds-shadow-overlay);
	}

	.projects-menu {
		min-width: 280px;
	}

	.issues-menu {
		width: 320px;
	}

	.boards-menu {
		min-width: 260px;
	}

	.spaces-menu {
		min-width: 260px;
		max-height: 420px;
		overflow-y: auto;
	}

	.admin-menu {
		top: 36px;
		left: auto;
		right: 0;
		min-width: 220px;
	}

	.account-menu {
		top: 36px;
		left: auto;
		right: 0;
		min-width: 220px;
	}

	.heading {
		padding: 6px 12px;
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle);
		text-transform: uppercase;
	}

	.heading.tight {
		padding: 6px 12px 2px;
	}

	.empty {
		padding: 6px 12px;
		color: var(--ds-text-subtle);
	}

	.empty.tight {
		padding: 2px 12px 6px;
	}

	.divider {
		height: 1px;
		margin: 4px 0;
		background-color: var(--ds-border);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.grow {
		flex: 1;
	}

	.small-muted {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.issue-key {
		color: var(--ds-text-subtle);
		width: 72px;
	}

	.summary {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.star {
		display: inline-flex;
		color: #ffab00;
	}

	.right {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.icon-button {
		width: 32px;
		height: 32px;
		padding: 4px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text-subtle);
		cursor: pointer;
	}

	.account {
		border-radius: 50%;
	}

	.account-name {
		padding: 6px 12px;
		font-weight: 600;
		color: var(--ds-text);
	}
</style>
