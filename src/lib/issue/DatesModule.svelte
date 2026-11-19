<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { IssueDetail } from "#lib/api-types.ts";
	import Module from "#lib/components/Module.svelte";
	import { absoluteDate, relativeDate } from "#lib/dates.ts";

	interface Props {
		issue: IssueDetail;
	}

	let { issue }: Props = $props();

	let rows = $derived([
		{ label: "Created", value: issue.created },
		{ label: "Updated", value: issue.updated },
		{ label: "Resolved", value: issue.resolved },
	]);

	const stackStyle = "display: flex; flex-direction: column; gap: 8px;";
	const rowStyle = "display: flex; gap: 8px;";
	const labelStyle = `width: 82px; flex: none; color: ${token(
		"color.text.subtle",
	)};`;
	const valueStyle = `color: ${token("color.text")};`;
</script>

<Module title="Dates">
	<div style={stackStyle}>
		{#each rows as row (row.label)}
			<div style={rowStyle}>
				<div style={labelStyle}>{row.label}</div>
				<div title={absoluteDate(row.value)} style={valueStyle}>
					{row.value ? relativeDate(row.value) : "—"}
				</div>
			</div>
		{/each}
	</div>
</Module>
