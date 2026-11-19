<script lang="ts">
	import { tick } from "svelte";
	import type { IssueDetail, Me, UserRef } from "#lib/api-types.ts";
	import { dismiss } from "#lib/components/dismiss.ts";
	import UserSelect from "#lib/issue-form/UserSelect.svelte";
	import ToolbarButton from "./ToolbarButton.svelte";

	interface Props {
		issue: IssueDetail;
		me: Me | null;
		onAssign: (user: UserRef | null) => void;
		open: boolean;
		onOpenChange: (open: boolean) => void;
	}

	let { issue, me, onAssign, open, onOpenChange }: Props = $props();
	const popoverId = $props.id();
	let popover = $state<HTMLDivElement>();

	$effect(() => {
		if (!open) return;
		void tick().then(() => {
			popover?.querySelector<HTMLElement>("input, button, select, textarea")?.focus();
		});
	});
</script>

<div
	class="root"
	{@attach dismiss(
		() => open,
		() => onOpenChange(false),
	)}
>
	<ToolbarButton
		onclick={() => onOpenChange(!open)}
		expanded={open}
		haspopup="dialog"
		controls={popoverId}
	>
		Assign
	</ToolbarButton>
	{#if open}
		<div bind:this={popover} id={popoverId} class="popover">
			<UserSelect
				label="Assignee"
				value={issue.assignee}
				onChange={(user) => {
					onAssign(user);
					onOpenChange(false);
				}}
				{me}
				allowMe
			/>
		</div>
	{/if}
</div>

<style>
	.root {
		position: relative;
	}

	.popover {
		position: absolute;
		top: 34px;
		left: 0;
		z-index: 100;
		width: 280px;
		padding: 8px;
		background-color: var(--ds-surface-overlay);
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		box-shadow: var(--ds-shadow-overlay);
	}
</style>
