<script lang="ts">
	import type { Snippet } from "svelte";
	import ErrorText from "#lib/admin/ErrorText.svelte";

	export type FormFieldAria = {
		describedBy: string | undefined;
		invalid: boolean;
		required: boolean;
	};

	interface Props {
		label: string;
		htmlFor: string;
		hint?: string | Snippet;
		error?: string | null;
		required?: boolean;
		children: Snippet<[FormFieldAria]>;
	}

	let {
		label,
		htmlFor,
		hint,
		error,
		required = false,
		children,
	}: Props = $props();

	let describedBy = $derived(
		[hint ? `${htmlFor}-hint` : null, error ? `${htmlFor}-error` : null]
			.filter((id): id is string => id !== null)
			.join(" ") || undefined,
	);
</script>

<div class="form-field">
	<div class="form-field-label-row">
		<label class="form-field-label" for={htmlFor}>{label}</label>
		{#if required}
			<span class="form-field-required" aria-hidden="true">*</span>
		{/if}
	</div>
	{@render children({ describedBy, invalid: error != null, required })}
	{#if hint}
		<span class="form-field-hint" id={`${htmlFor}-hint`}>
			{#if typeof hint === "string"}
				{hint}
			{:else}
				{@render hint()}
			{/if}
		</span>
	{/if}
	{#if error}
		<div id={`${htmlFor}-error`}><ErrorText>{error}</ErrorText></div>
	{/if}
</div>

<style>
	.form-field {
		margin-bottom: 16px;
	}

	.form-field-label-row {
		display: flex;
		align-items: baseline;
		gap: 2px;
		margin-bottom: 4px;
	}

	.form-field-label {
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle);
	}

	.form-field-required {
		color: var(--ds-text-danger);
	}

	.form-field-hint {
		display: block;
		margin-top: 4px;
		font-size: 12px;
		color: var(--ds-text-subtle);
	}
</style>
