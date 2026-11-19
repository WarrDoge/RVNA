<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { IssueDetail, Me } from "#lib/api-types.ts";
	import Module from "#lib/components/Module.svelte";
	import EditableCustomFieldRows from "#lib/issue-form/EditableCustomFieldRows.svelte";
	import PriorityLabel from "#lib/issue-form/PriorityLabel.svelte";
	import StatusLozenge from "#lib/issue-form/StatusLozenge.svelte";
	import { linkStyle } from "#lib/issue-form/styles.ts";
	import TypeLabel from "#lib/issue-form/TypeLabel.svelte";
	import DetailPairs from "./DetailPairs.svelte";
	import type { DetailPair } from "./types.ts";

	interface Props {
		issue: IssueDetail;
		me: Me | null;
		onChanged: () => Promise<void>;
	}

	let { issue, me, onChanged }: Props = $props();

	let hasStoryPoints = $derived(
		issue.project.type === "software" || issue.storyPoints !== null,
	);

	function hasDetailValue(pair: DetailPair | undefined) {
		if (!pair) return false;
		const { value } = pair;
		return value !== null && value !== undefined && value !== "";
	}

	function join(values: string[]) {
		return values.length > 0 ? values.join(", ") : null;
	}

	const gridStyle = `display: grid; grid-template-columns: 88px minmax(0, 1fr) 96px minmax(0, 1fr); row-gap: 8px; column-gap: 12px; align-items: start;`;
	const noneStyle = `color: ${token("color.text.subtle")};`;
</script>

{#snippet noneValue()}<span style={noneStyle}>None</span>{/snippet}
{#snippet unresolvedValue()}<span style={noneStyle}>Unresolved</span>{/snippet}
{#snippet typeValue()}<TypeLabel type={issue.type} />{/snippet}
{#snippet priorityValue()}<PriorityLabel priority={issue.priority} />{/snippet}
{#snippet statusValue()}<StatusLozenge status={issue.status} />{/snippet}
{#snippet labelsValue()}
	{#if issue.labels.length > 0}
		{issue.labels.join(", ")}
	{:else}
		{@render noneValue()}
	{/if}
{/snippet}
{#snippet storyPointsValue()}
	{#if issue.storyPoints === null}
		{@render noneValue()}
	{:else}
		{issue.storyPoints}
	{/if}
{/snippet}
{#snippet resolutionValue()}
	{#if issue.resolution}
		{issue.resolution.name}
	{:else}
		{@render unresolvedValue()}
	{/if}
{/snippet}
{#snippet epicValue()}
	{#if issue.epic}
		<a href={`/browse/${issue.epic.key}`} style={linkStyle}>
			{issue.epic.key} — {issue.epic.summary}
		</a>
	{/if}
{/snippet}
{#snippet parentValue()}
	{#if issue.parent}
		<a href={`/browse/${issue.parent.key}`} style={linkStyle}>
			{issue.parent.key} — {issue.parent.summary}
		</a>
	{/if}
{/snippet}

{#snippet rows()}
	{@const left: (DetailPair | undefined)[] = [
		{ label: "Type", value: typeValue, required: true },
		{ label: "Priority", value: priorityValue, required: true },
		{ label: "Labels", value: labelsValue, required: true },
		...(hasStoryPoints
			? [
					{
						label: "Original story points",
						value: storyPointsValue,
						required: true,
					},
				]
			: []),
		{
			label: "Components",
			value: join(issue.components.map((item) => item.name)),
		},
		{
			label: "Affects versions",
			value: join(issue.affectsVersions.map((item) => item.name)),
		},
		{
			label: "Fix versions",
			value: join(issue.fixVersions.map((item) => item.name)),
		},
		{
			label: "Epic",
			value: issue.epic ? epicValue : null,
		},
	]}
	{@const right: (DetailPair | undefined)[] = [
		{
			label: "Status",
			value: statusValue,
			required: true,
			testId: "issue-status",
		},
		{
			label: "Resolution",
			value: resolutionValue,
			required: true,
			testId: "issue-resolution",
		},
		{
			label: "Parent",
			value: issue.parent ? parentValue : null,
		},
		...issue.customFields.map((field) => ({
			label: field.name,
			value: field.value,
		})),
	]}
	{#each Array.from({ length: Math.max(left.length, right.length) }, (_, index) => index) as index}
		{@const leftPair = left[index]}
		{@const rightPair = right[index]}
		{#if leftPair?.required || rightPair?.required || hasDetailValue(leftPair) || hasDetailValue(rightPair)}
			<DetailPairs
				pairs={[leftPair, rightPair].map((pair) =>
					pair?.required || hasDetailValue(pair) ? pair : undefined,
				)}
			/>
		{/if}
	{/each}
{/snippet}

<Module title="Details">
	<div style={gridStyle}>
		{@render rows()}
		<EditableCustomFieldRows {issue} {me} onSaved={onChanged} />
	</div>
</Module>
