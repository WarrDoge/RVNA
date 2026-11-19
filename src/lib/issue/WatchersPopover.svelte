<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { IssueDetail, Me, UserRef } from "#lib/api-types.ts";
	import { api } from "#lib/api.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import Icon from "#lib/components/Icon.svelte";
	import UserLink from "#lib/components/UserLink.svelte";
	import { dismiss } from "#lib/components/dismiss.ts";
	import UserSelect from "#lib/issue-form/UserSelect.svelte";

	interface Props {
		issue: IssueDetail;
		me: Me | null;
		canManage: boolean;
		canView: boolean;
		onChanged: () => Promise<void>;
		onError: (message: string) => void;
	}

	let { issue, me, canManage, canView, onChanged, onError }: Props = $props();

	let open = $state(false);
	let error = $state<string | null>(null);
	let watchers = $state.raw<UserRef[] | null>(null);
	let loading = $state(false);
	let requestVersion = 0;

	function errorMessage(cause: unknown) {
		return cause instanceof Error ? cause.message : "Something went wrong";
	}

	async function loadWatchers() {
		const version = ++requestVersion;
		loading = true;
		try {
			const result = await api<{ watchers: UserRef[] }>(
				`/api/issues/${encodeURIComponent(issue.key)}/watchers`,
			);
			if (version === requestVersion) watchers = result.watchers;
		} catch (cause) {
			if (version === requestVersion) error = errorMessage(cause);
		} finally {
			if (version === requestVersion) loading = false;
		}
	}

	$effect(() => {
		if (open && canView) void loadWatchers();
	});

	async function refresh() {
		await loadWatchers();
		await onChanged();
	}

	async function run(operation: () => Promise<unknown>) {
		try {
			await operation();
			error = null;
			await refresh();
		} catch (cause) {
			const message = errorMessage(cause);
			error = message;
			onError(message);
		}
	}

	function addWatcher(user: UserRef | null) {
		if (!user) return;
		void run(() =>
			api(`/api/issues/${encodeURIComponent(issue.key)}/watchers`, {
				method: "POST",
				body: JSON.stringify({ userId: user.id }),
			}),
		);
	}

	function removeWatcher(userId: string) {
		void run(() =>
			api(
				`/api/issues/${encodeURIComponent(issue.key)}/watchers/${encodeURIComponent(userId)}`,
				{ method: "DELETE" },
			),
		);
	}

	function toggleWatching() {
		void run(() =>
			api(`/api/issues/${encodeURIComponent(issue.key)}/watch`, {
				method: issue.watchers.watching ? "DELETE" : "PUT",
			}),
		);
	}

	const rowStyle = "display: flex; gap: 8px; align-items: flex-start;";
	const labelStyle = `width: 82px; flex: none; color: ${token(
		"color.text.subtle",
	)}; font-size: 14px; line-height: 20px;`;
	const valueStyle = "min-width: 0; flex: 1;";
	const triggerStyle = `display: inline-flex; align-items: center; gap: 6px; padding: 0; background: transparent; border: 0; color: ${token(
		"color.text",
	)}; cursor: pointer;`;
	const iconStyle = `display: inline-flex; color: ${token("color.text.subtle")};`;
	const popupStyle = `position: absolute; top: 26px; left: 0; z-index: 100; width: 300px; padding: 8px; background-color: ${token(
		"elevation.surface.overlay",
	)}; border: 1px solid ${token(
		"color.border",
	)}; border-radius: 3px; box-shadow: ${token(
		"elevation.shadow.overlay",
	)};`;
	const popupTitleStyle = "padding: 4px 4px 6px; font-weight: 600;";
	const popupErrorStyle = `margin: 0 4px 6px; color: #e5493a; font-size: 12px;`;
	const popupMutedStyle = `margin: 4px; color: ${token("color.text.subtle")};`;
	const listStyle =
		"margin: 0; padding: 0; list-style: none; max-height: 200px; overflow-y: auto;";
	const itemStyle = "display: flex; align-items: center; gap: 6px; padding: 4px;";
	const userLinkStyle =
		"flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
	const removeStyle = `display: inline-flex; padding: 2px; background: transparent; border: 0; color: ${token(
		"color.text.subtle",
	)}; cursor: pointer;`;
	const addStyle = "margin-top: 8px;";
	const watchStyle = `padding: 0; background: transparent; border: 0; color: ${token(
		"color.link",
	)}; cursor: pointer; font-size: 12px; margin-top: 2px;`;
</script>

{#if !canView}
	<div style={rowStyle}>
		<div style={labelStyle}>Watchers</div>
		<div style={`color: ${token("color.text")};`}>{issue.watchers.count}</div>
	</div>
{:else}
	<div style={rowStyle}>
		<div style={labelStyle}>Watchers</div>
		<div style={valueStyle}>
			<div
				style="position: relative;"
				{@attach dismiss(() => open, () => (open = false))}
			>
				<button
					type="button"
					aria-label={`${issue.watchers.count} watchers`}
					aria-haspopup="dialog"
					aria-expanded={open}
					onclick={() => (open = !open)}
					style={triggerStyle}
				>
					<span style={iconStyle}><Icon name="eye" size={14} /></span>
					<span>{issue.watchers.count}</span>
				</button>

				{#if open}
					<div role="dialog" aria-label="Watchers" style={popupStyle}>
						<div style={popupTitleStyle}>Watchers ({issue.watchers.count})</div>
						{#if error}
							<p role="alert" style={popupErrorStyle}>{error}</p>
						{/if}
						{#if loading}
							<p style={popupMutedStyle}>Loading…</p>
						{:else if watchers && watchers.length > 0}
							<ul style={listStyle}>
								{#each watchers as user (user.id)}
									<li style={itemStyle}>
										<Avatar user={user} size={20} />
										<UserLink username={user.username} style={userLinkStyle}>
											{user.displayName}
										</UserLink>
										{#if canManage}
											<button
												type="button"
												aria-label={`Remove ${user.displayName}`}
												title={`Remove ${user.displayName}`}
												onclick={() => removeWatcher(user.id)}
												style={removeStyle}
											>
												<Icon name="close" size={12} />
											</button>
										{/if}
									</li>
								{/each}
							</ul>
						{:else}
							<p style={popupMutedStyle}>No watchers.</p>
						{/if}
						{#if canManage}
							<div style={addStyle}>
								<UserSelect
									label="Add watcher"
									value={null}
									onChange={addWatcher}
									{me}
								/>
							</div>
						{/if}
					</div>
				{/if}
			</div>
			{#if canManage}
				<button type="button" onclick={toggleWatching} style={watchStyle}>
					{issue.watchers.watching ? "Stop watching" : "Start watching"}
				</button>
			{/if}
		</div>
	</div>
{/if}
