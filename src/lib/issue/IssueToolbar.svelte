<script lang="ts">
	import type { IssueDetail, Me, Transition, UserRef } from "#lib/api-types.ts";
	import AssignPopover from "./AssignPopover.svelte";
	import Dropdown from "./Dropdown.svelte";
	import MenuItem from "./MenuItem.svelte";
	import ToolbarButton from "./ToolbarButton.svelte";

	interface Props {
		issue: IssueDetail;
		me: Me | null;
		permissions: Record<string, boolean>;
		assignOpen: boolean;
		onAssignOpenChange: (open: boolean) => void;
		onEdit: () => void;
		onComment: () => void;
		onAssign: (user: UserRef | null) => void;
		onLogWork: () => void;
		onAttach: () => void;
		onLink: () => void;
		onClone: () => void;
		onCreateSubtask: () => void;
		onDelete: () => void;
		onTransition: (transition: Transition) => void;
		transitionPending: boolean;
	}

	let {
		issue,
		me,
		permissions,
		assignOpen,
		onAssignOpenChange,
		onEdit,
		onComment,
		onAssign,
		onLogWork,
		onAttach,
		onLink,
		onClone,
		onCreateSubtask,
		onDelete,
		onTransition,
		transitionPending,
	}: Props = $props();

	const allowed = (key: string) => permissions[key] === true;
	let transitions = $derived(allowed("TRANSITION_ISSUES") ? issue.transitions : []);
	let first = $derived(transitions.slice(0, 2));
	let rest = $derived(transitions.slice(2));
	let moreItems = $derived(
		[
			allowed("WORK_ON_ISSUES")
				? { id: "work", label: "Log work", onclick: onLogWork, danger: false }
				: null,
			allowed("CREATE_ATTACHMENTS")
				? {
						id: "attach",
						label: "Attach files",
						onclick: onAttach,
						danger: false,
					}
				: null,
			allowed("LINK_ISSUES")
				? { id: "link", label: "Link", onclick: onLink, danger: false }
				: null,
			allowed("CREATE_ISSUES")
				? { id: "clone", label: "Clone", onclick: onClone, danger: false }
				: null,
			allowed("CREATE_ISSUES") && !issue.type.subtask
				? {
						id: "subtask",
						label: "Create sub-task",
						onclick: onCreateSubtask,
						danger: false,
					}
				: null,
			allowed("DELETE_ISSUES")
				? { id: "delete", label: "Delete", onclick: onDelete, danger: true }
				: null,
		].filter((item) => item !== null),
	);
</script>

<div class="toolbar">
	{#if allowed("EDIT_ISSUES")}
		<ToolbarButton onclick={onEdit}>Edit</ToolbarButton>
	{/if}
	{#if allowed("ADD_COMMENTS")}
		<ToolbarButton onclick={onComment}>Add comment</ToolbarButton>
	{/if}
	{#if allowed("ASSIGN_ISSUES")}
		<AssignPopover
			{issue}
			{me}
			onAssign={onAssign}
			open={assignOpen}
			onOpenChange={onAssignOpenChange}
		/>
	{/if}
	{#if moreItems.length > 0}
		<Dropdown label="More">
			{#each moreItems as item (item.id)}
				<MenuItem onclick={item.onclick} danger={item.danger}>
					{item.label}
				</MenuItem>
			{/each}
		</Dropdown>
	{/if}
	{#each first as transition (transition.id)}
		<ToolbarButton
			disabled={transitionPending}
			onclick={() => onTransition(transition)}
		>
			{transition.name}
		</ToolbarButton>
	{/each}
	{#if rest.length > 0}
		<Dropdown label="Workflow">
			{#each rest as transition (transition.id)}
				<MenuItem
					disabled={transitionPending}
					onclick={() => onTransition(transition)}
				>
					{transition.name}
				</MenuItem>
			{/each}
		</Dropdown>
	{/if}
</div>

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		padding: 4px 0 8px;
	}
</style>
