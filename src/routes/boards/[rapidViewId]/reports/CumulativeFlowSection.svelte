<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import type { CumulativeFlowPayload } from "#lib/api-types.ts";
	import { daysAgo, today } from "#lib/boards/reports.ts";
	import CumulativeFlowChart from "#lib/charts/CumulativeFlowChart.svelte";
	import ReportHeader from "./ReportHeader.svelte";

	interface Props {
		boardName: string;
		initial: CumulativeFlowPayload | null;
		initialError: string | null;
	}

	let { boardName, initial, initialError }: Props = $props();

	let flow = $derived(initial);
	let from = $derived(
		page.url.searchParams.get("from") ?? flow?.from ?? daysAgo(13),
	);
	let to = $derived(page.url.searchParams.get("to") ?? flow?.to ?? today());
	let assignee = $derived(
		page.url.searchParams.get("assignee") ?? undefined,
	);
	let hiddenColumns = $derived(
		new Set(
			(page.url.searchParams.get("hidden") ?? "")
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean),
		),
	);
	let error = $derived(initialError);

	let visibleColumnIds = $derived.by(() => {
		const all = new Set(flow?.columns.map((column) => column.id) ?? []);
		for (const id of hiddenColumns) all.delete(id);
		return all;
	});

	function address(update: (params: URLSearchParams) => void) {
		const url = new URL(page.url.href);
		update(url.searchParams);
		return url;
	}

	function load(update: (params: URLSearchParams) => void) {
		void goto(address(update), {
			replace: true,
			reset: false,
		});
	}

	function setParam(name: string, value: string) {
		load((params) => {
			if (value) params.set(name, value);
			else params.delete(name);
		});
	}

	function preset(days: number) {
		load((params) => {
			params.set("from", daysAgo(days - 1));
			params.set("to", today());
		});
	}

	function toggleColumn(id: string, checked: boolean) {
		const hidden = new Set(hiddenColumns);
		if (checked) hidden.delete(id);
		else hidden.add(id);
		void goto(
			address((params) => {
				if (hidden.size > 0) params.set("hidden", [...hidden].join(","));
				else params.delete("hidden");
			}),
			{ shallow: true, replace: true },
		);
	}
</script>

<ReportHeader {boardName} title="Cumulative Flow Diagram" />

<div class="controls">
	<div class="presets">
		{#each [7, 14, 30] as days (days)}
			<button type="button" onclick={() => preset(days)}>
				Last {days} days
			</button>
		{/each}
	</div>
	<label class="control">
		<span class="label">From</span>
		<input
			class="input"
			type="date"
			bind:value={() => from, (value) => setParam("from", value)}
		/>
	</label>
	<label class="control">
		<span class="label">To</span>
		<input
			class="input"
			type="date"
			bind:value={() => to, (value) => setParam("to", value)}
		/>
	</label>
	<label class="control">
		<span class="label">Swimlane</span>
		<select
			class="select"
			aria-label="Swimlane"
			bind:value={() => assignee ?? "", (value) => setParam("assignee", value)}
		>
			<option value="">All assignees</option>
			{#each flow?.assignees ?? [] as name (name)}
				<option value={name}>{name}</option>
			{/each}
		</select>
	</label>
</div>

{#if error}
	<p class="alert" role="alert">{error}</p>
{/if}

{#if flow}
	<div class="columns">
		{#each flow.columns as column (column.id)}
			<label class="column-toggle">
				<input
					type="checkbox"
					bind:checked={() => !hiddenColumns.has(column.id), (value) =>
						toggleColumn(column.id, value)}
				/>
				{column.name}
			</label>
		{/each}
	</div>
	<div class="chart-card">
		<CumulativeFlowChart data={flow} {visibleColumnIds} />
	</div>
{/if}

<style>
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 12px;
		margin-bottom: 12px;
	}

	.presets {
		display: flex;
		gap: 4px;
	}

	.presets button {
		height: 30px;
		padding: 0 10px;
		background: var(--ds-background-neutral, #2c333a);
		border: 1px solid var(--ds-border, #3b3d42);
		border-radius: 3px;
		color: var(--ds-text, #cecfd2);
		cursor: pointer;
		font-size: 13px;
	}

	.control {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.label {
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 12px;
	}

	.input {
		height: 30px;
		padding: 0 8px;
		background-color: var(--ds-background-input, #1d2125);
		border: 1px solid var(--ds-border-input, #738496);
		border-radius: 3px;
		color: var(--ds-text, #cecfd2);
		font-size: 14px;
	}

	.select {
		height: 32px;
		padding: 0 8px;
		background-color: var(--ds-background-input, #1d2125);
		border: 1px solid var(--ds-border-input, #738496);
		border-radius: 3px;
		color: var(--ds-text, #cecfd2);
		font-size: 14px;
	}

	.alert {
		color: var(--ds-text-danger, #fd9891);
	}

	.columns {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-bottom: 8px;
	}

	.column-toggle {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 12px;
	}

	.chart-card {
		padding: 12px 8px 4px;
		background-color: var(--ds-surface-raised, #22272b);
		border: 1px solid var(--ds-border, #3b3d42);
		border-radius: 3px;
	}
</style>
