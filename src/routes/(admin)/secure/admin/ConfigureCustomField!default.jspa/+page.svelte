<script lang="ts">
	import { invalidate } from "$app/navigation";
	import { api } from "#lib/api.ts";
	import { errorMessage } from "#lib/admin/config.ts";
	import { fieldTypeLabel } from "#lib/admin/custom-fields.ts";
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import Banner from "#lib/admin/Banner.svelte";
	import FormField from "#lib/components/FormField.svelte";
	import InlineEditable from "../_custom-fields/InlineEditable.svelte";
	import OptionsSection from "../_custom-fields/OptionsSection.svelte";
	import ContextsSection from "../_custom-fields/ContextsSection.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let requiredOverride = $state<{
		fieldId: string;
		base: boolean;
		value: boolean;
	} | null>(null);
	let error = $state<string | null>(null);

	let field = $derived(data.field);
	let required = $derived(
		field &&
			requiredOverride?.fieldId === field.id &&
			requiredOverride.base === field.required
			? requiredOverride.value
			: (field?.required ?? false),
	);

	let description = $derived.by(() => {
		if (!field) return undefined;
		const used =
			field.issueCount > 0
				? ` · used on ${field.issueCount} issue${field.issueCount === 1 ? "" : "s"}`
				: "";
		return `${fieldTypeLabel(field.type)}${used}`;
	});

	async function patch(body: Record<string, unknown>) {
		if (!field) return;
		await api(`/api/admin/custom-fields/${encodeURIComponent(field.id)}`, {
			method: "PATCH",
			body: JSON.stringify(body),
		});
		await Promise.all([
			invalidate("app:admin-field"),
			invalidate("app:admin-fields"),
		]);
	}
</script>

<AdminPage
	title={field ? field.name : "Custom field"}
	description={description}
>
	{#snippet breadcrumb()}
		<a href="/secure/admin/ViewCustomFields.jspa" class="breadcrumb-link">
			Custom fields
		</a>
		{#if field}
			{" / "}
			{field.name}
		{/if}
	{/snippet}

	{#if !data.id}
		<Banner tone="danger">
			No custom field was chosen. Open a field from the custom fields list.
		</Banner>
	{:else if !field}
		<Banner tone="danger">
			{data.fieldError ?? "This custom field does not exist."}
		</Banner>
	{:else}
		{#if error}
			<Banner tone="danger">{error}</Banner>
		{/if}
		{#if !field.configurable}
			<Banner>
				This field comes from an integration and is read only here.
			</Banner>
		{/if}

		{#if field.configurable}
			<div class="details">
				<FormField label="Name" htmlFor="field-name">
					<InlineEditable
						value={field.name}
						ariaLabel="field name"
						onSave={async (value) => {
							error = null;
							await patch({ name: value });
						}}
					>
						{#snippet display()}
							<span class="inline-value">{field.name}</span>
						{/snippet}
					</InlineEditable>
				</FormField>
				<FormField label="Description" htmlFor="field-description">
					<InlineEditable
						value={field.description ?? ""}
						ariaLabel="field description"
						placeholder="What should this field capture?"
						multiline
						onSave={async (value) => {
							error = null;
							await patch({ description: value === "" ? null : value });
						}}
					>
						{#snippet display()}
							<span
								class="inline-value"
								class:placeholder={!field.description}
							>
								{field.description ?? "Add a description"}
							</span>
						{/snippet}
					</InlineEditable>
				</FormField>
				<label class="required-label">
					<input
						type="checkbox"
						bind:checked={() => required, (value) => {
							if (field) {
								requiredOverride = {
									fieldId: field.id,
									base: field.required,
									value,
								};
							}
							error = null;
							void patch({ required: value }).catch((cause) => {
								requiredOverride = null;
								error = errorMessage(cause);
							});
						}}
					/>
					Required
					<span class="required-hint">
						An issue of a matching type cannot be saved without a value.
					</span>
				</label>
			</div>

			<OptionsSection {field} />
			<ContextsSection
				{field}
				projects={data.projects}
				issueTypes={data.issueTypes}
			/>
		{:else}
			<p class="read-only-note">
				Contexts and options of this field are maintained by the integration
				that created it.
			</p>
		{/if}
	{/if}
</AdminPage>

<style>
	.breadcrumb-link {
		color: var(--ds-link);
		text-decoration: none;
	}

	.details {
		margin-bottom: 24px;
		max-width: 720px;
	}

	.inline-value {
		font-size: 14px;
	}

	.inline-value.placeholder {
		color: var(--ds-text-subtlest);
	}

	.required-label {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--ds-text);
	}

	.required-hint {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.read-only-note {
		margin: 0;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}
</style>
