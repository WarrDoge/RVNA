<script lang="ts">
	import type { Editor } from "@tiptap/core";
	import ToolButton from "./ToolButton.svelte";

	interface Props {
		editor: Editor;
	}

	let { editor }: Props = $props();

	type Box = { left: number; top: number; toolbarBottom: number };

	function nodeBox(instance: Editor, typeName: string): Box | null {
		const from = instance.state.selection.$from;
		for (let depth = from.depth; depth > 0; depth--) {
			if (from.node(depth).type.name !== typeName) continue;
			const dom = instance.view.nodeDOM(from.before(depth));
			if (!(dom instanceof HTMLElement)) return null;
			const root = instance.view.dom.closest(".wke");
			if (!(root instanceof HTMLElement)) return null;
			const rootRect = root.getBoundingClientRect();
			const rect = dom.getBoundingClientRect();
			const toolbar = root.querySelector(".wke-toolbar");
			return {
				left: rect.left - rootRect.left,
				top: rect.top - rootRect.top,
				toolbarBottom: toolbar
					? toolbar.getBoundingClientRect().bottom - rootRect.top
					: 0,
			};
		}
		return null;
	}

	let box = $state.raw<Box | null>(null);

	$effect(() => {
		const update = () => {
			const next = editor.isEditable ? nodeBox(editor, "layoutSection") : null;
			box =
				box?.left === next?.left && box?.top === next?.top ? box : next;
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

	let barStyle = $derived(
		`position: absolute; left: ${Math.max(8, box?.left ?? 8)}px; top: ${Math.max(
			8,
			(box?.top ?? 48) - 40,
			(box?.toolbarBottom ?? 0) + 4,
		)}px;`,
	);
</script>

{#if box}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="wke-table-bar"
		role="toolbar"
		aria-label="Layout"
		tabindex="-1"
		style={barStyle}
		onmousedown={(event) => event.preventDefault()}
	>
		<ToolButton
			title="Delete layout"
			onclick={() => editor.chain().focus().deleteNode("layoutSection").run()}
		>Delete layout</ToolButton>
	</div>
{/if}
