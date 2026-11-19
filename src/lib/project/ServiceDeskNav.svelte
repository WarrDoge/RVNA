<script lang="ts">
	import { page } from "$app/state";
	import Icon from "#lib/components/Icon.svelte";
	import type { ProjectRef } from "#lib/api-types.ts";
	import type {
		ProjectSidebarPortal,
		ProjectSidebarQueue,
		SidebarActive,
	} from "./types.ts";
	import SidebarGlyph from "./SidebarGlyph.svelte";
	import SidebarItem from "./SidebarItem.svelte";

	interface Props {
		project: ProjectRef;
		active: SidebarActive;
		queues: ProjectSidebarQueue[];
		portals: ProjectSidebarPortal[];
	}

	let { project, active, queues, portals }: Props = $props();

	let firstQueue = $derived(
		queues.find((queue) => queue.parentId === null) ?? queues[0] ?? null,
	);
	let portal = $derived(
		portals.find((entry) => entry.projectKey === project.key),
	);
	let portalHref = $derived(
		portal
			? `/servicedesk/customer/portal/${portal.id}`
			: "/servicedesk/customer/portals",
	);
</script>

{#snippet issuesIcon()}
	<Icon name="issues" />
{/snippet}

{#snippet reportsIcon()}
	<SidebarGlyph name="reports" />
{/snippet}

{#snippet plusIcon()}
	<Icon name="plus" size={14} />
{/snippet}

{#if project.type === "service_desk"}
	<SidebarItem
		href={firstQueue
			? `/projects/${project.key}/queues/custom/${firstQueue.id}`
			: `/projects/${project.key}/issues`}
		active={active === "queues"}
		icon={issuesIcon}
		label="Queues"
	/>
	{#if queues.length > 0}
		<div class="queue-list">
			{#each queues as queue (queue.id)}
				<a
					href={`/projects/${project.key}/queues/custom/${queue.id}`}
					class="fat-sidebar-item queue-item"
					class:nested={queue.parentId !== null}
					aria-current={page.url.pathname.endsWith(
						`/queues/custom/${queue.id}`,
					)
						? "page"
						: undefined}
				>
					<span class="queue-name">{queue.name.replace(/^↳\s*/, "")}</span>
					<span class="queue-count">
						{queue.liveCount ?? queue.issueCount ?? 0}
					</span>
				</a>
			{/each}
		</div>
	{/if}
	<SidebarItem
		href={`/projects/${project.key}/reports`}
		active={active === "reports"}
		icon={reportsIcon}
		label="Reports"
	/>
	<div class="separator"></div>
	<SidebarItem
		href={portalHref}
		active={false}
		icon={plusIcon}
		label="Raise a request"
	/>
	<div class="separator"></div>
{/if}

<style>
	.queue-list {
		display: flex;
		flex-direction: column;
		gap: 1px;
		margin: 0 0 6px;
	}

	.queue-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 3px 7px;
		border-radius: 3px;
		font-size: 13px;
		line-height: 18px;
		background-color: transparent;
		color: var(--ds-text-subtle, #a9abaf);
		text-decoration: none;
	}

	.queue-item.nested {
		padding: 3px 7px 3px 27px;
	}

	.queue-item[aria-current="page"] {
		background-color: var(--ds-background-selected, #1c2b41);
		color: var(--ds-text-selected, #669df1);
	}

	.queue-item[aria-current="page"]:hover {
		background-color: var(--ds-background-selected, #1c2b41);
	}

	.queue-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.queue-count {
		margin-left: auto;
		min-width: 24px;
		padding: 0 6px;
		border-radius: 8px;
		text-align: center;
		font-size: 12px;
		background-color: var(--ds-background-neutral, #2c333a);
		color: var(--ds-text-subtle, #a9abaf);
	}

	.separator {
		height: 1px;
		margin: 8px 7px;
		background-color: var(--ds-border, #3b3d42);
	}
</style>
