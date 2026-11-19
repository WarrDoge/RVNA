<script lang="ts">
	import type {
		CustomFieldColumn,
		NavigatorIssue,
	} from "#lib/api-types.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import IssueTypeIcon from "#lib/components/IssueTypeIcon.svelte";
	import PriorityIcon from "#lib/components/PriorityIcon.svelte";
	import UserLink from "#lib/components/UserLink.svelte";
	import { absoluteDate, formatDateOnly, shortDate } from "#lib/dates.ts";
	import { customSourceId, isCustomColumn } from "#lib/shared/fields.ts";
	import StatusLozenge from "#lib/issue-form/StatusLozenge.svelte";
	import { columnName, formatSeconds } from "./navigator.ts";

	interface Props {
		issue: NavigatorIssue;
		column: string;
		customFields: CustomFieldColumn[];
	}

	let { issue, column, customFields }: Props = $props();

	let user = $derived(
		column === "assignee"
			? issue.assignee
			: column === "reporter"
				? issue.reporter
				: column === "creator"
					? issue.creator
					: null,
	);
	let customValue = $derived(
		isCustomColumn(column)
			? (issue.custom[customSourceId(column)] ?? "")
			: null,
	);
	let dateValue = $derived(
		column === "created"
			? issue.created
			: column === "updated"
				? issue.updated
				: column === "resolved"
					? issue.resolved
					: null,
	);
</script>

{#if customValue !== null}
	{customValue}
{:else if column === "type"}
	<IssueTypeIcon
		id={issue.type.id}
		name={issue.type.name}
		icon={issue.type.iconUrl}
	/>
{:else if column === "key"}
	<a class="key" href={`/browse/${issue.key}`}>{issue.key}</a>
{:else if column === "summary"}
	<a class="summary" href={`/browse/${issue.key}`} title={issue.summary}>{issue.summary}</a>
{:else if user}
	<span class="user">
		<Avatar {user} size={20} />
		<UserLink username={user.username}>{user.displayName}</UserLink>
	</span>
{:else if column === "assignee"}
	<span class="subtle">Unassigned</span>
{:else if column === "reporter" || column === "creator"}
	<span class="subtle">—</span>
{:else if column === "priority"}
	{#if issue.priority}
		<span title={issue.priority.name}>
			<PriorityIcon
				id={issue.priority.id}
				iconUrl={issue.priority.iconUrl}
				name={issue.priority.name}
			/>
		</span>
	{/if}
{:else if column === "status"}
	<StatusLozenge status={issue.status} />
{:else if column === "resolution"}
	{#if issue.resolution}
		{issue.resolution.name}
	{:else}
		<span class="subtle">Unresolved</span>
	{/if}
{:else if column === "created" || column === "updated" || column === "resolved"}
	{#if dateValue}
		<span title={absoluteDate(dateValue)}>{shortDate(dateValue)}</span>
	{/if}
{:else if column === "dueDate"}
	{issue.dueDate ? formatDateOnly(issue.dueDate) : ""}
{:else if column === "labels"}
	{issue.labels.join(", ")}
{:else if column === "components"}
	{issue.components.join(", ")}
{:else if column === "fixVersions"}
	{issue.fixVersions.join(", ")}
{:else if column === "affectsVersions"}
	{issue.affectsVersions.join(", ")}
{:else if column === "sprint"}
	{issue.sprint ?? ""}
{:else if column === "epic"}
	{#if issue.epic}
		<a class="link" href={`/browse/${issue.epic.key}`}>{issue.epic.key}</a>
	{/if}
{:else if column === "parent"}
	{#if issue.parent}
		<a class="link" href={`/browse/${issue.parent.key}`}>{issue.parent.key}</a>
	{/if}
{:else if column === "project"}
	{issue.project.name}
{:else if column === "storyPoints"}
	{issue.storyPoints === null ? "" : String(issue.storyPoints)}
{:else if column === "timeSpent"}
	{formatSeconds(issue.timeSpent)}
{:else if column === "originalEstimate"}
	{formatSeconds(issue.originalEstimate)}
{:else if column === "remainingEstimate"}
	{formatSeconds(issue.remainingEstimate)}
{:else}
	{columnName(column, customFields)}
{/if}

<style>
	.key {
		color: var(--ds-link, #669df1);
		font-weight: 500;
	}

	.summary {
		color: var(--ds-text, #cecfd2);
		text-decoration: none;
	}

	.link {
		color: var(--ds-link, #669df1);
	}

	.user {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.subtle {
		color: var(--ds-text-subtle, #a9abaf);
	}
</style>
