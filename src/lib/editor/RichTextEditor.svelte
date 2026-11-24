<script lang="ts">
	import { hydratingPage } from "#lib/hydration.ts";
	import { token } from "#lib/tokens.ts";
	import { Editor } from "@tiptap/core";
	import Image from "@tiptap/extension-image";
	import Placeholder from "@tiptap/extension-placeholder";
	import { TableKit } from "@tiptap/extension-table";
	import TaskItem from "@tiptap/extension-task-item";
	import TaskList from "@tiptap/extension-task-list";
	import StarterKit from "@tiptap/starter-kit";
	import { onDestroy, onMount } from "svelte";
	import { api } from "#lib/api.ts";
	import type { UserRef } from "#lib/api-types.ts";
	import Icon from "#lib/components/Icon.svelte";
	import type { IconName } from "#lib/components/icons.ts";
	import MentionList from "./MentionList.svelte";
	import ToolButton from "./ToolButton.svelte";
	import { Mention, UnknownBlock } from "./issue-extensions.ts";
	import { scrubPastedHtml } from "./safe-html.ts";

	interface Props {
		value: string;
		onChange: (html: string) => void;
		placeholder?: string;
		minHeight?: number;
		autoFocus?: boolean;
		focusSignal?: number;
		/** Uploads the file and returns the URL to insert. */
		uploadImage?: (file: File) => Promise<string>;
		readOnly?: boolean;
		disabled?: boolean;
		ariaLabel?: string;
		ariaRequired?: boolean;
		onEditor?: (editor: Editor) => void;
	}

	let {
		value,
		onChange,
		placeholder = "Write something…",
		minHeight = 120,
		autoFocus = false,
		focusSignal,
		uploadImage,
		readOnly = false,
		disabled = false,
		ariaLabel,
		ariaRequired = false,
		onEditor,
	}: Props = $props();

	type ToolbarState = {
		bold: boolean;
		italic: boolean;
		underline: boolean;
		bulletList: boolean;
		orderedList: boolean;
		taskList: boolean;
		blockquote: boolean;
		code: boolean;
		codeBlock: boolean;
		strike: boolean;
		link: boolean;
		heading: "p" | "h1" | "h2" | "h3";
	};

	const emptyToolbar: ToolbarState = {
		bold: false,
		italic: false,
		underline: false,
		bulletList: false,
		orderedList: false,
		taskList: false,
		blockquote: false,
		code: false,
		codeBlock: false,
		strike: false,
		link: false,
		heading: "p",
	};

	let wrapperEl: HTMLDivElement;
	let mountEl: HTMLDivElement;
	let imageInput = $state<HTMLInputElement>();
	let editor = $state.raw<Editor | null>(null);
	let mounted = $state(false);
	let toolbar = $state<ToolbarState>({ ...emptyToolbar });
	let heading = $state<string | undefined>(hydratingPage() ? undefined : "p");
	let loadedHeading = "p";
	$effect(() => {
		if (toolbar.heading === loadedHeading) return;
		loadedHeading = toolbar.heading;
		heading = toolbar.heading;
	});
	let linkOpen = $state(false);
	let linkValue = $state("");
	let uploading = $state(false);
	let mention = $state<{ from: number; query: string } | null>(null);
	let activeMention = $state(0);
	let candidates = $state<UserRef[]>([]);
	let mentionPending = $state(false);
	let mentionPosition = $state<{ left: number; top: number } | null>(null);
	// The HTML from the latest editor update, so the parent handing it back is not a change.
	let lastEmitted: string | null = null;

	let editable = $derived(!readOnly && !disabled);
	let staticHtml = $derived(value || "<p></p>");

	const toolbarStyle = `display: flex; align-items: center; flex-wrap: wrap; gap: 2px; padding: 4px 6px; border-bottom: 1px solid ${token("color.border")};`;
	const separatorStyle = `width: 1px; height: 18px; margin: 0 4px; background-color: ${token("color.border")};`;
	const selectStyle = `height: 26px; margin-right: 4px; background: ${token(
		"color.background.input",
	)}; color: ${token("color.text")}; border: 1px solid ${token(
		"color.border.input",
	)}; border-radius: 3px; font-size: 13px;`;
	const wrapperStyle = `position: relative; background-color: ${token(
		"color.background.input",
	)}; border: 1px solid ${token("color.border.input")}; border-radius: 3px;`;
	const contentStyle = $derived(`min-height: ${minHeight}px;`);
	const linkInputStyle = `flex: 1; height: 28px; padding: 0 8px; background: ${token(
		"color.background.input",
	)}; border: 1px solid ${token("color.border.input")}; border-radius: 3px; color: ${token(
		"color.text",
	)};`;
	const applyButtonStyle = `height: 28px; padding: 0 10px; background: ${token(
		"color.background.brand.bold",
	)}; color: ${token(
		"color.text.inverse",
	)}; border: 0; border-radius: 3px; cursor: pointer;`;

	function readToolbar(instance: Editor): ToolbarState {
		return {
			bold: instance.isActive("bold"),
			italic: instance.isActive("italic"),
			underline: instance.isActive("underline"),
			bulletList: instance.isActive("bulletList"),
			orderedList: instance.isActive("orderedList"),
			taskList: instance.isActive("taskList"),
			blockquote: instance.isActive("blockquote"),
			code: instance.isActive("code"),
			codeBlock: instance.isActive("codeBlock"),
			strike: instance.isActive("strike"),
			link: instance.isActive("link"),
			heading: instance.isActive("heading", { level: 1 })
				? "h1"
				: instance.isActive("heading", { level: 2 })
					? "h2"
					: instance.isActive("heading", { level: 3 })
						? "h3"
						: "p",
		};
	}

	function positionMention() {
		const instance = editor;
		if (!instance || !mention || !wrapperEl) {
			mentionPosition = null;
			return;
		}
		try {
			const coords = instance.view.coordsAtPos(instance.state.selection.from);
			const rect = wrapperEl.getBoundingClientRect();
			mentionPosition = {
				left: Math.max(0, Math.min(coords.left - rect.left, rect.width - 280)),
				top: coords.bottom - rect.top + 4,
			};
		} catch {
			mentionPosition = null;
		}
	}

	function updateMention(next: { from: number; query: string } | null) {
		mention = next;
		activeMention = 0;
		if (next) positionMention();
		else mentionPosition = null;
	}

	function normalizeUrl(raw: string) {
		const trimmed = raw.trim();
		if (trimmed === "") return "";
		if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("/")) {
			return trimmed;
		}
		return `https://${trimmed}`;
	}

	function applyLink() {
		const instance = editor;
		if (!instance) return;
		const href = normalizeUrl(linkValue);
		if (href === "") {
			instance.chain().focus().unsetLink().run();
		} else {
			instance.chain().focus().extendMarkRange("link").setLink({ href }).run();
		}
		linkOpen = false;
		linkValue = "";
	}

	function openLink() {
		linkValue = editor?.getAttributes("link").href ?? "";
		linkOpen = !linkOpen;
	}

	async function insertImage(file: File) {
		if (!uploadImage || !editor) return;
		uploading = true;
		try {
			const url = await uploadImage(file);
			editor?.chain().focus().setImage({ src: url, alt: file.name }).run();
		} finally {
			uploading = false;
		}
	}

	function insertMention(user: UserRef) {
		const instance = editor;
		const current = mention;
		if (!instance || !current) return;
		instance
			.chain()
			.focus()
			.deleteRange({ from: current.from, to: instance.state.selection.from })
			.insertContent([
				{ type: "mention", attrs: { id: user.id, label: user.displayName } },
				{ type: "text", text: " " },
			])
			.run();
		updateMention(null);
	}

	onMount(() => {
		const instance = new Editor({
			element: mountEl,
			extensions: [
				StarterKit.configure({
					link: {
						openOnClick: false,
						autolink: true,
						defaultProtocol: "https",
					},
				}),
				Image.configure({ inline: false, allowBase64: false }),
				TableKit.configure({ table: { resizable: false } }),
				TaskList,
				TaskItem.configure({ nested: true }),
				Placeholder.configure({ placeholder }),
				UnknownBlock,
				Mention,
			],
			content: value || "<p></p>",
			autofocus: autoFocus && editable,
			editable,
			editorProps: {
				transformPastedHTML: scrubPastedHtml,
				attributes: {
					class: "fat-editor-content",
					style: contentStyle,
					...(ariaLabel ? { "aria-label": ariaLabel } : {}),
					...(ariaRequired ? { "aria-required": "true" } : {}),
				},
				handleTextInput: (_view, from, _to, text) => {
					if (text === "@") {
						updateMention({ from, query: "" });
					}
					return false;
				},
				handleDOMEvents: {
					keydown: (_view, event) => {
						if (event.key !== "Escape") return false;
						if (mention) {
							event.preventDefault();
							updateMention(null);
							return true;
						}
						if (linkOpen) {
							event.preventDefault();
							linkOpen = false;
							return true;
						}
						// ProseMirror cancels Escape itself; stop that so the dialog sees it.
						return true;
					},
				},
				handleKeyDown: (_view, event) => {
					const current = mention;
					if (!current) return false;
					const list = candidates;
					if (list.length === 0) return false;
					if (event.key === "ArrowDown") {
						event.preventDefault();
						activeMention = (activeMention + 1) % list.length;
						return true;
					}
					if (event.key === "ArrowUp") {
						event.preventDefault();
						activeMention =
							(activeMention - 1 + list.length) % list.length;
						return true;
					}
					if (event.key === "Enter") {
						event.preventDefault();
						insertMention(list[activeMention] ?? list[0]);
						return true;
					}
					return false;
				},
			},
			onUpdate: ({ editor: current }) => {
				const html = current.getHTML();
				lastEmitted = html;
				onChange(html);
				const active = mention;
				if (!active) return;
				const caret = current.state.selection.from;
				if (caret < active.from + 1) {
					updateMention(null);
					return;
				}
				const query = current.state.doc.textBetween(active.from + 1, caret);
				if (!/^\S*$/.test(query)) {
					updateMention(null);
					return;
				}
				if (query !== active.query) updateMention({ ...active, query });
				else positionMention();
			},
			onSelectionUpdate: ({ editor: current }) => {
				toolbar = readToolbar(current);
				if (mention) positionMention();
			},
			onTransaction: ({ editor: current }) => {
				toolbar = readToolbar(current);
			},
			onBlur: () => updateMention(null),
		});
		editor = instance;
		mounted = true;
		onEditor?.(instance);
	});

	onDestroy(() => {
		editor?.destroy();
		editor = null;
	});

	$effect(() => {
		const instance = editor;
		const next = value;
		if (!instance || next === lastEmitted) return;
		lastEmitted = null;
		if (next !== instance.getHTML() && !instance.isFocused) {
			instance.commands.setContent(next || "<p></p>", { emitUpdate: false });
		}
	});

	$effect(() => {
		const instance = editor;
		const signal = focusSignal;
		if (!instance || !signal) return;
		instance.commands.focus("end");
	});

	$effect(() => {
		const instance = editor;
		const next = editable;
		if (instance && instance.isEditable !== next) instance.setEditable(next);
	});

	$effect(() => {
		const query = mention?.query;
		if (query === undefined) {
			candidates = [];
			mentionPending = false;
			return;
		}
		let cancelled = false;
		mentionPending = true;
		api<UserRef[]>(`/api/users?query=${encodeURIComponent(query)}`)
			.then((users) => {
				if (cancelled) return;
				candidates = users;
				activeMention = 0;
			})
			.catch(() => {
				if (!cancelled) candidates = [];
			})
			.finally(() => {
				if (!cancelled) mentionPending = false;
			});
		return () => {
			cancelled = true;
		};
	});
</script>

<div class="fat-editor" bind:this={wrapperEl} style={wrapperStyle}>
	<div style="{toolbarStyle}{editable ? '' : ' opacity: 0.6;'}">
		<select
			aria-label="Text style"
			bind:value={heading}
			disabled={!editable}
			style={selectStyle}
			onchange={(event) => {
				const next = event.currentTarget.value;
				const instance = editor;
				if (!instance) return;
				if (next === "p") {
					instance.chain().focus().setParagraph().run();
					return;
				}
				const level = Number(next.slice(1)) as 1 | 2 | 3;
				instance.chain().focus().toggleHeading({ level }).run();
			}}
		>
			<option value="p">Normal text</option>
			<option value="h1">Heading 1</option>
			<option value="h2">Heading 2</option>
			<option value="h3">Heading 3</option>
		</select>
		<ToolButton
			title="Bold"
			active={toolbar.bold}
			disabled={!editable}
			onclick={() => editor?.chain().focus().toggleBold().run()}
		>
			<Icon name="bold" />
		</ToolButton>
		<ToolButton
			title="Italic"
			active={toolbar.italic}
			disabled={!editable}
			onclick={() => editor?.chain().focus().toggleItalic().run()}
		>
			<Icon name="italic" />
		</ToolButton>
		<ToolButton
			title="Underline"
			active={toolbar.underline}
			disabled={!editable}
			onclick={() => editor?.chain().focus().toggleUnderline().run()}
		>
			<Icon name="underline" />
		</ToolButton>
		<ToolButton
			title="Strikethrough"
			active={toolbar.strike}
			disabled={!editable}
			onclick={() => editor?.chain().focus().toggleStrike().run()}
		>
			<Icon name="strikethrough" />
		</ToolButton>
		<span style={separatorStyle}></span>
		<ToolButton
			title="Bullet list"
			active={toolbar.bulletList}
			disabled={!editable}
			onclick={() => editor?.chain().focus().toggleBulletList().run()}
		>
			<Icon name="bullet-list" />
		</ToolButton>
		<ToolButton
			title="Numbered list"
			active={toolbar.orderedList}
			disabled={!editable}
			onclick={() => editor?.chain().focus().toggleOrderedList().run()}
		>
			<Icon name="numbered-list" />
		</ToolButton>
		<ToolButton
			title="Task list"
			active={toolbar.taskList}
			disabled={!editable}
			onclick={() => editor?.chain().focus().toggleTaskList().run()}
		>
			<Icon name="task-list" />
		</ToolButton>
		<span style={separatorStyle}></span>
		<ToolButton
			title="Link"
			active={toolbar.link}
			disabled={!editable}
			onclick={openLink}
		>
			<Icon name="link" />
		</ToolButton>
		{#if uploadImage}
			<ToolButton
				title={uploading ? "Uploading image…" : "Image"}
				disabled={!editable || uploading}
				onclick={() => imageInput?.click()}
			>
				<Icon name="image" />
			</ToolButton>
		{/if}
		<ToolButton
			title="Table"
			disabled={!editable}
			onclick={() =>
				editor
					?.chain()
					.focus()
					.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
					.run()}
		>
			<Icon name="table" />
		</ToolButton>
		<span style={separatorStyle}></span>
		<ToolButton
			title="Inline code"
			active={toolbar.code}
			disabled={!editable}
			onclick={() => editor?.chain().focus().toggleCode().run()}
		>
			<Icon name="inline-code" />
		</ToolButton>
		<ToolButton
			title="Code block"
			active={toolbar.codeBlock}
			disabled={!editable}
			onclick={() => editor?.chain().focus().toggleCodeBlock().run()}
		>
			<Icon name="code-block" />
		</ToolButton>
		<ToolButton
			title="Quote"
			active={toolbar.blockquote}
			disabled={!editable}
			onclick={() => editor?.chain().focus().toggleBlockquote().run()}
		>
			<Icon name="quote" />
		</ToolButton>
	</div>

	{#if linkOpen}
		<div
			style="display: flex; gap: 6px; padding: 6px; border-bottom: 1px solid {token(
				'color.border',
			)};"
		>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				autofocus
				aria-label="Link URL"
				placeholder="https://example.com"
				bind:value={linkValue}
				onkeydown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						applyLink();
					}
					if (event.key === "Escape") {
						event.preventDefault();
						linkOpen = false;
					}
				}}
				style={linkInputStyle}
			/>
			<button type="button" onclick={applyLink} style={applyButtonStyle}>
				Apply
			</button>
		</div>
	{/if}

	{#if uploadImage}
		<input
			bind:this={imageInput}
			type="file"
			accept="image/*"
			aria-label="Insert image"
			style="display: none;"
			onchange={(event) => {
				const file = event.currentTarget.files?.[0];
				event.currentTarget.value = "";
				if (file) void insertImage(file);
			}}
		/>
	{/if}

	{#if !mounted}
		<div class="fat-editor-content" style={contentStyle}>
			{@html staticHtml}
		</div>
	{/if}
	<div bind:this={mountEl}></div>

	{#if mention && mentionPosition}
		<MentionList
			users={candidates}
			active={activeMention}
			pending={mentionPending}
			left={mentionPosition.left}
			top={mentionPosition.top}
			onPick={insertMention}
		/>
	{/if}
</div>
