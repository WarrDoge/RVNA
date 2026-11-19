<script lang="ts">
	import { goto, invalidate } from "$app/navigation";
	import { onMount } from "svelte";
	import type { Notification, NotificationList } from "#lib/api-types.ts";
	import { api } from "#lib/api.ts";
	import { absoluteDate, relativeDate } from "#lib/dates.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import Icon from "#lib/components/Icon.svelte";
	import UserLink from "#lib/components/UserLink.svelte";
	import { dismiss } from "#lib/components/dismiss.ts";
	
	interface Props {
		unread: number;
	}

	let { unread }: Props = $props();

	let open = $state(false);
	let tab = $state<"direct" | "watching">("direct");
	let unreadCount = $derived(unread);
	let list = $state<Notification[] | null>(null);
	let loading = $state(false);
	let markAllPending = $state(false);
	let trigger: HTMLButtonElement;

	async function loadList() {
		const requested = tab;
		loading = true;
		try {
			const result = await api<NotificationList>(
				`/api/notifications?tab=${requested}&limit=20`,
			);
			if (tab === requested) list = result.notifications;
		} catch {
			if (tab === requested) list = [];
		} finally {
			if (tab === requested) loading = false;
		}
	}

	function toggle() {
		open = !open;
		if (open) {
			list = null;
			void loadList();
		}
	}

	function setTab(next: "direct" | "watching") {
		if (tab === next) return;
		tab = next;
		list = null;
		void loadList();
	}

	async function markAll() {
		if (unreadCount === 0 || markAllPending) return;
		markAllPending = true;
		try {
			await api("/api/notifications/mark-all-read", { method: "POST" });
			unreadCount = 0;
			await invalidate("app:notifications");
			await loadList();
		} catch {
			// The bell keeps its count when the request fails.
		} finally {
			markAllPending = false;
		}
	}

	async function openNotification(notification: Notification) {
		try {
			await api(`/api/notifications/${notification.id}/read`, {
				method: "POST",
			});
		} catch {
			// Navigation still wins over a failed read receipt.
		}
		// The issue page is a client navigation: the bell needs the new count first.
		await invalidate("app:notifications");
		open = false;
		void goto(`/browse/${notification.issue.key}`);
	}

	onMount(() => {
		function refresh() {
			if (document.visibilityState === "hidden") return;
			void invalidate("app:notifications");
			if (open) void loadList();
		}
		const timer = window.setInterval(refresh, 60 * 1000);
		window.addEventListener("focus", refresh);
		return () => {
			window.clearInterval(timer);
			window.removeEventListener("focus", refresh);
		};
	});
</script>

<div
	class="bell"
	{@attach dismiss(() => open, () => (open = false), () => trigger)}
>
	<button
		bind:this={trigger}
		type="button"
		class="bell-button"
		aria-label={unreadCount > 0
			? `Notifications, ${unreadCount} unread`
			: "Notifications"}
		aria-haspopup="dialog"
		aria-expanded={open}
		onclick={toggle}
	>
		<Icon name="bell" />
		{#if unreadCount > 0}
			<span class="badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
		{/if}
	</button>

	{#if open}
		<div role="dialog" aria-label="Notifications" class="panel">
			<div class="panel-header">
				<strong>Notifications</strong>
				<button
					type="button"
					class="mark-all"
					onclick={() => void markAll()}
					disabled={unreadCount === 0 || markAllPending}
				>
					Mark all as read
				</button>
			</div>

			<div class="tabs">
				<button
					type="button"
					class="tab"
					class:active={tab === "direct"}
					onclick={() => setTab("direct")}
				>
					Direct
				</button>
				<button
					type="button"
					class="tab"
					class:active={tab === "watching"}
					onclick={() => setTab("watching")}
				>
					Watching
				</button>
			</div>

			<div class="list">
				{#if loading}
					<p class="loading">Loading…</p>
				{:else if list && list.length > 0}
					{#each list as notification (notification.id)}
						<div class="item">
							<span
								class="dot"
								class:unread={!notification.read}
							></span>
							{#if notification.actor}
								<span class="actor-link">
									<UserLink
										username={notification.actor.username}
										aria-label={`View ${notification.actor.displayName}'s profile`}
									>
										<Avatar user={notification.actor} size={24} />
									</UserLink>
								</span>
							{:else}
								<span class="avatar-spacer"></span>
							{/if}
							<button
								type="button"
								class="item-button"
								onclick={() => void openNotification(notification)}
							>
								<span class="body">
									<span class="line">
										{#if notification.actor}
											<span class="actor-name">
												{notification.actor.displayName}
											</span>
										{:else}
											Someone
										{/if}
										{notification.action}
										<strong>{notification.issue.key}</strong>
									</span>
									<span class="summary">{notification.issue.summary}</span>
									<span class="time" title={absoluteDate(notification.created)}
										>{relativeDate(notification.created)}</span
									>
								</span>
							</button>
						</div>
					{/each}
				{:else}
					<p class="empty">No notifications</p>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.bell {
		position: relative;
	}

	.bell-button {
		position: relative;
		width: 32px;
		height: 32px;
		padding: 4px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text-subtle);
		cursor: pointer;
	}

	.badge {
		position: absolute;
		top: 1px;
		right: 0;
		min-width: 16px;
		height: 16px;
		padding: 0 4px;
		border-radius: 8px;
		background-color: var(--ds-background-danger-bold);
		color: var(--ds-text-inverse);
		font-size: 11px;
		font-weight: 700;
		line-height: 16px;
		text-align: center;
	}

	.panel {
		position: absolute;
		top: 36px;
		right: 0;
		z-index: 100;
		width: 420px;
		max-width: calc(100vw - 24px);
		background-color: var(--ds-surface-overlay);
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		box-shadow: var(--ds-shadow-overlay);
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px 0;
	}

	.panel-header strong {
		font-size: 16px;
		font-weight: 600;
	}

	.mark-all {
		padding: 0;
		background: transparent;
		border: 0;
		color: var(--ds-link);
		font-size: 13px;
		cursor: pointer;
	}

	.mark-all:disabled {
		color: var(--ds-text-disabled);
		cursor: default;
	}

	.tabs {
		display: flex;
		gap: 18px;
		padding: 4px 16px 0;
	}

	.tab {
		padding: 8px 0;
		margin-bottom: -1px;
		background: transparent;
		border: 0;
		border-bottom: 2px solid transparent;
		color: var(--ds-text-subtle);
		font-weight: 400;
		cursor: pointer;
		font-size: 14px;
	}

	.tab.active {
		border-bottom-color: var(--ds-border-selected);
		color: var(--ds-text);
		font-weight: 600;
	}

	.list {
		max-height: 420px;
		overflow-y: auto;
	}

	.loading {
		margin: 0;
		padding: 16px;
		color: var(--ds-text-subtle);
	}

	.empty {
		margin: 0;
		padding: 20px 16px;
		color: var(--ds-text-subtle);
	}

	.item {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 10px 16px;
		border-bottom: 1px solid var(--ds-border);
	}

	.actor-link {
		display: inline-flex;
		flex: none;
	}

	.item-button {
		flex: 1;
		min-width: 0;
		padding: 0;
		background: transparent;
		border: 0;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.dot {
		width: 8px;
		height: 8px;
		margin-top: 6px;
		flex: none;
		border-radius: 50%;
		background-color: transparent;
	}

	.dot.unread {
		background-color: var(--ds-background-brand-bold);
	}

	.avatar-spacer {
		width: 24px;
		flex: none;
	}

	.body {
		min-width: 0;
		flex: 1;
		text-align: left;
	}

	.line {
		display: block;
	}

	.line strong {
		font-weight: 600;
	}

	.summary {
		display: block;
		color: var(--ds-text-subtle);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.time {
		display: block;
		margin-top: 2px;
		font-size: 12px;
		color: var(--ds-text-subtlest);
	}
</style>
