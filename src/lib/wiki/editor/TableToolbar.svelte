<script lang="ts">
	import type { Editor } from "@tiptap/core";
	import MenuItem from "./MenuItem.svelte";
	import Swatches from "./Swatches.svelte";
	import ToolButton from "./ToolButton.svelte";
	import ToolMenu from "./ToolMenu.svelte";

	interface Props {
		editor: Editor;
	}

	let { editor }: Props = $props();

	type Box = { left: number; top: number };

	const cellColours: { name: string; value: string }[] = [
		{ name: "Red", value: "#5d1f1a" },
		{ name: "Orange", value: "#5f3811" },
		{ name: "Yellow", value: "#533f04" },
		{ name: "Green", value: "#164b35" },
		{ name: "Teal", value: "#1d474c" },
		{ name: "Blue", value: "#09326c" },
		{ name: "Purple", value: "#352c63" },
		{ name: "Gray", value: "#3b3d42" },
	];

	function nodeBox(instance: Editor, typeName: string): Box | null {
		const from = instance.state.selection.$from;
		for (let depth = from.depth; depth > 0; depth--) {
			if (from.node(depth).type.name !== typeName) continue;
			const dom = instance.view.nodeDOM(from.before(depth));
			if (!(dom instanceof HTMLElement)) return null;
			const rect = dom.getBoundingClientRect();
			return { left: rect.left, top: rect.top };
		}
		return null;
	}

	let box = $state.raw<Box | null>(null);
	let can = $state({ merge: false, split: false });

	$effect(() => {
		const update = () => {
			const next = editor.isEditable ? nodeBox(editor, "table") : null;
			box =
				box?.left === next?.left && box?.top === next?.top ? box : next;
			can = {
				merge: editor.can().mergeCells(),
				split: editor.can().splitCell(),
			};
		};
		update();
		editor.on("transaction", update);
		editor.on("selectionUpdate", update);
		window.addEventListener("scroll", update, true);
		window.addEventListener("resize", update);
		return () => {
			editor.off("transaction", update);
			editor.off("selectionUpdate", update);
			window.removeEventListener("scroll", update, true);
			window.removeEventListener("resize", update);
		};
	});

	const run = (
		apply: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>,
	) => apply(editor.chain().focus()).run();

	let barStyle = $derived(
		`left: ${Math.max(8, box?.left ?? 8)}px; top: ${Math.max(8, (box?.top ?? 48) - 40)}px;`,
	);
</script>

{#snippet rowMenu(close: () => void)}
	<MenuItem
		onclick={() => {
			close();
			run((chain) => chain.addRowBefore());
		}}
	>Insert row above</MenuItem>
	<MenuItem
		onclick={() => {
			close();
			run((chain) => chain.addRowAfter());
		}}
	>Insert row below</MenuItem>
	<MenuItem
		onclick={() => {
			close();
			run((chain) => chain.deleteRow());
		}}
	>Delete row</MenuItem>
{/snippet}

{#snippet columnMenu(close: () => void)}
	<MenuItem
		onclick={() => {
			close();
			run((chain) => chain.addColumnBefore());
		}}
	>Insert column left</MenuItem>
	<MenuItem
		onclick={() => {
			close();
			run((chain) => chain.addColumnAfter());
		}}
	>Insert column right</MenuItem>
	<MenuItem
		onclick={() => {
			close();
			run((chain) => chain.deleteColumn());
		}}
	>Delete column</MenuItem>
{/snippet}

{#snippet rowLabel()}Row{/snippet}
{#snippet columnLabel()}Column{/snippet}
{#snippet cellColourLabel()}Cell colour{/snippet}

{#snippet cellColourMenu(close: () => void)}
	<Swatches
		colours={cellColours}
		defaultLabel="No background"
		onpick={(value) => {
			close();
			run((chain) => chain.setCellAttribute("background", value));
		}}
	/>
{/snippet}

{#if box}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="wke-table-bar"
		role="toolbar"
		aria-label="Table"
		tabindex="-1"
		style={barStyle}
		onmousedown={(event) => event.preventDefault()}
	>
		<ToolMenu title="Row" label={rowLabel} menu={rowMenu} />
		<ToolMenu title="Column" label={columnLabel} menu={columnMenu} />
		<ToolButton
			title="Toggle header row"
			onclick={() => run((chain) => chain.toggleHeaderRow())}
		>Header row</ToolButton>
		<ToolButton
			title="Toggle header column"
			onclick={() => run((chain) => chain.toggleHeaderColumn())}
		>Header column</ToolButton>
		<ToolButton
			title="Merge cells"
			disabled={!can.merge}
			onclick={() => run((chain) => chain.mergeCells())}
		>Merge</ToolButton>
		<ToolButton
			title="Split cell"
			disabled={!can.split}
			onclick={() => run((chain) => chain.splitCell())}
		>Split</ToolButton>
		<ToolMenu
			title="Cell background"
			label={cellColourLabel}
			menu={cellColourMenu}
		/>
		<ToolButton
			title="Delete table"
			onclick={() => run((chain) => chain.deleteTable())}
		>Delete table</ToolButton>
	</div>
{/if}
