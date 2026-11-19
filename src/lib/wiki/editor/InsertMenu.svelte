<script lang="ts">
	import type { Editor } from "@tiptap/core";
	import Icon from "#lib/components/Icon.svelte";
	import type { InsertActions } from "./insert-actions.ts";
	import { runInsert } from "./insert-actions.ts";
	import { type InsertGroup, insertItems } from "./insert-items.ts";
	import MenuItem from "./MenuItem.svelte";
	import ToolMenu from "./ToolMenu.svelte";

	interface Props {
		editor: Editor;
		disabled: boolean;
		actions: InsertActions;
	}

	let { editor, disabled, actions }: Props = $props();

	let grouped = $derived.by(() => {
		const groups: { name: InsertGroup; items: typeof insertItems }[] = [];
		for (const item of insertItems) {
			const last = groups[groups.length - 1];
			if (last && last.name === item.group) last.items.push(item);
			else groups.push({ name: item.group, items: [item] });
		}
		return groups;
	});
</script>

{#snippet label()}
	<Icon name="plus" size={14} /> Insert
{/snippet}

{#snippet menu(close: () => void)}
	{#each grouped as group (group.name)}
		<div class="wke-menu-group">{group.name}</div>
		{#each group.items as item (item.id)}
			<MenuItem
				onclick={() => {
					close();
					runInsert(editor, item.id, actions);
				}}
			>
				{item.label}
			</MenuItem>
		{/each}
	{/each}
{/snippet}

<ToolMenu title="Insert content" {label} {disabled} wide {menu} />
