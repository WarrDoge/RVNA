<script lang="ts">
	import type { Editor } from "@tiptap/core";
	import type { Node as PmNode } from "@tiptap/pm/model";
	import { untrack } from "svelte";
	import {
		type MacroParam,
		safeBorderStyle,
		safeBorderWidth,
		safeColour,
	} from "#lib/shared/wiki/index.ts";
	import { getParam, macroDef } from "./macros.ts";
	import MacroEditor from "./MacroEditor.svelte";
	import MacroFrame from "./MacroFrame.svelte";
	import MacroToc from "./MacroToc.svelte";
	import { calloutGlyph, jiraText } from "./macro-view-helpers.ts";

	interface Props {
		node: PmNode;
		selected: boolean;
		editor: Editor;
		getPos: () => number | undefined;
		updateAttributes: (attrs: Record<string, unknown>) => void;
		deleteNode: () => void;
	}

	let {
		node,
		selected,
		editor,
		getPos,
		updateAttributes,
		deleteNode,
	}: Props = $props();

	let name = $derived(String(node.attrs.name ?? ""));
	let def = $derived(macroDef(name));
	let params = $derived((node.attrs.params ?? []) as MacroParam[]);
	let body = $derived(String(node.attrs.body ?? ""));
	let bodyType = $derived(node.attrs.bodyType);
	let editable = $state(untrack(() => editor.isEditable));

	$effect(() => {
		const update = () => {
			editable = editor.isEditable;
			if (!editable) editing = false;
		};
		update();
		editor.on("update", update);
		return () => editor.off("update", update);
	});
	let rich = $derived(def?.body === "rich");
	let richKind = $derived(
		!!def && ["info", "note", "warning", "tip"].includes(def.name),
	);
	let title = $derived(getParam(params, "title"));
	let editing = $state(false);

	function openEditor() {
		if (def && editable) editing = true;
	}

	function save(nextParams: MacroParam[], nextBody: string) {
		updateAttributes({
			params: nextParams,
			body: def?.body === "plain" ? nextBody : node.attrs.body,
		});
		editing = false;
		editor.commands.focus();
	}

	function handleClick(event: MouseEvent) {
		if (!rich && def && editable) {
			const target = event.target as HTMLElement;
			if (
				!target.closest(".wke-macro-bar") &&
				!target.closest(".wke-macro-editor")
			) {
				openEditor();
			}
		}
	}

	let borderStyle = $derived(
		safeBorderStyle(getParam(params, "borderStyle")),
	);
	let borderColor = $derived(safeColour(getParam(params, "borderColor")));
	let borderWidth = $derived(
		safeBorderWidth(getParam(params, "borderWidth")),
	);
	let bgColor = $derived(safeColour(getParam(params, "bgColor")));
	let titleBgColor = $derived(safeColour(getParam(params, "titleBGColor")));
	let titleColor = $derived(safeColour(getParam(params, "titleColor")));

	let codeLines = $derived(body === "" ? [""] : body.split("\n"));
	let codeTitle = $derived(getParam(params, "title"));
	let codeLanguage = $derived(getParam(params, "language"));
	let codeNumbers = $derived(getParam(params, "linenumbers") === "true");
	let codeBody = $derived(body);

	let fileValue = $derived(getParam(params, "name") ?? "");
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
	class="wke-macro wke-macro-{def ? name : 'unknown'}{selected
		? ' is-selected'
		: ''}"
	data-macro={name}
	data-node-view-wrapper
	onclick={handleClick}
>
	{#if editable}
		<div class="wke-macro-bar" contenteditable="false">
			{#if def}
				<button type="button" aria-label="Edit macro" onclick={openEditor}>
					Edit
				</button>
			{/if}
			<button type="button" aria-label="Remove macro" onclick={() => deleteNode()}>
				Remove
			</button>
		</div>
	{/if}

	{#if editing && def}
		<MacroEditor
			{def}
			{params}
			{body}
			onSave={save}
			onCancel={() => (editing = false)}
		/>
	{/if}

	{#if !def}
		<div class="wke-unknown">
			<div class="wke-unknown-head" contenteditable="false">
				Unknown macro: <code>{name}</code>
				{params.length > 0
					? ` (${params.length} parameter${params.length === 1 ? "" : "s"})`
					: ""}
			</div>
			{#if bodyType === "rich"}
				<div class="wke-macro-body"><div data-node-view-content></div></div>
			{:else if bodyType === "plain" && body}
				<pre class="wke-unknown-body" contenteditable="false">{body}</pre>
			{/if}
		</div>
	{:else if richKind}
		<div class="wke-callout-inner">
			{#if getParam(params, "icon") !== "false"}
				<span class="wke-callout-icon" contenteditable="false">
					{calloutGlyph[def.name]}
				</span>
			{/if}
			<div class="wke-callout-main">
				{#if title}
					<div class="wke-callout-title" contenteditable="false">{title}</div>
				{/if}
				<div class="wke-macro-body"><div data-node-view-content></div></div>
			</div>
		</div>
	{:else if name === "panel"}
		<div
			class="wke-panel"
			style:border-style={borderStyle}
			style:border-color={borderColor}
			style:border-width={borderWidth === null
				? null
				: `${borderWidth}px`}
			style:background-color={bgColor}
		>
			{#if title}
				<div
					class="wke-panel-title"
					contenteditable="false"
					style:background-color={titleBgColor}
					style:color={titleColor}
					style:border-color={borderColor}
				>
					{title}
				</div>
			{/if}
			<div class="wke-macro-body"><div data-node-view-content></div></div>
		</div>
	{:else if name === "expand"}
		<div class="wke-expand">
			<div class="wke-expand-title" contenteditable="false">
				<span aria-hidden="true">▾</span>
				{title || "Click here to expand..."}
			</div>
			<div class="wke-macro-body"><div data-node-view-content></div></div>
		</div>
	{:else if name === "details"}
		<div class="wke-details">
			<div class="wke-details-title" contenteditable="false">
				Page Properties{getParam(params, "hidden") === "true" ? " (hidden)" : ""}
			</div>
			<div class="wke-macro-body"><div data-node-view-content></div></div>
		</div>
	{:else if name === "code"}
		<div class="wke-code" contenteditable="false">
			{#if codeTitle || (codeLanguage && codeLanguage !== "none")}
				<div class="wke-code-head">
					<span>{codeTitle}</span>
					{#if codeLanguage && codeLanguage !== "none"}
						<span class="wke-code-lang">{codeLanguage}</span>
					{/if}
				</div>
			{/if}
			<pre class:has-numbers={codeNumbers}>
				<code>
					{#each codeLines as line, index (index)}
						<span class="wke-code-line">{line}{"\n"}</span>
					{/each}
				</code>
			</pre>
			{#if codeBody === ""}
				<div class="wke-muted wke-code-empty">Empty code block</div>
			{/if}
		</div>
	{:else}
		<MacroFrame {name} label={def.label} {params} {def}>
			{#if name === "toc"}
				<MacroToc {editor} {params} />
			{:else if name === "view-file"}
				{#if fileValue === ""}
					<div class="wke-muted">No file selected.</div>
				{:else}
					<div class="wke-preview-file">{fileValue}</div>
				{/if}
			{:else if name === "jira"}
				<div class="wke-preview-file">{jiraText(params)}</div>
			{:else if name === "widget"}
				<div class="wke-preview-file">
					{getParam(params, "url") || "No URL yet"}
				</div>
			{/if}
		</MacroFrame>
	{/if}
</div>
