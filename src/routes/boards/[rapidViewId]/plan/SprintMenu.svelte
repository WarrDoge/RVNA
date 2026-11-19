<script lang="ts">
	import type { Sprint } from "#lib/api-types.ts";
	import { dismiss } from "#lib/components/dismiss.ts";

	interface Props {
		sprint: Sprint;
		canEdit: boolean;
		canManage: boolean;
		onEdit: () => void;
		onDelete: () => void;
		onMove: (direction: "up" | "down") => void;
	}

	let {
		sprint,
		canEdit,
		canManage,
		onEdit,
		onDelete,
		onMove,
	}: Props = $props();

	let open = $state(false);
</script>

{#if sprint.state !== "closed" && (canEdit || canManage)}
	<div class="sprint-menu">
		<button
			type="button"
			aria-label={`Sprint actions for ${sprint.name}`}
			class="subtle"
			onclick={() => (open = !open)}
		>
			•••
		</button>
		{#if open}
			<div
				role="menu"
				class="menu"
				{@attach dismiss(() => open, () => (open = false))}
			>
				{#if canEdit}
					<button
						class="fat-menu-item"
						type="button"
						role="menuitem"
						onclick={() => {
							open = false;
							onEdit();
						}}>Edit sprint</button
					>
				{/if}
				{#if canManage && sprint.state === "future"}
					<button
						class="fat-menu-item"
						type="button"
						role="menuitem"
						onclick={() => {
							open = false;
							onMove("up");
						}}>Move up</button
					>
					<button
						class="fat-menu-item"
						type="button"
						role="menuitem"
						onclick={() => {
							open = false;
							onMove("down");
						}}>Move down</button
					>
					<button
						class="fat-menu-item"
						type="button"
						role="menuitem"
						onclick={() => {
							open = false;
							onDelete();
						}}>Delete sprint</button
					>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.sprint-menu {
		position: relative;
	}

	.subtle {
		padding: 0 6px;
		height: 24px;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text-subtle);
		font-size: 13px;
		cursor: pointer;
	}

	.menu {
		position: absolute;
		top: 26px;
		right: 0;
		z-index: 120;
		min-width: 190px;
		padding: 4px;
		background-color: var(--ds-surface-overlay);
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		box-shadow: var(--ds-shadow-overlay);
	}
</style>
