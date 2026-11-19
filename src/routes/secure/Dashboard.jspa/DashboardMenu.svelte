<script lang="ts">
	import { invalidate } from "$app/navigation";
	import { api } from "#lib/api.ts";
	import { dismiss } from "#lib/components/dismiss.ts";
	import Icon from "#lib/components/Icon.svelte";
	import { errorMessage } from "#lib/dashboards/gadget-helpers.ts";
	import type { DashboardDetail } from "#lib/dashboards/types.ts";

	interface Props {
		dashboard: DashboardDetail;
		onEdit: () => void;
		onCopy: () => void;
		onCreate: () => void;
		onDelete: () => void;
		onError: (message: string) => void;
	}

	let { dashboard, onEdit, onCopy, onCreate, onDelete, onError }: Props =
		$props();

	let open = $state(false);

	async function setShared(shared: boolean) {
		try {
			await api(`/api/dashboards/${dashboard.id}`, {
				method: "PATCH",
				body: JSON.stringify({ shared }),
			});
			await invalidate("app:dashboard");
		} catch (cause) {
			onError(errorMessage(cause));
		}
	}

	async function setFavourite(favourite: boolean) {
		try {
			await api(`/api/dashboards/${dashboard.id}/favourite`, {
				method: favourite ? "PUT" : "DELETE",
			});
			await invalidate("app:dashboard");
		} catch (cause) {
			onError(errorMessage(cause));
		}
	}
</script>

<div
	class="menu-container"
	{@attach dismiss(() => open, () => (open = false))}
>
	<button
		type="button"
		class="kebab"
		aria-label="Dashboard actions"
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<Icon name="kebab" />
	</button>
	{#if open}
		<div role="menu" aria-label="Dashboard actions" class="menu">
			<button
				type="button"
				role="menuitem"
				class="item"
				onclick={() => {
					open = false;
					void setFavourite(!dashboard.favourite);
				}}
			>
				{dashboard.favourite ? "Remove from favourites" : "Add to favourites"}
			</button>
			{#if dashboard.canEdit}
				<button
					type="button"
					role="menuitem"
					class="item"
					onclick={() => {
						open = false;
						onEdit();
					}}
				>
					Edit dashboard
				</button>
			{/if}
			<button
				type="button"
				role="menuitem"
				class="item"
				onclick={() => {
					open = false;
					onCopy();
				}}
			>
				Copy dashboard
			</button>
			{#if dashboard.canEdit}
				<button
					type="button"
					role="menuitem"
					class="item"
					onclick={() => {
						open = false;
						void setShared(!dashboard.shared);
					}}
				>
					{dashboard.shared ? "Stop sharing dashboard" : "Share dashboard"}
				</button>
			{/if}
			<button
				type="button"
				role="menuitem"
				class="item"
				onclick={() => {
					open = false;
					onCreate();
				}}
			>
				Create dashboard
			</button>
			{#if dashboard.canEdit}
				<button
					type="button"
					role="menuitem"
					class="item danger"
					onclick={() => {
						open = false;
						onDelete();
					}}
				>
					Delete dashboard
				</button>
			{/if}
			<a
				role="menuitem"
				href="/secure/ConfigurePortalPages!default.jspa"
				class="item link"
			>
				Manage dashboards
			</a>
		</div>
	{/if}
</div>

<style>
	.menu-container {
		position: relative;
	}
	.kebab {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text-subtle);
		cursor: pointer;
	}
	.menu {
		position: absolute;
		top: 34px;
		right: 0;
		z-index: 100;
		width: 220px;
		padding-block: 4px;
		background-color: var(--ds-surface-overlay);
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		box-shadow: var(--ds-shadow-overlay);
	}
	.item {
		display: block;
		width: 100%;
		padding: 6px 12px;
		background: transparent;
		border: 0;
		text-align: left;
		color: var(--ds-text);
		font-size: 14px;
		cursor: pointer;
	}
	.item.danger {
		color: #e5493a;
	}
	.item.link {
		text-decoration: none;
	}
</style>
