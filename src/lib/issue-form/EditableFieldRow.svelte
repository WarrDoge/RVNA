<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { EditableCustomField, Me } from "#lib/api-types.ts";
	import { untrack } from "svelte";
	import { dismiss } from "#lib/components/dismiss.ts";
	import {
		fieldValueProblem,
		isEmptyFieldValue,
	} from "./custom-field-values.ts";
	import FieldValueDisplay from "./FieldValueDisplay.svelte";
	import FieldValueEditor from "./FieldValueEditor.svelte";
	import {
		detailLabelStyle,
		detailValueStyle,
		errorStyle,
	} from "./styles.ts";

	interface Props {
		field: EditableCustomField;
		me: Me | null;
		onSave: (fieldId: string, value: unknown) => Promise<void>;
	}

	const POPUP_TYPES = new Set([
		"select",
		"multiselect",
		"cascading",
		"user",
		"multiuser",
	]);

	let { field, me, onSave }: Props = $props();

	let editing = $state(false);
	let draft = $state<unknown>(untrack(() => field.value));
	let error = $state<string | null>(null);
	let saving = $state(false);

	const popup = POPUP_TYPES.has(untrack(() => field.type));


	function start() {
		draft = field.value;
		error = null;
		editing = true;
	}

	async function save(value: unknown) {
		if (field.required && isEmptyFieldValue(value)) {
			draft = field.value;
			error = `${field.name} is required and cannot be cleared.`;
			return;
		}
		const problem = fieldValueProblem(field, value);
		if (problem) {
			draft = field.value;
			error = problem;
			return;
		}
		saving = true;
		try {
			await onSave(field.id, isEmptyFieldValue(value) ? null : value);
			error = null;
			editing = false;
		} catch (cause) {
			draft = field.value;
			error =
				cause instanceof Error
					? cause.message
					: "The value could not be saved";
		} finally {
			saving = false;
		}
	}

	function change(value: unknown) {
		draft = value;
		if (popup) void save(value);
	}

	const editStyle = `display: block; width: 100%; padding: 2px 4px; margin-left: -4px; border-radius: 3px; color: ${token(
		"color.text",
	)}; font-size: 14px; line-height: 20px; text-align: left;`;
	const editButtonStyle = `flex: none; padding: 0; background: transparent; border: 0; color: ${token(
		"color.link",
	)}; cursor: pointer; font-size: 12px;`;
	const actionRowStyle = "display: flex; gap: 8px; margin-top: 4px;";
	const saveStyle = `padding: 0; background: transparent; border: 0; color: ${token(
		"color.link",
	)}; cursor: pointer; font-size: 12px;`;
	const cancelStyle = `padding: 0; background: transparent; border: 0; color: ${token(
		"color.text.subtle",
	)}; cursor: pointer; font-size: 12px;`;
</script>

<div style={detailLabelStyle}>
	{field.name}
	{#if field.required}<span style="color: #e5493a;"> *</span>{/if}
</div>
<div
	{@attach dismiss(() => editing && popup, () => (editing = false))}
	style={detailValueStyle}
>
	{#if editing}
		<div>
			<FieldValueEditor
				field={field}
				value={draft}
				onChange={change}
				{me}
				autoFocus
			/>
			{#if !popup}
				<div style={actionRowStyle}>
					<button type="button" onclick={() => save(draft)} style={saveStyle}>
						{saving ? "Saving…" : "Save"}
					</button>
					<button
						type="button"
						onclick={() => {
							editing = false;
						}}
						style={cancelStyle}
					>
						Cancel
					</button>
				</div>
			{/if}
			{#if error}
				<div role="alert" style={errorStyle}>{error}</div>
			{/if}
		</div>
	{:else if field.type === "url"}
		<div style="display: flex; align-items: flex-start; gap: 8px;">
			<div style={editStyle}>
				<FieldValueDisplay field={field} value={field.value} />
			</div>
			<button
				type="button"
				title={`Edit ${field.name}`}
				onclick={start}
				onkeydown={(event) => {
					if (event.key === "Enter" || event.key === "F2") start();
				}}
				style={editButtonStyle}
			>
				Edit
			</button>
		</div>
	{:else}
		<button
			type="button"
			title={`Edit ${field.name}`}
			onclick={start}
			onkeydown={(event) => {
				if (event.key === "Enter" || event.key === "F2") start();
			}}
			style={editStyle}
		>
			<FieldValueDisplay field={field} value={field.value} />
		</button>
	{/if}
	{#if !editing && error}
		<div role="alert" style={errorStyle}>{error}</div>
	{/if}
</div>
