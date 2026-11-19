<script lang="ts">
	import {
		contextSummary,
		FIELD_TYPES,
		fieldTypeLabel,
		type AdminField,
	} from "#lib/admin/custom-fields.ts";
	import { inputStyle } from "#lib/admin/styles.ts";
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import ConfigTable from "#lib/admin/ConfigTable.svelte";
	import EmptyRow from "#lib/admin/EmptyRow.svelte";
	import Button from "#lib/components/Button.svelte";
	import AddFieldDialog from "../_custom-fields/AddFieldDialog.svelte";
	import DeleteFieldDialog from "../_custom-fields/DeleteFieldDialog.svelte";
	import EditFieldDialog from "../_custom-fields/EditFieldDialog.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let filter = $state("");
	let typeFilter = $state("");
	let showSystem = $state(false);
	let creating = $state(false);
	let editing = $state<AdminField | null>(null);
	let deleting = $state<AdminField | null>(null);

	let all = $derived(data.fields);
	let needle = $derived(filter.trim().toLowerCase());
	let visible = $derived.by(() =>
		all.filter((field) => {
			if (!field.configurable && !showSystem) return false;
			if (typeFilter !== "" && field.type !== typeFilter) return false;
			if (needle === "") return true;
			return (
				field.name.toLowerCase().includes(needle) ||
				(field.description ?? "").toLowerCase().includes(needle)
			);
		}),
	);
	let candidates = $derived(
		deleting
			? all.filter(
					(field) =>
						field.id !== deleting?.id &&
						field.configurable &&
						field.type === deleting?.type,
				)
			: [],
	);
</script>

<AdminPage
	title="Custom fields"
	description="Fields that capture extra information on issues. A field is only shown on issues of the projects and issue types listed for it."
>
	{#snippet actions()}
		<Button appearance="primary" onclick={() => (creating = true)}>
			Add custom field
		</Button>
	{/snippet}

	<div class="toolbar">
		<input
			aria-label="Filter custom fields"
			placeholder="Filter by name or description"
			bind:value={filter}
			style="{inputStyle} width: 280px;"
		/>
		<select
			aria-label="Filter by type"
			bind:value={typeFilter}
			style="{inputStyle} width: 240px;"
		>
			<option value="">All types</option>
			{#each FIELD_TYPES as type (type.id)}
				<option value={type.id}>{type.label}</option>
			{/each}
		</select>
		<label class="system-toggle">
			<input type="checkbox" bind:checked={showSystem} />
			Show system fields
		</label>
		<span class="field-count">{visible.length} of {all.length} fields</span>
	</div>

	<ConfigTable
		columns={[
			{ label: "Name" },
			{ label: "Type", width: 210 },
			{ label: "Required", width: 90 },
			{ label: "Contexts", width: 160 },
			{ label: "Used on", width: 120 },
			{ label: "Actions", width: 210 },
		]}
	>
		{#if visible.length === 0}
			<EmptyRow columns={6}>
				{all.length === 0
					? "No custom fields yet. Add one to capture extra information on issues."
					: "No custom field matches this filter."}
			</EmptyRow>
		{/if}
		{#each visible as field (field.id)}
			<tr>
				<td>
					<div class="field-name">{field.name}</div>
					{#if field.description}
						<div class="field-description">{field.description}</div>
					{/if}
				</td>
				<td>{fieldTypeLabel(field.type)}</td>
				<td>{field.required ? "Yes" : "No"}</td>
				<td>{contextSummary(field.contexts)}</td>
				<td>
					{field.issueCount} issue{field.issueCount === 1 ? "" : "s"}
				</td>
				<td>
					{#if field.configurable}
						<span class="row-actions">
							<a
								href={`/secure/admin/ConfigureCustomField!default.jspa?id=${encodeURIComponent(field.id)}`}
								class="configure-link"
							>
								Configure
							</a>
							<button
								type="button"
								class="link-button"
								onclick={() => (editing = field)}
							>
								Edit
							</button>
							<button
								type="button"
								class="danger-link"
								onclick={() => (deleting = field)}
							>
								Delete
							</button>
						</span>
					{:else}
						<span class="muted">Read only</span>
					{/if}
				</td>
			</tr>
		{/each}
	</ConfigTable>

</AdminPage>

{#if creating}
	<AddFieldDialog onClose={() => (creating = false)} />
{/if}
{#if editing}
	<EditFieldDialog field={editing} onClose={() => (editing = null)} />
{/if}
{#if deleting}
	<DeleteFieldDialog
		field={deleting}
		{candidates}
		onClose={() => (deleting = null)}
	/>
{/if}

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		margin-bottom: 16px;
	}

	.system-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--ds-text);
	}

	.field-count {
		margin-left: auto;
		color: var(--ds-text-subtle);
	}

	.field-name {
		font-weight: 500;
	}

	.field-description {
		color: var(--ds-text-subtle);
		font-size: 12px;
		max-width: 520px;
	}

	.row-actions {
		display: inline-flex;
		gap: 12px;
		align-items: center;
	}

	.configure-link {
		color: var(--ds-link);
		text-decoration: none;
	}

	.link-button {
		padding: 0;
		background: transparent;
		border: 0;
		color: var(--ds-link);
		cursor: pointer;
		font-size: 14px;
	}

	.danger-link {
		padding: 0;
		background: transparent;
		border: 0;
		color: var(--ds-text-danger);
		cursor: pointer;
		font-size: 14px;
	}

	.muted {
		color: var(--ds-text-subtle);
	}
</style>
