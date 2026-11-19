<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { IssueDetail } from "#lib/api-types.ts";
	import Module from "#lib/components/Module.svelte";
	import { formatDuration } from "#lib/dates.ts";

	interface Props {
		issue: IssueDetail;
	}

	let { issue }: Props = $props();

	let originalEstimate = $derived(issue.timeTracking.originalEstimate);
	let remainingEstimate = $derived(issue.timeTracking.remainingEstimate);
	let timeSpent = $derived(issue.timeTracking.timeSpent);
	let empty = $derived(
		originalEstimate === null &&
			remainingEstimate === null &&
			timeSpent === null,
	);
	let spent = $derived(timeSpent ?? 0);
	let total = $derived(originalEstimate ?? spent + (remainingEstimate ?? 0));
	let percent = $derived(
		total > 0 ? Math.min(100, Math.round((spent / total) * 100)) : 0,
	);

	const stackStyle = "display: flex; flex-direction: column; gap: 8px;";
	const lineStyle = `display: flex; justify-content: space-between; color: ${token(
		"color.text.subtle",
	)};`;
	const trackStyle = `height: 8px; border-radius: 4px; background-color: ${token(
		"color.background.neutral",
	)}; overflow: hidden;`;
	let barStyle = $derived(`width: ${percent}%; height: 100%; background-color: ${token(
		"color.background.brand.bold",
	)};`);
</script>

{#if !empty}
	<Module title="Time Tracking">
		<div style={stackStyle}>
			<div style={lineStyle}>
				<span>Time spent</span>
				<span>{formatDuration(spent)}</span>
			</div>
			<div style={trackStyle}>
				<div style={barStyle}></div>
			</div>
			<div style={lineStyle}>
				<span>Remaining</span>
				<span>{remainingEstimate === null ? "—" : formatDuration(remainingEstimate)}</span>
			</div>
			<div style={lineStyle}>
				<span>Original estimate</span>
				<span>{originalEstimate === null ? "—" : formatDuration(originalEstimate)}</span>
			</div>
		</div>
	</Module>
{/if}
