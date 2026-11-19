<script lang="ts">
	import { Extension } from "@tiptap/core";
	import { Editor } from "@tiptap/core";
	import Placeholder from "@tiptap/extension-placeholder";
	import { onDestroy, onMount, untrack } from "svelte";
	import type { MacroDef } from "#lib/editor/wiki/macros.ts";
	import {
		InlineMacroNode,
		MacroNode,
	} from "#lib/editor/wiki/MacroNodes.ts";
	import { schemaExtensions } from "#lib/editor/wiki/extensions.ts";
	import type {
		UploadedAttachment,
		WikiDoc,
	} from "#lib/shared/wiki/index.ts";
	import DatePicker from "./DatePicker.svelte";
	import EmojiPicker from "./EmojiPicker.svelte";
	import type { Anchor } from "./Floating.svelte";
	import type { InsertActions } from "./insert-actions.ts";
	import { insertMacroNode } from "./insert-actions.ts";
	import LayoutToolbar from "./LayoutToolbar.svelte";
	import LinkDialog from "./LinkDialog.svelte";
	import MacroBrowser from "./MacroBrowser.svelte";
	import MacroDialog from "./MacroDialog.svelte";
	import TableToolbar from "./TableToolbar.svelte";
	import Toolbar from "./Toolbar.svelte";
	import TriggerPopup from "./TriggerPopup.svelte";
	import {
		type KeyHandler,
		type TriggerMatch,
		triggerPlugin,
	} from "./triggers.ts";
	import "#lib/editor/wiki/macro.css";
	import {
		attachmentContent,
		pastedFileName,
		pastedFilesToUpload,
		uploadAttachments,
	} from "./upload.ts";
	import "./editor.css";

	interface Props {
		/** initial document; the editor is uncontrolled after mount, remount with a new `key` to reset it */
		doc: WikiDoc;
		onchange: (doc: WikiDoc) => void;
		spaceKey: string;
		/** the page being edited; unpublished new pages are draft rows, so a page id always exists (uploads need it) */
		pageId: string;
		/** called when the user presses Ctrl+S inside the editor */
		onpublishshortcut?: () => void;
		autoFocus?: boolean;
		/** when false the content is not editable (a lock was taken over) */
		editable?: boolean;
		attachments?: UploadedAttachment[];
	}

	let {
		doc,
		onchange,
		spaceKey,
		pageId,
		onpublishshortcut,
		autoFocus = false,
		editable = true,
		attachments: initialAttachments = [],
	}: Props = $props();

	let mountEl: HTMLDivElement;
	let fileInput = $state<HTMLInputElement>();
	let editor = $state.raw<Editor | null>(null);
	let macroDialog = $state<{ pos: number; isNew: boolean } | null>(null);
	let linkOpen = $state(false);
	let browserOpen = $state(false);
	let trigger = $state.raw<TriggerMatch | null>(null);
	let emojiAnchor = $state<Anchor | null>(null);
	let dateState = $state<{
		anchor: Anchor;
		pos?: number;
		initial?: string;
	} | null>(null);
	let uploading = $state(0);
	let uploadError = $state<string | null>(null);
	let attachments = $state<UploadedAttachment[]>(
		untrack(() => initialAttachments),
	);

	let keyHandler: KeyHandler | null = null;

	function setKeyHandler(handler: KeyHandler | null) {
		keyHandler = handler;
	}

	function caretAnchor(): Anchor {
		const { left, top, bottom } = editor?.view.coordsAtPos(
			editor.state.selection.from,
		) ?? { left: 0, top: 0, bottom: 0 };
		return { left, top, bottom };
	}

	async function upload(files: File[], pos?: number) {
		const instance = editor;
		if (!instance) return;
		uploading += files.length;
		uploadError = null;
		try {
			const uploaded = await uploadAttachments(pageId, files);
			const content = uploaded.flatMap(attachmentContent);
			const chain = instance.chain().focus();
			if (pos === undefined) chain.insertContent(content);
			else chain.insertContentAt(pos, content);
			chain.run();
			attachments = [...attachments, ...uploaded];
		} catch (error) {
			uploadError = error instanceof Error ? error.message : "Upload failed";
		} finally {
			uploading -= files.length;
		}
	}

	function insertMacro(def: MacroDef) {
		const instance = editor;
		if (!instance) return;
		const pos = insertMacroNode(instance, def);
		if (pos !== null) macroDialog = { pos, isNew: true };
	}

	const actions: InsertActions = {
		openLink: () => {
			if (editor?.isEditable) linkOpen = true;
		},
		openMacroBrowser: () => {
			browserOpen = true;
		},
		insertMacro,
		pickFiles: (kind) => {
			const input = fileInput;
			if (!input) return;
			input.accept = kind === "image" ? "image/*" : "";
			input.click();
		},
		openDate: () => {
			dateState = { anchor: caretAnchor() };
		},
		openEmoji: () => {
			emojiAnchor = caretAnchor();
		},
	};

	onMount(() => {
		const instance = new Editor({
			element: mountEl,
			extensions: [
				...schemaExtensions({ macro: MacroNode, inlineMacro: InlineMacroNode }),
				Placeholder.configure({
					placeholder: ({ node }) =>
						node.type.name === "heading"
							? "Heading"
							: "Type / to insert, @ to mention",
				}),
				Extension.create({
					name: "wikiBehaviour",
					addKeyboardShortcuts() {
						return {
							"Mod-s": () => {
								onpublishshortcut?.();
								return true;
							},
							"Mod-k": () => {
								actions.openLink();
								return true;
							},
						};
					},
					addProseMirrorPlugins() {
						return [
							triggerPlugin({
								onMatch: (match) => {
									trigger = match;
								},
								onKey: (event) => keyHandler?.(event) ?? false,
								openLink: () => actions.openLink(),
								openMacros: () => actions.openMacroBrowser(),
							}),
						];
					},
				}),
			],
			content: doc,
			editable,
			autofocus: autoFocus ? "start" : false,
			editorProps: {
				attributes: {
					class: "wke-content fat-editor-content",
					"aria-label": "Page body",
				},
				handlePaste: (_view, event) => {
					const data = event.clipboardData;
					if (!data) return false;
					const files = pastedFilesToUpload(
						Array.from(data.files),
						data.getData("text/html"),
					);
					if (files.length === 0) return false;
					event.preventDefault();
					void upload(
						files.map(
							(file) =>
								new File([file], pastedFileName(file.name, file.type), {
									type: file.type,
								}),
						),
					);
					return true;
				},
				handleDrop: (view, event, _slice, moved) => {
					const files = Array.from(event.dataTransfer?.files ?? []);
					if (moved || files.length === 0) return false;
					event.preventDefault();
					const at = view.posAtCoords({
						left: event.clientX,
						top: event.clientY,
					});
					void upload(files, at?.pos);
					return true;
				},
				handleClickOn: (view, _pos, node, nodePos) => {
					if (node.type.name === "date" && view.editable) {
						dateState = {
							anchor: view.coordsAtPos(nodePos),
							pos: nodePos,
							initial: String(node.attrs.datetime ?? ""),
						};
					}
					return false;
				},
			},
			onUpdate: ({ editor: current, transaction }) => {
				// setEditable emits an update too; only a document change is an edit.
				if (!transaction.docChanged) return;
				onchange(current.getJSON() as WikiDoc);
			},
		});
		editor = instance;
	});

	$effect(() => {
		if (editor && editor.isEditable !== editable) editor.setEditable(editable);
	});

	onDestroy(() => {
		editor?.destroy();
		editor = null;
	});
</script>

<div class="wke{editable ? '' : ' is-readonly'}">
	{#if editor}
		<Toolbar {editor} disabled={!editable} {actions} />
	{/if}
	<div bind:this={mountEl} class="wke-scroll"></div>
	{#if editor && editable}
		<TableToolbar {editor} />
		<LayoutToolbar {editor} />
	{/if}
	{#if uploading > 0 || uploadError}
		<div class="wke-status" role="status">
			{#if uploading > 0}
				Uploading {uploading} file{uploading === 1 ? "" : "s"}...
			{/if}
			{#if uploadError}
				{" "}Upload failed: {uploadError}{" "}
				<button
					type="button"
					class="wke-link-button"
					onclick={() => (uploadError = null)}
				>
					Dismiss
				</button>
			{/if}
		</div>
	{/if}
	<input
		bind:this={fileInput}
		type="file"
		multiple
		hidden
		aria-label="Upload files"
		onchange={(event) => {
			const files = Array.from(event.currentTarget.files ?? []);
			event.currentTarget.value = "";
			if (files.length > 0) void upload(files);
		}}
	/>
</div>

{#if editor && editable && trigger}
	{#key `${trigger.kind}:${trigger.query}`}
		<TriggerPopup
			{editor}
			match={trigger}
			{actions}
			onKeyChange={setKeyHandler}
		/>
	{/key}
{/if}
{#if editor && linkOpen}
	<LinkDialog
		{editor}
		{spaceKey}
		onclose={() => (linkOpen = false)}
	/>
{/if}
{#if editor && browserOpen}
	<MacroBrowser
		onclose={() => (browserOpen = false)}
		onpick={(def) => {
			browserOpen = false;
			insertMacro(def);
		}}
	/>
{/if}
{#if editor && macroDialog}
	<MacroDialog
		{editor}
		pos={macroDialog.pos}
		isNew={macroDialog.isNew}
		{attachments}
		onclose={() => (macroDialog = null)}
	/>
{/if}
{#if editor && emojiAnchor}
	<EmojiPicker
		anchor={emojiAnchor}
		onclose={() => (emojiAnchor = null)}
		onpick={(choice) => {
			emojiAnchor = null;
			const instance = editor;
			if (!instance) return;
			instance
				.chain()
				.focus()
				.insertContent([
					{ type: "emoticon", attrs: choice.attrs },
					{ type: "text", text: " " },
				])
				.run();
		}}
	/>
{/if}
{#if editor && dateState}
	<DatePicker
		anchor={dateState.anchor}
		initial={dateState.initial}
		onclose={() => (dateState = null)}
		onpick={(datetime) => {
			const instance = editor;
			if (!instance) return;
			const { pos } = dateState ?? {};
			dateState = null;
			const chain = instance.chain().focus();
			if (pos === undefined) {
				chain.insertContent({ type: "date", attrs: { datetime } });
			} else {
				chain.command(({ tr }) => {
					tr.setNodeMarkup(pos, undefined, { datetime });
					return true;
				});
			}
			chain.run();
		}}
	/>
{/if}
