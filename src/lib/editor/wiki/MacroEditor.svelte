<script lang="ts">
	import { untrack } from "svelte";
	import type { MacroParam } from "#lib/shared/wiki/index.ts";
	import {
		applyFieldValues,
		fieldValue,
		type MacroDef,
		type MacroField,
	} from "./macros.ts";

	interface Props {
		def: MacroDef;
		params: MacroParam[];
		body: string;
		onSave: (params: MacroParam[], body: string) => void;
		onCancel: () => void;
	}

	let { def, params, body, onSave, onCancel }: Props = $props();

	let values = $state<Record<string, string>>(
		untrack(() =>
			Object.fromEntries(
				def.fields.map((field) => [field.name, fieldValue(params, field)]),
			),
		),
	);
	let bodyValue = $state(untrack(() => body));

	function setValue(field: MacroField, value: string) {
		values = { ...values, [field.name]: value };
	}

	function save() {
		onSave(applyFieldValues(params, def.fields, values), bodyValue);
	}
</script>

<div class="wke-macro-editor" contenteditable="false">
	<div class="wke-macro-editor-title">Edit {def.label}</div>
	{#each def.fields as field (field.name)}
		{#if field.type === "checkbox"}
			<label class="wke-field wke-field-check">
				<input
					type="checkbox"
					checked={values[field.name] === "true"}
					onchange={(event) =>
						setValue(field, event.currentTarget.checked ? "true" : "false")}
				/>
				<span class="wke-field-label">{field.label}</span>
			</label>
		{:else}
			<label class="wke-field">
				<span class="wke-field-label">{field.label}</span>
				{#if field.type === "select" || field.type === "attachment"}
					<select
						class="wke-input"
						value={values[field.name]}
						onchange={(event) => setValue(field, event.currentTarget.value)}
					>
						{#if !(field.options ?? []).some((option) => option.value === values[field.name])}
							<option value={values[field.name]}>{values[field.name]}</option>
						{/if}
						{#each field.options ?? [] as option (option.value)}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
				{:else if field.type === "textarea"}
					<textarea
						class="wke-input"
						rows="3"
						placeholder={field.placeholder}
						value={values[field.name]}
						oninput={(event) => setValue(field, event.currentTarget.value)}
					></textarea>
				{:else if field.type === "colour"}
					<span class="wke-colour-field">
						<input
							type="color"
							aria-label={`${field.label} colour`}
							value={/^#[0-9a-f]{6}$/i.test(values[field.name])
								? values[field.name]
								: "#000000"}
							oninput={(event) => setValue(field, event.currentTarget.value)}
						/>
						<input
							class="wke-input"
							aria-label={`${field.label} value`}
							placeholder="#RRGGBB"
							title="Use a #RRGGBB colour"
							maxlength={7}
							value={values[field.name]}
							oninput={(event) => {
								const next = event.currentTarget.value.trim();
								if (next === "" || /^#[0-9a-f]{6}$/i.test(next)) {
									setValue(field, next);
								}
							}}
						/>
						{#if values[field.name] !== ""}
							<button
								type="button"
								class="wke-link-button"
								onclick={() => setValue(field, "")}
							>
								Clear
							</button>
						{/if}
					</span>
				{:else}
					<input
						class="wke-input"
						placeholder={field.placeholder}
						value={values[field.name]}
						oninput={(event) => setValue(field, event.currentTarget.value)}
					/>
				{/if}
			</label>
		{/if}
		{#if field.help}
			<div class="wke-field-help">{field.help}</div>
		{/if}
	{/each}
	{#if def.body === "plain"}
		<label class="wke-field">
			<span class="wke-field-label">Body</span>
			<textarea
				class="wke-input wke-code-input"
				rows="5"
				value={bodyValue}
				oninput={(event) => (bodyValue = event.currentTarget.value)}
			></textarea>
		</label>
	{/if}
	<div class="wke-macro-editor-actions">
		<button type="button" class="wke-primary-button" onclick={save}>Save</button>
		<button type="button" class="wke-link-button" onclick={onCancel}>
			Cancel
		</button>
	</div>
</div>
