<script lang="ts">
	import { invalidate } from "$app/navigation";
	import { type TokenName, token } from "#lib/tokens.ts";
	import { api } from "#lib/api.ts";
	import { dismiss } from "#lib/components/dismiss.ts";
	import Icon from "#lib/components/Icon.svelte";
	import { GADGET_COLORS, gadgetTitle } from "#lib/shared/gadgets.ts";
	import GadgetBody from "./GadgetBody.svelte";
	import { colourBackground, errorMessage } from "#lib/dashboards/gadget-helpers.ts";
	import type {
		DashboardDetail,
		Gadget,
		GadgetData,
		GadgetDataEntry,
	} from "#lib/dashboards/types.ts";

	interface Props {
		gadget: Gadget;
		dashboard: DashboardDetail;
		canEdit: boolean;
		isAdmin: boolean;
		dragging: boolean;
		entry: GadgetDataEntry;
		ondragstart: (event: DragEvent) => void;
		ondragend: () => void;
		onconfigure: () => void;
		ondelete: () => void;
	}

	let {
		gadget,
		dashboard,
		canEdit,
		isAdmin,
		dragging,
		entry,
		ondragstart,
		ondragend,
		onconfigure,
		ondelete,
	}: Props = $props();

	let minimised = $state(false);
	let colourOpen = $state(false);
	let startAt = $state(0);
	let loading = $state(false);
	let requestId = 0;
	let overrideEntry: GadgetDataEntry | null = null;
	let override = $state<{
		data: GadgetData | null;
		error: string | null;
	} | null>(null);

	const title = $derived(gadget.title ?? gadgetTitle(gadget.type));
	const introduction = $derived(gadget.type === "introduction");
	const background = $derived(colourBackground(gadget.color));
	const current = $derived.by(() => {
		const value = override;
		return overrideEntry === entry ? value : null;
	});
	const data = $derived(
		current ? current.data : "data" in entry ? entry.data : null,
	);
	const loadError = $derived(
		current ? current.error : "error" in entry ? entry.error : null,
	);

	async function fetchData(at: number, paging = false) {
		const requestEntry = entry;
		const previousData = data;
		const id = ++requestId;
		if (paging) {
			loading = true;
			overrideEntry = requestEntry;
			override = { data: null, error: null };
		}
		try {
			const result = await api<GadgetData>(
				`/api/gadgets/${gadget.id}/data?startAt=${at}`,
			);
			if (id !== requestId) return;
			overrideEntry = requestEntry;
			override = { data: result, error: null };
		} catch (cause) {
			if (id !== requestId) return;
			overrideEntry = requestEntry;
			override = {
				data: paging ? null : previousData,
				error: errorMessage(cause),
			};
		} finally {
			if (id === requestId) loading = false;
		}
	}

	$effect(() => {
		const seconds = gadget.refreshSeconds;
		if (seconds <= 0) return;
		const timer = setInterval(() => {
			if (!document.hidden) void fetchData(startAt);
		}, seconds * 1000);
		function onVisibility() {
			if (!document.hidden) void fetchData(startAt);
		}
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	});

	function onStartAt(next: number) {
		startAt = next;
		void fetchData(next, true);
	}

	function refresh() {
		void fetchData(startAt);
	}

	async function setColour(value: string) {
		colourOpen = false;
		try {
			await api(`/api/gadgets/${gadget.id}`, {
				method: "PATCH",
				body: JSON.stringify({ color: value }),
			});
			await invalidate("app:dashboard");
		} catch {
			// A failed colour change leaves the colour as it was.
		}
	}
</script>

<div
	class="card"
	style="background-color: {background}; border: 1px solid {token(
		'color.border',
	)}; border-radius: 3px; opacity: {dragging ? 0.4 : 1};"
>
	<!-- biome-ignore lint/a11y/noStaticElementInteractions: the header is the drag handle; every gadget action is also a button -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="handle"
		draggable={canEdit}
		data-gadget-handle={gadget.id}
		ondragstart={ondragstart}
		ondragend={ondragend}
		style="border-bottom: {minimised
			? 'none'
			: `1px solid ${token('color.border')}`}; cursor: {canEdit
			? 'grab'
			: 'default'};"
	>
		<span class="title">{title}</span>
		<div class="actions">
			<button
				type="button"
				class="icon-button"
				aria-label={minimised ? `Expand ${title}` : `Minimise ${title}`}
				onclick={() => (minimised = !minimised)}
			>
				{#if minimised}
					<Icon name="chevron-down" />
				{:else}
					<Icon name="chevron-up" />
				{/if}
			</button>
			{#if canEdit}
				<div
					class="colour-wrap"
					{@attach dismiss(() => colourOpen, () => (colourOpen = false))}
				>
					<button
						type="button"
						class="icon-button"
						aria-label={`Colour of ${title}`}
						title="Change colour"
						aria-haspopup="true"
						aria-expanded={colourOpen}
						onclick={() => (colourOpen = !colourOpen)}
					>
						<span class="swatch" aria-hidden="true"></span>
					</button>
					{#if colourOpen}
						<div class="colour-popup">
							{#each GADGET_COLORS as colour (colour.value)}
								<button
									type="button"
									aria-label={colour.label}
									onclick={() => void setColour(colour.value)}
									style="background: {token(colour.background as TokenName)};"
								></button>
							{/each}
						</div>
					{/if}
				</div>
				{#if !introduction || isAdmin}
					<button
						type="button"
						class="icon-button"
						aria-label={`Configure ${title}`}
						title="Configure"
						onclick={onconfigure}
					>
						<Icon name="settings" size={14} />
					</button>
				{/if}
			{/if}
			<button
				type="button"
				class="icon-button"
				aria-label={`Refresh ${title}`}
				onclick={refresh}
			>
				<Icon name="refresh" />
			</button>
			{#if canEdit}
				<button
					type="button"
					class="icon-button"
					aria-label={`Delete ${title}`}
					onclick={ondelete}
				>
					×
				</button>
			{/if}
		</div>
	</div>
	{#if !minimised}
		<div class="body">
			{#if loading || (!data && !loadError)}
				<p class="loading">Loading…</p>
			{/if}
			{#if loadError}
				<p role="alert" class="error">{loadError}</p>
			{/if}
			{#if data}
				<GadgetBody {data} {onStartAt} />
			{/if}
		</div>
	{/if}
	{#if data && data.refreshSeconds > 0}
		<div class="refresh-note">
			Refreshes every {Math.round(data.refreshSeconds / 60)} min ·{" "}
			{dashboard.name}
		</div>
	{/if}
</div>

<style>
	.handle {
		display: flex;
		align-items: center;
		gap: 4px;
		height: 32px;
		padding: 0 6px 0 10px;
	}
	.title {
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.actions {
		margin-left: auto;
		display: flex;
		align-items: center;
	}
	.icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text-subtle);
		cursor: pointer;
	}
	.colour-wrap {
		position: relative;
	}
	.swatch {
		width: 12px;
		height: 12px;
		border-radius: 3px;
		background: linear-gradient(
			135deg,
			var(--ds-background-accent-blue-subtle) 50%,
			var(--ds-background-accent-orange-subtle) 50%
		);
	}
	.colour-popup {
		position: absolute;
		top: 26px;
		right: 0;
		z-index: 20;
		display: flex;
		gap: 4px;
		padding: 6px;
		background-color: var(--ds-surface-overlay);
		border: 1px solid var(--ds-border);
		border-radius: 3px;
	}
	.colour-popup button {
		width: 18px;
		height: 18px;
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		cursor: pointer;
	}
	.body {
		padding: 10px;
		min-height: 40px;
	}
	.loading {
		margin: 0;
		color: var(--ds-text-subtle);
	}
	.error {
		margin: 0;
		color: #e5493a;
	}
	.refresh-note {
		padding: 0 10px 6px;
		font-size: 11px;
		color: var(--ds-text-subtle);
	}
</style>
