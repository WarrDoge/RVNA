<script lang="ts">
	import type { StatusCategory } from "#lib/api-types.ts";
	import Icon from "#lib/components/Icon.svelte";
	import IssueTypeIcon from "#lib/components/IssueTypeIcon.svelte";
	import PriorityIcon from "#lib/components/PriorityIcon.svelte";
	import { absoluteDate, relativeDate } from "#lib/dates.ts";
	import StatusLozenge from "#lib/issue-form/StatusLozenge.svelte";
	import { formatSlaMinutes, type QueueCell, type SlaState } from "./queue.ts";

	interface Props {
		cell: QueueCell;
	}

	let { cell }: Props = $props();

	let label = $derived(formatSlaMinutes(cell.remainingMinutes));
	let detail = $derived(slaDetail(cell.state));
	let color = $derived(
		cell.breached
			? "#e5493a"
			: cell.state === "paused"
				? "#f5a623"
				: "var(--ds-text)",
	);
	let category = $derived(statusCategory(cell.category));

	function statusCategory(value: string | null): StatusCategory {
		return value === "done" || value === "indeterminate" ? value : "new";
	}

	function slaDetail(state: SlaState | null) {
		return state === "completed"
			? "Completed"
			: state === "paused"
				? "Paused"
				: state === "breached"
					? "Breached"
					: "Running";
	}
</script>

{#if cell.kind === "key"}
	<a class="key-link" href={cell.href ?? "#"}>{cell.text}</a>
{:else if cell.kind === "summary"}
	<a class="summary-link" href={cell.href ?? "#"}>{cell.text}</a>
{:else if cell.kind === "type"}
	<span class="icon" title={cell.text ?? ""}>
		<IssueTypeIcon name={cell.text ?? ""} />
	</span>
{:else if cell.kind === "status"}
	{#if cell.text}
		<StatusLozenge status={{ name: cell.text, category }} />
	{/if}
{:else if cell.kind === "priority"}
	{#if cell.text}
		<span class="icon" title={cell.text}>
			<PriorityIcon name={cell.text} />
		</span>
	{/if}
{:else if cell.kind === "sla"}
	<span
		class="sla"
		style:color
		title={`${detail} · ${label} left`}
	>
		<Icon name="clock" size={14} />
		{label}
		{#if cell.state === "paused"}
			<span class="sla-paused">paused</span>
		{/if}
	</span>
{:else if cell.kind === "date"}
	<span title={absoluteDate(cell.text)}>{relativeDate(cell.text)}</span>
{:else if cell.kind === "components"}
	<span>{cell.names.join(", ")}</span>
{:else}
	<span>{cell.text ?? ""}</span>
{/if}

<style>
	.key-link {
		color: var(--ds-link);
		font-weight: 500;
		white-space: nowrap;
	}

	.summary-link {
		color: var(--ds-text);
		text-decoration: none;
	}

	.icon {
		display: inline-flex;
	}

	.sla {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		white-space: nowrap;
	}

	.sla-paused {
		font-size: 11px;
		text-transform: uppercase;
	}
</style>
