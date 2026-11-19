<script lang="ts">
	import { tick } from "svelte";
	import Icon from "#lib/components/Icon.svelte";
	import { dismiss } from "#lib/components/dismiss.ts";
	import {
		BASIC_CRITERIA,
		type BasicCriterionId,
	} from "#lib/shared/jql/index.ts";

	interface Props {
		active: BasicCriterionId[];
		onAdd: (id: BasicCriterionId) => void;
	}

	let { active, onAdd }: Props = $props();

	let open = $state(false);
	let menu = $state<HTMLDivElement>();

	function close() {
		open = false;
	}

	$effect(() => {
		if (!open) return;
		void tick().then(() => {
			menu?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
		});
	});

	function onMenuKeyDown(event: KeyboardEvent) {
		const items = [...(menu?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
		const index = items.indexOf(document.activeElement as HTMLElement);
		if (event.key === "ArrowDown") {
			event.preventDefault();
			items[(index + 1) % items.length]?.focus();
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			items[index <= 0 ? items.length - 1 : index - 1]?.focus();
		} else if (event.key === "Home") {
			event.preventDefault();
			items[0]?.focus();
		} else if (event.key === "End") {
			event.preventDefault();
			items[items.length - 1]?.focus();
		}
	}
</script>

<div class="more" {@attach dismiss(() => open, close)}>
	<button
		type="button"
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={() => (open = !open)}
		class="control more-button"
	>
		More <Icon name="chevron-down" />
	</button>
	{#if open}
		<div
			role="menu"
			aria-label="More criteria"
			class="more-menu"
			tabindex="-1"
			bind:this={menu}
			onkeydown={onMenuKeyDown}
		>
			{#each BASIC_CRITERIA as criterion (criterion.id)}
				<button
					type="button"
					role="menuitem"
					class="fat-menu-item more-item"
					disabled={active.includes(criterion.id)}
					onclick={() => {
						onAdd(criterion.id);
						open = false;
					}}
					style:opacity={active.includes(criterion.id) ? 0.5 : 1}
				>
					<Icon name="plus" size={12} />
					{criterion.name}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.more {
		position: relative;
		align-self: flex-end;
	}

	.control {
		height: 32px;
		padding: 0 8px;
		background: var(--ds-background-input, #ffffff);
		border: 1px solid var(--ds-border-input, #8c8f97);
		border-radius: 3px;
		color: var(--ds-text, #292a2e);
		font-size: 14px;
		max-width: 200px;
	}

	.more-button {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		cursor: pointer;
	}

	.more-menu {
		position: absolute;
		top: 34px;
		left: 0;
		z-index: 100;
		min-width: 180px;
		padding-block: 4px;
		background-color: var(--ds-surface-overlay, #ffffff);
		border: 1px solid var(--ds-border, #dfe1e6);
		border-radius: 3px;
		box-shadow: var(--ds-shadow-overlay, 0 8px 12px #1e1f2126);
	}

	.more-menu .more-item {
		display: flex;
		align-items: center;
		gap: 6px;
	}
</style>
