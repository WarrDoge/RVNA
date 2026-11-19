<script lang="ts">
	import { untrack } from "svelte";
	import type { Editor } from "@tiptap/core";
	import {
		applyFieldValues,
		fieldValue,
		macroDef,
	} from "#lib/editor/wiki/macros.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import type {
		MacroParam,
		UploadedAttachment,
	} from "#lib/shared/wiki/index.ts";
	import MacroField from "./MacroField.svelte";

	interface Props {
		editor: Editor;
		pos: number;
		isNew: boolean;
		attachments: UploadedAttachment[];
		onclose: () => void;
	}

	let { editor, pos, isNew, attachments, onclose }: Props = $props();

	const instance = untrack(() => editor);
	const posValue = untrack(() => pos);
	const isNewValue = untrack(() => isNew);
	const node = instance.state.doc.nodeAt(posValue);
	const def = node ? macroDef(String(node.attrs.name)) : undefined;
	const initial = Object.fromEntries(
		(def?.fields ?? []).map((field) => [
			field.name,
			fieldValue((node?.attrs.params ?? []) as MacroParam[], field),
		]),
	);
	let values = $state<Record<string, string>>(initial);
	let body = $state(String(node?.attrs.body ?? ""));

	function cancel() {
		if (isNewValue && node) {
			instance
				.chain()
				.command(({ tr }) => {
					tr.delete(posValue, posValue + (instance.state.doc.nodeAt(posValue)?.nodeSize ?? 0));
					return true;
				})
				.focus()
				.run();
		}
		onclose();
		queueMicrotask(() => instance.view.focus());
	}

	function save() {
		if (!node || !def) return;
		const attrs = {
			...node.attrs,
			params: applyFieldValues(node.attrs.params, def.fields, values),
			body: def.body === "plain" ? body : node.attrs.body,
		};
		const chain = instance.chain().command(({ tr }) => {
			tr.setNodeMarkup(posValue, undefined, attrs);
			return true;
		});
		if (def?.body === "rich") chain.setTextSelection(posValue + 2);
		chain.run();
		instance.view.focus();
		onclose();
		queueMicrotask(() => instance.view.focus());
	}

	function onKeyDown(event: KeyboardEvent) {
		const target = event.target as HTMLElement;
		if (
			event.key === "Enter" &&
			target instanceof HTMLInputElement &&
			target.type === "text"
		) {
			event.preventDefault();
			save();
		}
	}
</script>

{#snippet footer()}
	<Button appearance="primary" onclick={save}>{isNewValue ? "Insert" : "Save"}</Button>
	<Button appearance="subtle" onclick={cancel}>Cancel</Button>
{/snippet}

{#if node && def}
	<Modal
		title={isNewValue ? `Insert ${def.label}` : `Edit ${def.label}`}
		width={520}
		onClose={cancel}
		returnFocus={false}
		{footer}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="wke-dialog-form" onkeydown={onKeyDown}>
			{#if def.body === "plain"}
				<div class="wke-field">
					<label for="wke-macro-body" class="wke-field-label">Code</label>
					<textarea
						id="wke-macro-body"
						class="wke-input wke-code-input"
						rows={10}
						spellcheck={false}
						bind:value={body}
					></textarea>
				</div>
			{/if}
			{#each def.fields as field (field.name)}
				<MacroField
					{field}
					value={values[field.name] ?? field.default}
					onchange={(value) => (values = { ...values, [field.name]: value })}
					{attachments}
				/>
			{/each}
		</div>
	</Modal>
{/if}
