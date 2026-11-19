<script lang="ts">
	import { untrack } from "svelte";
	import type { Editor } from "@tiptap/core";
	import { redoDepth, undoDepth } from "@tiptap/pm/history";
	import { setTextStyle } from "#lib/editor/wiki/extensions.ts";
	import { safeColour } from "#lib/shared/wiki/index.ts";
	import Icon from "#lib/components/Icon.svelte";
	import type { InsertActions } from "./insert-actions.ts";
	import InsertMenu from "./InsertMenu.svelte";
	import MenuItem from "./MenuItem.svelte";
	import Swatches from "./Swatches.svelte";
	import ToolButton from "./ToolButton.svelte";
	import ToolMenu from "./ToolMenu.svelte";

	interface Props {
		editor: Editor;
		disabled: boolean;
		actions: InsertActions;
	}

	let { editor, disabled, actions }: Props = $props();

	const textColours: { name: string; value: string }[] = [
		{ name: "Red", value: "#ff5630" },
		{ name: "Orange", value: "#ff991f" },
		{ name: "Yellow", value: "#ffc400" },
		{ name: "Green", value: "#36b37e" },
		{ name: "Teal", value: "#00b8d9" },
		{ name: "Blue", value: "#4c9aff" },
		{ name: "Purple", value: "#998dd9" },
		{ name: "White", value: "#ffffff" },
		{ name: "Gray", value: "#97a0af" },
	];

	const styleLabels: Record<string, string> = {
		p: "Normal text",
		h1: "Heading 1",
		h2: "Heading 2",
		h3: "Heading 3",
		h4: "Heading 4",
		h5: "Heading 5",
		h6: "Heading 6",
		quote: "Quote",
		code: "Code block",
	};

	type ToolbarState = {
		style: string;
		bold: boolean;
		italic: boolean;
		underline: boolean;
		strike: boolean;
		subscript: boolean;
		superscript: boolean;
		code: boolean;
		link: boolean;
		bulletList: boolean;
		orderedList: boolean;
		taskList: boolean;
		inList: boolean;
		align: string;
		colour: string | null;
		canUndo: boolean;
		canRedo: boolean;
	};

	function readState(instance: Editor): ToolbarState {
		const from = instance.state.selection.$from;
		const parent = from.parent;
		let style = "p";
		if (parent.type.name === "heading") style = `h${parent.attrs.level}`;
		else if (parent.type.name === "codeBlock") style = "code";
		else if (instance.isActive("blockquote")) style = "quote";
		const aligned = parent.attrs.textAlign;
		const colour = instance.getAttributes("textStyle").color;
		return {
			style,
			bold: instance.isActive("bold"),
			italic: instance.isActive("italic"),
			underline: instance.isActive("underline"),
			strike: instance.isActive("strike"),
			subscript: instance.isActive("subscript"),
			superscript: instance.isActive("superscript"),
			code: instance.isActive("code"),
			link: instance.isActive("link"),
			bulletList: instance.isActive("bulletList"),
			orderedList: instance.isActive("orderedList"),
			taskList: instance.isActive("taskList"),
			inList: instance.isActive("listItem") || instance.isActive("taskItem"),
			align: typeof aligned === "string" ? aligned : "left",
			colour: typeof colour === "string" ? colour : null,
			canUndo: undoDepth(instance.state) > 0,
			canRedo: redoDepth(instance.state) > 0,
		};
	}

	let toolbar = $state.raw<ToolbarState>(
		untrack(() => readState(editor)),
	);

	$effect(() => {
		const update = () => {
			toolbar = readState(editor);
		};
		update();
		editor.on("transaction", update);
		editor.on("selectionUpdate", update);
		return () => {
			editor.off("transaction", update);
			editor.off("selectionUpdate", update);
		};
	});

	const run = (
		apply: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>,
	) => apply(editor.chain().focus()).run();

	const align = (value: "left" | "center" | "right") =>
		run((chain) => {
			const attr = { textAlign: value === "left" ? null : value };
			return chain
				.updateAttributes("paragraph", attr)
				.updateAttributes("heading", attr);
		});

	let listType = $derived(toolbar.taskList ? "taskItem" : "listItem");
	let colourBar = $derived(
		safeColour(toolbar.colour) ?? "var(--ds-text, #cecfd2)",
	);

	const alignOptions: [("left" | "center" | "right"), string][] = [
		["left", "Align left"],
		["center", "Align center"],
		["right", "Align right"],
	];
</script>

{#snippet alignLeft()}
	<svg
		width="16"
		height="16"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		stroke-width="1.4"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	><path d="M2 3.5h12M2 6.5h7M2 9.5h12M2 12.5h7" /></svg
	>
{/snippet}
{#snippet alignCenter()}
	<svg
		width="16"
		height="16"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		stroke-width="1.4"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	><path d="M2 3.5h12M4.5 6.5h7M2 9.5h12M4.5 12.5h7" /></svg
	>
{/snippet}
{#snippet alignRight()}
	<svg
		width="16"
		height="16"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		stroke-width="1.4"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	><path d="M2 3.5h12M7 6.5h7M2 9.5h12M7 12.5h7" /></svg
	>
{/snippet}
{#snippet more()}
	<svg
		width="16"
		height="16"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		stroke-width="1.4"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<circle cx="3" cy="8" r="0.9" fill="currentColor" stroke="none" />
		<circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
		<circle cx="13" cy="8" r="0.9" fill="currentColor" stroke="none" />
	</svg>
{/snippet}

{#snippet styleLabel()}
	<span class="wke-style-label">{styleLabels[toolbar.style]}</span>
{/snippet}

{#snippet styleMenu(close: () => void)}
	{#each Object.entries(styleLabels) as [id, label] (id)}
		<MenuItem
			active={toolbar.style === id}
			onclick={() => {
				close();
				if (id === "p") {
					run((chain) => {
						if (editor.isActive("blockquote")) chain.lift("blockquote");
						return chain.setParagraph();
					});
				} else if (id === "quote") {
					run((chain) => chain.toggleBlockquote());
				} else if (id === "code") {
					run((chain) => chain.toggleCodeBlock());
				} else {
					run((chain) =>
						chain.setHeading({
							level: Number(id.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6,
						}),
					);
				}
			}}
		>
			<span class="wke-style-item wke-style-{id}">{label}</span>
		</MenuItem>
	{/each}
{/snippet}

{#snippet colourLabel()}
	<span class="wke-colour-label">
		A
		<span class="wke-colour-bar" style:background={colourBar}></span>
	</span>
{/snippet}

{#snippet colourMenu(close: () => void)}
	<Swatches
		colours={textColours}
		defaultLabel="Default colour"
		onpick={(value) => {
			close();
			setTextStyle(editor, { color: value });
		}}
	/>
{/snippet}

{#snippet moreMenu(close: () => void)}
	<MenuItem
		active={toolbar.strike}
		onclick={() => {
			close();
			run((chain) => chain.toggleStrike());
		}}
	>
		Strikethrough
	</MenuItem>
	<MenuItem
		active={toolbar.subscript}
		onclick={() => {
			close();
			run((chain) => chain.toggleMark("subscript"));
		}}
	>
		Subscript
	</MenuItem>
	<MenuItem
		active={toolbar.superscript}
		onclick={() => {
			close();
			run((chain) => chain.toggleMark("superscript"));
		}}
	>
		Superscript
	</MenuItem>
	<MenuItem
		active={toolbar.code}
		onclick={() => {
			close();
			run((chain) => chain.toggleCode());
		}}
	>
		Monospace
	</MenuItem>
	<MenuItem
		onclick={() => {
			close();
			run((chain) => chain.unsetAllMarks());
		}}
	>
		Clear formatting
	</MenuItem>
{/snippet}

{#snippet alignMenu(close: () => void)}
	{#each alignOptions as [value, label] (value)}
		<MenuItem
			active={toolbar.align === value}
			onclick={() => {
				close();
				align(value);
			}}
		>
			{label}
		</MenuItem>
	{/each}
{/snippet}

{#snippet alignIcon()}
	{#if toolbar.align === "center"}
		{@render alignCenter()}
	{:else if toolbar.align === "right"}
		{@render alignRight()}
	{:else}
		{@render alignLeft()}
	{/if}
{/snippet}

<div class="wke-toolbar" role="toolbar" aria-label="Formatting">
	<ToolMenu title="Text style" label={styleLabel} {disabled} wide menu={styleMenu} />
	<ToolButton
		title="Bold (Ctrl+B)"
		active={toolbar.bold}
		{disabled}
		onclick={() => run((chain) => chain.toggleBold())}
	>
		<strong>B</strong>
	</ToolButton>
	<ToolButton
		title="Italic (Ctrl+I)"
		active={toolbar.italic}
		{disabled}
		onclick={() => run((chain) => chain.toggleItalic())}
	>
		<em>I</em>
	</ToolButton>
	<ToolButton
		title="Underline (Ctrl+U)"
		active={toolbar.underline}
		{disabled}
		onclick={() => run((chain) => chain.toggleUnderline())}
	>
		<u>U</u>
	</ToolButton>
	<ToolMenu
		title="Text colour"
		{disabled}
		label={colourLabel}
		menu={colourMenu}
	/>
	<ToolMenu
		title="More formatting"
		label={more}
		{disabled}
		menu={moreMenu}
	/>
	<span class="wke-tool-separator" aria-hidden="true"></span>
	<ToolButton
		title="Bullet list"
		active={toolbar.bulletList}
		{disabled}
		onclick={() => run((chain) => chain.toggleBulletList())}
	>
		<Icon name="bullet-list" size={16} />
	</ToolButton>
	<ToolButton
		title="Numbered list"
		active={toolbar.orderedList}
		{disabled}
		onclick={() => run((chain) => chain.toggleOrderedList())}
	>
		<Icon name="numbered-list" size={16} />
	</ToolButton>
	<ToolButton
		title="Task list"
		active={toolbar.taskList}
		{disabled}
		onclick={() => run((chain) => chain.toggleTaskList())}
	>
		<Icon name="task-list" size={16} />
	</ToolButton>
	<span class="wke-tool-separator" aria-hidden="true"></span>
	<ToolMenu title="Alignment" label={alignIcon} {disabled} menu={alignMenu} />
	<ToolButton
		title="Indent"
		disabled={disabled || !toolbar.inList}
		onclick={() => run((chain) => chain.sinkListItem(listType))}
	>
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			stroke-width="1.4"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		><path d="M2 3h12M7 6.5h7M7 9.5h7M2 13h12M2 6l2.5 2L2 10z" /></svg
		>
	</ToolButton>
	<ToolButton
		title="Outdent"
		disabled={disabled || !toolbar.inList}
		onclick={() => run((chain) => chain.liftListItem(listType))}
	>
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			stroke-width="1.4"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		><path d="M2 3h12M7 6.5h7M7 9.5h7M2 13h12M4.5 6 2 8l2.5 2z" /></svg
		>
	</ToolButton>
	<span class="wke-tool-separator" aria-hidden="true"></span>
	<ToolButton
		title="Link (Ctrl+K)"
		active={toolbar.link}
		{disabled}
		onclick={actions.openLink}
	>
		<Icon name="link" size={16} />
	</ToolButton>
	<ToolButton
		title="Insert table"
		{disabled}
		onclick={() =>
			run((chain) =>
				chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
			)}
	>
		<Icon name="table" size={16} />
	</ToolButton>
	<InsertMenu {editor} {disabled} {actions} />
	<span class="wke-toolbar-spacer"></span>
	<ToolButton
		title="Undo (Ctrl+Z)"
		disabled={disabled || !toolbar.canUndo}
		onclick={() => run((chain) => chain.undo())}
	>
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			stroke-width="1.4"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		><path d="M3 6h6.5a3.5 3.5 0 0 1 0 7H6M3 6l2.5-2.5M3 6l2.5 2.5" /></svg
		>
	</ToolButton>
	<ToolButton
		title="Redo (Ctrl+Y)"
		disabled={disabled || !toolbar.canRedo}
		onclick={() => run((chain) => chain.redo())}
	>
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			stroke-width="1.4"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		><path d="M13 6H6.5a3.5 3.5 0 0 0 0 7H10M13 6l-2.5-2.5M13 6l-2.5 2.5" /></svg
		>
	</ToolButton>
</div>
