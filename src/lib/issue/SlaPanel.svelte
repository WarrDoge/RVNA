<script lang="ts">
	import Module from "#lib/components/Module.svelte";
	import { formatGoal, formatSlaMinutes } from "./panels-format.ts";
	import type { SlaCycle, SlaMetric, SlaState } from "./panels-types.ts";

	interface Props {
		data: { metrics: SlaMetric[] } | null;
	}

	let { data }: Props = $props();

	const stateLabels: Record<SlaState, string> = {
		ongoing: "Ongoing",
		paused: "Paused",
		completed: "Completed",
		breached: "Breached",
	};

	function activeCycle(metric: SlaMetric): SlaCycle | null {
		return (
			metric.cycles.find(
				(cycle) => cycle.state === "ongoing" || cycle.state === "paused",
			) ??
			metric.cycles[metric.cycles.length - 1] ??
			null
		);
	}

	function stateColor(state: SlaState) {
		if (state === "breached") return "#e5493a";
		if (state === "paused") return "#f5a623";
		if (state === "completed") return "#2abb7f";
		return "var(--ds-text, #172b4d)";
	}
</script>

{#if data && data.metrics.length > 0}
	<Module title="SLAs">
		<div class="list">
			{#each data.metrics as metric (metric.id)}
				{@const cycle = activeCycle(metric)}
				{#if cycle}
					{@const goal = cycle.goalMinutes}
					{@const percent =
						goal && goal > 0
							? Math.min(100, Math.round((cycle.elapsedMinutes / goal) * 100))
							: 0}
					{@const color = stateColor(cycle.state)}
					{@const shown =
						cycle.state === "completed"
							? `${formatSlaMinutes(cycle.elapsedMinutes)} elapsed`
							: `${formatSlaMinutes(cycle.remainingMinutes)} left`}
					{@const tooltip = [
						`Goal ${formatGoal(goal)}`,
						metric.calendar
							? `${metric.calendar.name} (${metric.calendar.timezone})`
							: "no calendar",
						stateLabels[cycle.state],
					].join(" · ")}
					<div title={tooltip}>
						<div class="heading">
							<span class="name">{metric.name}</span>
							<span class="state" style="color: {color};">
								{stateLabels[cycle.state]}
							</span>
						</div>
						<div class="remaining" style="color: {color};">
							<strong>{shown}</strong>
							{#if cycle.state !== "completed"}
								<span class="of"> of {formatGoal(goal)}</span>
							{/if}
						</div>
						<div class="bar">
							<div
								class="fill"
								style="width: {percent}%; background-color: {color};"
							></div>
						</div>
					</div>
				{/if}
			{/each}
		</div>
	</Module>
{/if}

<style>
	.list {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.heading {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}

	.name {
		font-size: 14px;
	}

	.state {
		margin-left: auto;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.4px;
	}

	.remaining {
		margin-top: 2px;
	}

	.of {
		color: var(--ds-text-subtle, #596773);
		font-weight: 400;
	}

	.bar {
		margin-top: 6px;
		height: 6px;
		border-radius: 3px;
		background-color: var(--ds-background-neutral, #0515240f);
		overflow: hidden;
	}

	.fill {
		height: 100%;
	}
</style>
