<script lang="ts">
	import type {
		BurndownEventRow,
		EstimationField,
	} from "#lib/api-types.ts";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import { absoluteDate } from "#lib/dates.ts";
	import { formatEstimate } from "#lib/shared/agile-reports/types.ts";

	interface Props {
		events: BurndownEventRow[];
		estimation: EstimationField;
	}

	let { events, estimation }: Props = $props();

	function eventLabel(eventType: BurndownEventRow["eventType"]) {
		switch (eventType) {
			case "scope-added":
				return "Issue added to sprint";
			case "scope-removed":
				return "Issue removed from sprint";
			case "completed":
				return "Issue completed";
			case "reopened":
				return "Issue reopened";
			case "estimate-changed":
				return "Estimate changed";
		}
	}

	function eventColor(
		eventType: BurndownEventRow["eventType"],
	): "moved" | "removed" | "success" | "default" {
		switch (eventType) {
			case "scope-added":
				return "moved";
			case "scope-removed":
				return "removed";
			case "completed":
				return "success";
			case "reopened":
				return "moved";
			case "estimate-changed":
				return "default";
		}
	}
</script>

<div class="event-table">
	<table class="fat-table">
		<thead>
			<tr>
				<th class="head date-col">Date</th>
				<th class="head">Issue</th>
				<th class="head">Event</th>
				<th class="head right">Increase</th>
				<th class="head right">Decrease</th>
				<th class="head right">Remaining</th>
			</tr>
		</thead>
		<tbody>
			{#if events.length === 0}
				<tr>
					<td class="cell empty" colspan={6}>
						No scope, status or estimate changes in this sprint yet.
					</td>
				</tr>
			{:else}
				{#each events as event (`${event.at}-${event.issueKey}-${event.eventType}-${event.increase}-${event.decrease}`)}
					<tr>
						<td class="cell nowrap">{absoluteDate(event.at)}</td>
						<td class="cell"><a href={`/browse/${event.issueKey}`}>{event.issueKey}</a><span class="summary">{event.issueSummary}</span></td>
						<td class="cell">
							<Lozenge appearance={eventColor(event.eventType)}>
								{eventLabel(event.eventType)}
							</Lozenge>
						</td>
						<td class="cell right">
							{event.increase > 0
								? formatEstimate(event.increase, estimation)
								: "—"}
						</td>
						<td class="cell right">
							{event.decrease > 0
								? formatEstimate(event.decrease, estimation)
								: "—"}
						</td>
						<td class="cell right">
							{formatEstimate(event.remaining, estimation)}
						</td>
					</tr>
				{/each}
			{/if}
		</tbody>
	</table>
</div>

<style>
	.event-table {
		margin-top: 20px;
		padding: 0;
		overflow-x: auto;
		background-color: var(--ds-surface-raised, #22272b);
		border: 1px solid var(--ds-border, #3b3d42);
		border-radius: 3px;
	}

	table {
		width: 100%;
	}

	.head {
		padding: 8px 12px;
		text-align: left;
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle, #a9abaf);
		border-bottom: 1px solid var(--ds-border, #3b3d42);
		white-space: nowrap;
	}

	.date-col {
		width: 160px;
	}

	.cell {
		padding: 8px 12px;
		border-bottom: 1px solid var(--ds-border, #3b3d42);
		color: var(--ds-text, #cecfd2);
		vertical-align: middle;
	}

	.empty {
		color: var(--ds-text-subtle, #a9abaf);
	}

	.nowrap {
		white-space: nowrap;
	}

	.right {
		text-align: right;
	}

	a {
		color: var(--ds-link, #669df1);
	}

	.summary {
		color: var(--ds-text-subtle, #a9abaf);
		margin-left: 8px;
	}
</style>
