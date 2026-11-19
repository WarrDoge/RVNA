<script lang="ts">
	import type { MacroField } from "#lib/editor/wiki/macros.ts";
	import type { UploadedAttachment } from "#lib/shared/wiki/index.ts";

	interface Props {
		field: MacroField;
		value: string;
		onchange: (value: string) => void;
		attachments: UploadedAttachment[];
	}

	let { field, value, onchange, attachments }: Props = $props();

	const id = $props.id();
	let options = $derived(
		field.type === "attachment"
			? [
					{ value: "", label: "Select a file" },
					...attachments.map((item) => ({
						value: item.fileName,
						label: item.fileName,
					})),
				]
			: (field.options ?? []),
	);
	let known = $derived(options.some((option) => option.value === value));
</script>

{#if field.type === "checkbox"}
	<div class="wke-field wke-field-check">
		<input
			{id}
			type="checkbox"
			checked={value === "true"}
			onchange={(event) =>
				onchange(event.currentTarget.checked ? "true" : "false")}
		/>
		<label for={id} class="wke-field-label">{field.label}</label>
		{#if field.help}<div class="wke-field-help">{field.help}</div>{/if}
	</div>
{:else}
	<div class="wke-field">
		<label for={id} class="wke-field-label">{field.label}</label>
		{#if field.type === "select" || field.type === "attachment"}
			<select
				{id}
				class="wke-input"
				value={value}
				onchange={(event) => onchange(event.currentTarget.value)}
			>
				{#if !known}<option value={value}>{value}</option>{/if}
				{#each options as option (option.value)}
					<option value={option.value}>{option.label}</option>
				{/each}
			</select>
		{:else if field.type === "textarea"}
			<textarea
				{id}
				class="wke-input"
				rows={3}
				placeholder={field.placeholder}
				value={value}
				oninput={(event) => onchange(event.currentTarget.value)}
			></textarea>
		{:else if field.type === "colour"}
			<div class="wke-colour-field">
				<input
					{id}
					type="color"
					value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
					oninput={(event) => onchange(event.currentTarget.value)}
				/>
				<input
					class="wke-input"
					aria-label={`${field.label} value`}
					placeholder="#RRGGBB"
					title="Use a #RRGGBB colour"
					maxlength={7}
					value={value}
					oninput={(event) => {
						const next = event.currentTarget.value.trim();
						if (next === "" || /^#[0-9a-f]{6}$/i.test(next)) onchange(next);
					}}
				/>
				{#if value !== ""}
					<button type="button" class="wke-link-button" onclick={() => onchange("")}>
						Clear
					</button>
				{/if}
			</div>
		{:else}
			<input
				{id}
				class="wke-input"
				placeholder={field.placeholder}
				value={value}
				oninput={(event) => onchange(event.currentTarget.value)}
			/>
		{/if}
		{#if field.help}<div class="wke-field-help">{field.help}</div>{/if}
	</div>
{/if}
