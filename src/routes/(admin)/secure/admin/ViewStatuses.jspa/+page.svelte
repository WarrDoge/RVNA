<script lang="ts">
	import { enhance } from "$app/forms";
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import ConfigTable from "#lib/admin/ConfigTable.svelte";
	import DeleteDialog from "#lib/admin/DeleteDialog.svelte";
	import EmptyRow from "#lib/admin/EmptyRow.svelte";
	import ErrorText from "#lib/admin/ErrorText.svelte";
	import FormField from "#lib/components/FormField.svelte";
	import RowActions from "#lib/admin/RowActions.svelte";
	import SearchField from "#lib/admin/SearchField.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import StatusLozenge from "#lib/issue-form/StatusLozenge.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	type Row = PageData["statuses"][number];
	type Category = Row["category"];

	const categories = [
		{ value: "new", label: "To Do" },
		{ value: "indeterminate", label: "In Progress" },
		{ value: "done", label: "Done" },
	] as const;

	let filter = $state("");
	let formOpen = $state(false);
	let editing = $state<Row | null>(null);
	let draftName = $state("");
	let draftCategory = $state<Category>("new");
	let formError = $state<string | null>(null);
	let saving = $state(false);
	let deleting = $state<Row | null>(null);

	let needle = $derived(filter.trim().toLowerCase());
	let rows = $derived(
		data.statuses.filter(
			(row) =>
				needle === "" ||
				row.name.toLowerCase().includes(needle) ||
				categoryLabel(row.category).toLowerCase().includes(needle),
		),
	);

	function categoryLabel(category: Category) {
		return (
			categories.find((entry) => entry.value === category)?.label ?? category
		);
	}

	function categoryAppearance(category: Category) {
		if (category === "done") return "success" as const;
		if (category === "indeterminate") return "inprogress" as const;
		return "default" as const;
	}

	function openAdd() {
		editing = null;
		draftName = "";
		draftCategory = "new";
		formError = null;
		formOpen = true;
	}

	function openEdit(row: Row) {
		editing = row;
		draftName = row.name;
		draftCategory = row.category;
		formError = null;
		formOpen = true;
	}

	function closeForm() {
		formOpen = false;
		formError = null;
		saving = false;
	}
</script>

<AdminPage
	title="Statuses"
	description="Statuses show where an issue is in its workflow. Every status belongs to a category: To Do, In Progress or Done."
>
	{#snippet actions()}
		<Button appearance="primary" onclick={openAdd}>Add status</Button>
	{/snippet}

	<SearchField
		value={filter}
		onChange={(value) => (filter = value)}
		placeholder="Filter statuses"
	/>
	<ConfigTable
		columns={[
			{ label: "Status" },
			{ label: "Category", width: 140 },
			{ label: "Issues", width: 80 },
			{ label: "Used in workflows" },
			{ label: "Actions", width: 120 },
		]}
	>
		{#each rows as row (row.id)}
			<tr>
				<td>
					<StatusLozenge status={row} />
				</td>
				<td>
					<span class="fat-lozenge">
						<Lozenge appearance={categoryAppearance(row.category)}>
							{categoryLabel(row.category)}
						</Lozenge>
					</span>
				</td>
				<td>{row.issueCount}</td>
				<td>
					{#if row.workflows.length === 0}
						<span class="subtle">Not in a workflow</span>
					{:else}
						<span title={row.workflows.map((workflow) => workflow.name).join("\n")}>
							{row.workflows
								.slice(0, 2)
								.map((workflow) => workflow.name)
								.join(", ")}{row.workflows.length > 2
								? ` +${row.workflows.length - 2} more`
								: ""}
						</span>
					{/if}
				</td>
				<td>
					<RowActions
						label={row.name}
						onEdit={() => openEdit(row)}
						onDelete={() => (deleting = row)}
					/>
				</td>
			</tr>
		{/each}
		{#if rows.length === 0}
			<EmptyRow columns={5}>
				{data.statuses.length === 0
					? "No statuses yet. Add one and put it in a workflow so issues can move."
					: "No status matches that filter."}
			</EmptyRow>
		{/if}
	</ConfigTable>
</AdminPage>

{#if formOpen}
	<Modal title={editing ? "Edit status" : "Add status"} onClose={closeForm}>
		{#snippet footer()}
			<Button
				appearance="primary"
				type="submit"
				form="status-form"
				isLoading={saving}
				isDisabled={saving}
			>
				{editing ? "Save" : "Add"}
			</Button>
			<Button appearance="subtle" onclick={closeForm}>Cancel</Button>
		{/snippet}
		<form
			id="status-form"
			method="POST"
			use:enhance={({ cancel }) => {
				if (saving) {
					cancel();
					return;
				}
				formError = null;
				saving = true;
				return async ({ result, update }) => {
					saving = false;
					if (result.type === "failure") {
						const failure = result.data as { error?: unknown } | null;
						formError =
							typeof failure?.error === "string"
								? failure.error
								: "Could not save the status";
						return;
					}
					if (result.type === "error") {
						formError = "Could not save the status";
						return;
					}
					await update();
					closeForm();
				};
			}}
		>
			<input
				type="hidden"
				name="intent"
				value={editing ? "update" : "create"}
			/>
			{#if editing}
				<input type="hidden" name="id" value={editing.id} />
			{/if}
			<FormField label="Name" htmlFor="status-name">
				<input
					id="status-name"
					name="name"
					bind:value={draftName}
					style={inputStyle}
				/>
			</FormField>
			<FormField
				label="Category"
				htmlFor="status-category"
				hint="The category tells boards and reports whether work is still to do, in progress or done."
			>
				{#snippet children(aria)}
				<select
					id="status-category"
					name="category"
					bind:value={draftCategory}
					style="{inputStyle} appearance: auto;" aria-describedby={aria.describedBy} aria-invalid={aria.invalid || undefined} aria-required={aria.required || undefined}>
					{#each categories as entry (entry.value)}
						<option value={entry.value}>{entry.label}</option>
					{/each}
				</select>
				{/snippet}
			</FormField>
			{#if formError}
				<ErrorText>{formError}</ErrorText>
			{/if}
			<button type="submit" aria-label="Submit" hidden></button>
		</form>
	</Modal>
{/if}

{#if deleting}
	{@const target = deleting}
	<DeleteDialog
		entity="statuses"
		itemId={target.id}
		itemName={target.name}
		noun="status"
		candidates={data.statuses
			.filter((row) => row.id !== target.id)
			.map((row) => ({ id: row.id, name: row.name }))}
		referenceLabel={(count) =>
			`${count} ${count === 1 ? "issue uses" : "issues use"} this status`}
		onClose={() => (deleting = null)}
	/>
{/if}

<style>
	.subtle {
		color: var(--ds-text-subtle);
	}

	form {
		margin: 0;
	}
</style>
