<script lang="ts">
	import AdminNav from "#lib/admin/AdminNav.svelte";
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import Banner from "#lib/admin/Banner.svelte";
	import ConfigTable from "#lib/admin/ConfigTable.svelte";
	import { createSortable } from "#lib/admin/sortable.svelte.ts";
	import EmptyRow from "#lib/admin/EmptyRow.svelte";
	import ErrorText from "#lib/admin/ErrorText.svelte";
	import FormField from "#lib/components/FormField.svelte";
	import MoveButtons from "#lib/admin/MoveButtons.svelte";
	import RowActions from "#lib/admin/RowActions.svelte";
	import SearchField from "#lib/admin/SearchField.svelte";
	import { inputStyle, textareaStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import Textfield from "#lib/components/Textfield.svelte";

	type EntityRow = {
		id: string;
		name: string;
		key: string;
		description: string;
	};

	let rows = $state<EntityRow[]>([
		{
			id: "entity-1",
			name: "Alpha",
			key: "ALP",
			description: "The first invented row.",
		},
		{
			id: "entity-2",
			name: "Bravo",
			key: "BRV",
			description: "The second invented row.",
		},
		{
			id: "entity-3",
			name: "Charlie",
			key: "CHR",
			description: "The third invented row.",
		},
	]);
	let filter = $state("");
	let entityForm = $state<{ row: EntityRow | null } | null>(null);
	let deleting = $state<EntityRow | null>(null);
	let draftName = $state("");
	let draftKey = $state("");
	let draftDescription = $state("");
	let nextId = 4;

	let visibleRows = $derived.by(() => {
		const needle = filter.trim().toLowerCase();
		if (needle === "") return rows;
		return rows.filter(
			(row) =>
				row.name.toLowerCase().includes(needle) ||
				row.key.toLowerCase().includes(needle) ||
				row.description.toLowerCase().includes(needle),
		);
	});

	function openAdd() {
		draftName = "";
		draftKey = "";
		draftDescription = "";
		entityForm = { row: null };
	}

	function openEdit(row: EntityRow) {
		draftName = row.name;
		draftKey = row.key;
		draftDescription = row.description;
		entityForm = { row };
	}

	function closeEntityForm() {
		entityForm = null;
	}

	function saveEntity() {
		const form = entityForm;
		const name = draftName.trim();
		if (!form || name === "") return;
		const key = draftKey.trim();
		const description = draftDescription;
		if (form.row) {
			const id = form.row.id;
			rows = rows.map((row) =>
				row.id === id ? { id, name, key, description } : row,
			);
		} else {
			rows = [
				...rows,
				{ id: `entity-${nextId++}`, name, key, description },
			];
		}
		entityForm = null;
	}

	function confirmDelete() {
		const row = deleting;
		if (!row) return;
		rows = rows.filter((candidate) => candidate.id !== row.id);
		deleting = null;
	}

	type SortRow = { id: string; name: string };

	let sortRows = $state<SortRow[]>([
		{ id: "sort-alpha", name: "Alpha" },
		{ id: "sort-bravo", name: "Bravo" },
		{ id: "sort-charlie", name: "Charlie" },
	]);
	const sortable = createSortable(
		() => sortRows,
		(next) => {
			sortRows = next;
		},
	);

</script>

<div class="admin-frame">
<AdminNav />
<AdminPage
	title="Administration gallery"
	description="The shared administration frame, entity table, dialogs and sortable rows."
>
	{#snippet actions()}
		<Button appearance="primary" onclick={openAdd}>Add entity</Button>
	{/snippet}

	<div data-testid="sort-order">
		Order: {sortRows.map((row) => row.name).join(", ")}
	</div>

	<h2 class="gallery-heading">
		Banners
	</h2>
	<Banner tone="information">Information banner</Banner>
	<Banner tone="warning">Warning banner</Banner>
	<Banner tone="danger">Danger banner</Banner>
	<Banner tone="success">Success banner</Banner>

	<h2 class="gallery-heading">
		Form fields
	</h2>
	<div class="gallery-form">
		<FormField
			label="Display name"
			htmlFor="gallery-display-name"
			hint="Shown in lists and on the entity page."
			required
		>
			{#snippet children(aria)}
				<input
					id="gallery-display-name"
					style={inputStyle}
					value="A sample value"
					aria-describedby={aria.describedBy}
					aria-invalid={aria.invalid || undefined}
					aria-required={aria.required || undefined}
				/>
			{/snippet}
		</FormField>
		<FormField
			label="Description"
			htmlFor="gallery-description"
			error="The description is too long."
		>
			{#snippet children(aria)}
				<textarea
					id="gallery-description"
					style={textareaStyle}
					placeholder="Describe the entity"
					aria-describedby={aria.describedBy}
					aria-invalid={aria.invalid || undefined}
				></textarea>
			{/snippet}
		</FormField>
		<ErrorText>This is a standalone error message.</ErrorText>
	</div>

	<h2 class="gallery-heading">
		Entity table
	</h2>
	<SearchField
		value={filter}
		onChange={(value) => (filter = value)}
		placeholder="Filter entities"
	/>
	<ConfigTable
		columns={[
			{ label: "Name" },
			{ label: "Key", width: 140 },
			{ label: "Description" },
			{ label: "Actions", width: 140 },
		]}
	>
		{#each visibleRows as row (row.id)}
			<tr data-entity={row.id}>
				<td>{row.name}</td>
				<td>{row.key}</td>
				<td>{row.description}</td>
				<td>
					<RowActions
						label={row.name}
						onEdit={() => openEdit(row)}
						onDelete={() => (deleting = row)}
					/>
				</td>
			</tr>
		{/each}
		{#if visibleRows.length === 0}
			<EmptyRow columns={4}>
				{filter === ""
					? "No entities yet. Add one to get started."
					: "No entity matches that filter."}
			</EmptyRow>
		{/if}
	</ConfigTable>

	<h2 class="gallery-heading">
		Sortable list
	</h2>
	<ConfigTable
		columns={[
			{ label: "", width: 100 },
			{ label: "Name" },
		]}
	>
		{#each sortRows as row, index (row.id)}
			<tr data-row={row.id} {@attach sortable.row(index)}>
				<td>
					<MoveButtons
						index={index}
						count={sortRows.length}
						onMove={(delta) => sortable.moveBy(index, delta)}
						label={`resolution ${row.name}`}
					/>
				</td>
				<td>{row.name}</td>
			</tr>
		{/each}
	</ConfigTable>

	<div class="gallery-section">
		<p class="gallery-note">
			The empty row below uses the same table.
		</p>
		<ConfigTable columns={[{ label: "Name" }, { label: "Key", width: 140 }]}>
			<EmptyRow columns={2}>Nothing to show here.</EmptyRow>
		</ConfigTable>
	</div>
</AdminPage>
</div>

{#if entityForm}
	<Modal
		title={entityForm.row ? "Edit entity" : "Add entity"}
		onClose={closeEntityForm}
	>
		{#snippet footer()}
			<Button appearance="primary" onclick={saveEntity}>Save</Button>
			<Button appearance="subtle" onclick={closeEntityForm}>Cancel</Button>
		{/snippet}
		<FormField label="Name" htmlFor="gallery-entity-name" required>
			<Textfield id="gallery-entity-name" bind:value={draftName} />
		</FormField>
		<FormField label="Key" htmlFor="gallery-entity-key">
			<Textfield id="gallery-entity-key" bind:value={draftKey} />
		</FormField>
		<FormField
			label="Description"
			htmlFor="gallery-entity-description"
			hint="A short sentence for the table."
		>
			{#snippet children(aria)}
				<textarea
					id="gallery-entity-description"
					style={textareaStyle}
					bind:value={draftDescription}
					aria-describedby={aria.describedBy}
				></textarea>
			{/snippet}
		</FormField>
	</Modal>
{/if}

{#if deleting}
	<ConfirmDialog
		title={`Delete entity: ${deleting.name}`}
		message={`Delete the entity "${deleting.name}"? This cannot be undone.`}
		onConfirm={confirmDelete}
		onClose={() => (deleting = null)}
	/>
{/if}

<style>
	.admin-frame {
		display: flex;
		min-height: calc(100vh - 56px);
	}

	.gallery-heading {
		margin: 20px 0 8px;
		font-size: 20px;
		font-weight: 500;
	}

	.gallery-form {
		max-width: 420px;
	}

	.gallery-section {
		margin-top: 28px;
		padding-top: 20px;
		border-top: 1px solid var(--ds-border);
	}

	.gallery-note {
		margin: 0;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}
</style>
