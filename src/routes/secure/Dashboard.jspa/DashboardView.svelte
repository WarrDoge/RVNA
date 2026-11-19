<script lang="ts">
	import { page } from "$app/state";
	import { invalidate } from "$app/navigation";
	import { token } from "#lib/tokens.ts";
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";
	import {
		type DashboardLayout,
		layoutColumns,
		layoutWidths,
	} from "#lib/shared/gadgets.ts";
	import AddGadgetDialog from "./AddGadgetDialog.svelte";
	import CopyDashboardDialog from "./CopyDashboardDialog.svelte";
	import CreateDashboardDialog from "#lib/dashboards/CreateDashboardDialog.svelte";
	import DashboardMenu from "./DashboardMenu.svelte";
	import DashboardSettingsDialog from "./DashboardSettingsDialog.svelte";
	import DeleteDashboardDialog from "#lib/dashboards/DeleteDashboardDialog.svelte";
	import GadgetCard from "./GadgetCard.svelte";
	import GadgetConfigDialog from "./GadgetConfigDialog.svelte";
	import {
		columnIds,
		dashboardHref,
		errorMessage,
	} from "#lib/dashboards/gadget-helpers.ts";
	import type {
		Dashboard,
		DashboardDetail,
		Gadget,
		GadgetDataEntry,
	} from "#lib/dashboards/types.ts";

	interface Props {
		dashboard: DashboardDetail;
		favourites: Dashboard[];
		gadgetData: Record<string, GadgetDataEntry>;
	}

	let { dashboard, favourites, gadgetData }: Props = $props();

	const COLUMN_NAMES = ["left", "middle", "right"];

	const isAdmin = $derived(page.data.user?.isAdmin ?? false);
	const columns = $derived(layoutColumns(dashboard.layout as DashboardLayout));
	const widths = $derived(layoutWidths(dashboard.layout as DashboardLayout));
	const ids = $derived(columnIds(dashboard.gadgets, columns));

	let adding = $state(false);
	let editing = $state(false);
	let copying = $state(false);
	let creating = $state(false);
	let deleting = $state(false);
	let configuring = $state<Gadget | null>(null);
	let dragging = $state<string | null>(null);
	let dropTarget = $state<{ column: number; index: number } | null>(null);
	let error = $state<string | null>(null);

	async function refresh() {
		await invalidate("app:dashboard");
	}

	async function drop(column: number, index: number) {
		const dragged = dragging;
		if (!dragged) return;
		const next = ids.map((columnIdsForWidth) => [...columnIdsForWidth]);
		const from = next.findIndex((columnIdsForWidth) =>
			columnIdsForWidth.includes(dragged),
		);
		if (from < 0) return;
		const fromIndex = next[from].indexOf(dragged);
		next[from].splice(fromIndex, 1);
		let target = index;
		if (from === column && fromIndex < index) target -= 1;
		const destination = next[column] ?? [];
		destination.splice(
			Math.min(Math.max(0, target), destination.length),
			0,
			dragged,
		);
		next[column] = destination;
		try {
			await api(`/api/dashboards/${dashboard.id}/layout`, {
				method: "PUT",
				body: JSON.stringify({ columns: next }),
			});
			dragging = null;
			dropTarget = null;
			await refresh();
		} catch (cause) {
			dragging = null;
			dropTarget = null;
			error = errorMessage(cause);
		}
	}

	async function removeGadget(gadget: Gadget) {
		try {
			await api(`/api/gadgets/${gadget.id}`, { method: "DELETE" });
			await refresh();
		} catch (cause) {
			error = errorMessage(cause);
		}
	}

	function onDragStart(gadget: Gadget, event: DragEvent) {
		dragging = gadget.id;
		if (!event.dataTransfer) return;
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("text/plain", gadget.id);
	}

	function onDragEnd() {
		dragging = null;
		dropTarget = null;
	}
</script>

<section class="page">
	<div class="header">
		<h1>{dashboard.name}</h1>
		<span class="visibility" title={`Owned by ${dashboard.owner.displayName}`}>
			{dashboard.shared ? "Shared" : "Private"}
		</span>
		<div class="header-actions">
			{#if dashboard.canEdit}
				<Button appearance="primary" onclick={() => (adding = true)}>
					Add gadget
				</Button>
			{/if}
			<DashboardMenu
				{dashboard}
				onEdit={() => (editing = true)}
				onCopy={() => (copying = true)}
				onCreate={() => (creating = true)}
				onDelete={() => (deleting = true)}
				onError={(message) => (error = message)}
			/>
		</div>
	</div>

	{#if error}
		<p role="alert" class="error">{error}</p>
	{/if}

	<div class="layout">
		{#if favourites.length > 0}
			<nav aria-label="Favourite dashboards" class="favourites">
				<div class="favourites-title">Favourite dashboards</div>
				{#each favourites as favourite (favourite.id)}
					<a
						href={dashboardHref(favourite)}
						class="favourite"
						class:active={favourite.id === dashboard.id}
					>
						{favourite.name}
					</a>
				{/each}
				<a class="manage" href="/secure/ConfigurePortalPages!default.jspa">
					Manage dashboards
				</a>
			</nav>
		{/if}

		<div class="columns">
			{#each ids as columnIdsForWidth, column (COLUMN_NAMES[column] ?? column)}
				<!-- biome-ignore lint/a11y/noStaticElementInteractions: a column is a drop target; gadgets move with the pointer and keep their position -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="column"
					data-dashboard-column={column}
					style="width: {widths[column] * 100}%; min-width: 0;"
					ondragover={(event) => {
						if (!dragging) return;
						event.preventDefault();
						dropTarget = { column, index: columnIdsForWidth.length };
					}}
					ondrop={(event) => {
						event.preventDefault();
						void drop(column, columnIdsForWidth.length);
					}}
				>
					{#each columnIdsForWidth as id, index (id)}
						{@const gadget = dashboard.gadgets.find((item) => item.id === id)}
						{#if gadget}
							<!-- biome-ignore lint/a11y/noStaticElementInteractions: the row is a drop target; the gadget header is the drag handle -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="row"
								data-gadget-id={gadget.id}
								data-gadget-column={column}
								data-gadget-row={index}
								style="border-top: {dropTarget?.column === column &&
								dropTarget.index === index
									? `2px solid ${token('color.border.selected')}`
									: '2px solid transparent'};"
								ondragover={(event) => {
									if (!dragging || dragging === gadget.id) return;
									event.preventDefault();
									event.stopPropagation();
									dropTarget = { column, index };
								}}
								ondrop={(event) => {
									event.preventDefault();
									event.stopPropagation();
									void drop(column, index);
								}}
							>
								<GadgetCard
									{gadget}
									{dashboard}
									canEdit={dashboard.canEdit}
									{isAdmin}
									dragging={dragging === gadget.id}
									entry={gadgetData[gadget.id] ?? { error: "Something went wrong" }}
									ondragstart={(event) => onDragStart(gadget, event)}
									ondragend={onDragEnd}
									onconfigure={() => (configuring = gadget)}
									ondelete={() => void removeGadget(gadget)}
								/>
							</div>
						{/if}
					{/each}
					{#if dashboard.canEdit}
						<button
							type="button"
							class="add-column"
							onclick={() => (adding = true)}
						>
							+ Add gadget
						</button>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	{#if adding}
		<AddGadgetDialog
			{dashboard}
			onClose={() => (adding = false)}
			onAdded={() => void refresh()}
		/>
	{/if}
	{#if editing}
		<DashboardSettingsDialog
			{dashboard}
			intent="update"
			onClose={() => (editing = false)}
			onsuccess={() => (editing = false)}
		/>
	{/if}
	{#if copying}
		<CopyDashboardDialog
			{dashboard}
			intent="copy"
			onClose={() => (copying = false)}
		/>
	{/if}
	{#if creating}
		<CreateDashboardDialog
			intent="create"
			onClose={() => (creating = false)}
		/>
	{/if}
	{#if deleting}
		<DeleteDashboardDialog
			{dashboard}
			intent="delete"
			onClose={() => (deleting = false)}
		/>
	{/if}
	{#if configuring}
		<GadgetConfigDialog
			gadget={configuring}
			{isAdmin}
			onClose={() => (configuring = null)}
		/>
	{/if}
</section>

<style>
	.page {
		padding: 12px 24px 40px;
	}
	.header {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 56px;
	}
	h1 {
		margin: 0;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text);
	}
	.visibility {
		font-size: 12px;
		color: var(--ds-text-subtle);
	}
	.header-actions {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.error {
		color: #e5493a;
		margin-top: 0;
	}
	.layout {
		display: flex;
		gap: 16px;
		align-items: flex-start;
	}
	.favourites {
		width: 180px;
		flex: none;
		padding-top: 4px;
	}
	.favourites-title {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--ds-text-subtle);
		padding: 0 8px 6px;
	}
	.favourite {
		display: block;
		padding: 6px 8px;
		border-radius: 3px;
		text-decoration: none;
		color: var(--ds-text-subtle);
		font-size: 14px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.favourite.active {
		color: var(--ds-text);
		background: var(--ds-background-selected);
	}
	.manage {
		display: block;
		margin-top: 8px;
		padding: 6px 8px;
		color: var(--ds-link);
		font-size: 13px;
		text-decoration: none;
	}
	.columns {
		display: flex;
		gap: 16px;
		flex: 1;
		min-width: 0;
	}
	.row {
		margin-bottom: 12px;
	}
	.add-column {
		width: 100%;
		padding: 8px 0;
		background: transparent;
		border: 1px dashed var(--ds-border);
		border-radius: 3px;
		color: var(--ds-text-subtle);
		cursor: pointer;
		font-size: 13px;
	}
</style>
