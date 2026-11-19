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
	import { inputStyle, textareaStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import IssueTypeIcon from "#lib/components/IssueTypeIcon.svelte";
	import {
		type IssueTypeIconKey,
		issueTypeIconKeyForName,
		issueTypeIconKeys,
	} from "#lib/components/icons.ts";
	import Modal from "#lib/components/Modal.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	type Row = PageData["issueTypes"][number];

	let filter = $state("");
	let formOpen = $state(false);
	let editing = $state<Row | null>(null);
	let draftName = $state("");
	let draftDescription = $state("");
	let draftSubtask = $state(false);
	let draftIcon = $state<IssueTypeIconKey>("task");
	let formError = $state<string | null>(null);
	let saving = $state(false);
	let deleting = $state<Row | null>(null);

	let needle = $derived(filter.trim().toLowerCase());
	let filtering = $derived(needle !== "");
	let standard = $derived(
		data.issueTypes.filter((row) => !row.subtask && matches(row)),
	);
	let subtasks = $derived(
		data.issueTypes.filter((row) => row.subtask && matches(row)),
	);
	let subtaskLocked = $derived((editing?.issueCount ?? 0) > 0);

	function matches(row: Row) {
		return (
			needle === "" ||
			row.name.toLowerCase().includes(needle) ||
			(row.description ?? "").toLowerCase().includes(needle)
		);
	}

	function iconFor(row: Row | null): IssueTypeIconKey {
		const stored = row?.iconUrl;
		if (stored?.startsWith("builtin:")) {
			const key = stored.slice("builtin:".length);
			const match = issueTypeIconKeys.find((entry) => entry.key === key);
			if (match) return match.key;
		}
		return issueTypeIconKeyForName(row?.name ?? "task");
	}

	function openAdd(subtask: boolean) {
		editing = null;
		draftName = "";
		draftDescription = "";
		draftSubtask = subtask;
		draftIcon = "task";
		formError = null;
		formOpen = true;
	}

	function openEdit(row: Row) {
		editing = row;
		draftName = row.name;
		draftDescription = row.description ?? "";
		draftSubtask = row.subtask;
		draftIcon = iconFor(row);
		formError = null;
		formOpen = true;
	}

	function closeForm() {
		formOpen = false;
		formError = null;
		saving = false;
	}
</script>

{#snippet issueTypeTable(rows: Row[], empty: string)}
	<ConfigTable
		columns={[
			{ label: "Issue type" },
			{ label: "Description" },
			{ label: "Issues", width: 80 },
			{ label: "Projects", width: 90 },
			{ label: "Actions", width: 120 },
		]}
	>
		{#each rows as row (row.id)}
			<tr>
				<td>
					<span class="type-name">
						<IssueTypeIcon name={row.name} icon={row.iconUrl} />
						{row.name}
					</span>
				</td>
				<td>
					{#if row.description != null}
						{row.description}
					{:else}
						<span class="subtle">—</span>
					{/if}
				</td>
				<td>{row.issueCount}</td>
				<td>{row.projectCount}</td>
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
			<EmptyRow columns={5}>{empty}</EmptyRow>
		{/if}
	</ConfigTable>
{/snippet}

<AdminPage
	title="Issue Types"
	description="Issue types tell a bug apart from a task. Each type can use its own workflow and fields, and projects choose which types they offer."
>
	{#snippet actions()}
		<Button appearance="primary" onclick={() => openAdd(false)}>
			Add issue type
		</Button>
	{/snippet}

	<SearchField
		value={filter}
		onChange={(value) => (filter = value)}
		placeholder="Filter issue types"
	/>
	<div class="section-heading">
		<h2 class="section-title">Standard issue types</h2>
		<span class="subtle">{standard.length}</span>
	</div>
	{@render issueTypeTable(
		standard,
		filtering
			? "No standard issue type matches that filter."
			: "No standard issue types yet. Add one so people can file work that is not a sub-task.",
	)}
	<div class="section-heading sub-task-heading">
		<h2 class="section-title">Sub-task issue types</h2>
		<span class="subtle">{subtasks.length}</span>
		<div class="section-action">
			<Button onclick={() => openAdd(true)}>Add sub-task issue type</Button>
		</div>
	</div>
	{@render issueTypeTable(
		subtasks,
		filtering
			? "No sub-task issue type matches that filter."
			: "No sub-task issue types yet. Add one if you break work into smaller pieces.",
	)}
</AdminPage>

{#if formOpen}
	<Modal
		title={editing ? "Edit issue type" : "Add issue type"}
		onClose={closeForm}
		width={560}
	>
		{#snippet footer()}
			<Button
				appearance="primary"
				type="submit"
				form="issue-type-form"
				isLoading={saving}
				isDisabled={saving}
			>
				{editing ? "Save" : "Add"}
			</Button>
			<Button appearance="subtle" onclick={closeForm}>Cancel</Button>
		{/snippet}
		<form
			id="issue-type-form"
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
								: "Could not save the issue type";
						return;
					}
					if (result.type === "error") {
						formError = "Could not save the issue type";
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
			<input type="hidden" name="subtask" value={String(draftSubtask)} />
			<input type="hidden" name="icon" value={draftIcon} />
			<FormField label="Name" htmlFor="issue-type-name">
				<input
					id="issue-type-name"
					name="name"
					bind:value={draftName}
					style={inputStyle}
				/>
			</FormField>
			<FormField label="Description" htmlFor="issue-type-description">
				<textarea
					id="issue-type-description"
					name="description"
					bind:value={draftDescription}
					style={textareaStyle}
				></textarea>
			</FormField>
			<fieldset class="form-field">
				<legend class="form-field-label">Icon</legend>
				<div class="icon-grid">
					{#each issueTypeIconKeys as option (option.key)}
						<label class="icon-tile" class:selected={draftIcon === option.key}>
							<input
								type="radio"
								name="issue-type-icon"
								value={option.key}
								checked={draftIcon === option.key}
								onchange={() => (draftIcon = option.key)}
								class="radio"
							/>
							<IssueTypeIcon
								name={option.label}
								icon={`builtin:${option.key}`}
								size={20}
							/>
							<span>{option.label}</span>
						</label>
					{/each}
				</div>
			</fieldset>
			<fieldset class="form-field">
				<legend class="form-field-label">Type</legend>
				<div class="kind-row">
					<label class="kind-option">
						<input
							type="radio"
							name="issue-type-kind"
							checked={!draftSubtask}
							disabled={subtaskLocked}
							onchange={() => (draftSubtask = false)}
						/>
						Standard
					</label>
					<label class="kind-option">
						<input
							type="radio"
							name="issue-type-kind"
							checked={draftSubtask}
							disabled={subtaskLocked}
							onchange={() => (draftSubtask = true)}
						/>
						Sub-task
					</label>
				</div>
				{#if subtaskLocked}
					<span class="form-field-hint">
						Issues already use this type, so it cannot change between standard
						and sub-task.
					</span>
				{/if}
			</fieldset>
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
		entity="issue-types"
		itemId={target.id}
		itemName={target.name}
		noun="issue type"
		candidates={data.issueTypes
			.filter(
				(row) => row.id !== target.id && row.subtask === target.subtask,
			)
			.map((row) => ({ id: row.id, name: row.name }))}
		referenceLabel={(count) =>
			`${count} ${count === 1 ? "issue uses" : "issues use"} this issue type`}
		onClose={() => (deleting = null)}
	/>
{/if}

<style>
	.section-heading {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 0 0 8px;
	}

	.sub-task-heading {
		margin-top: 28px;
	}

	.section-title {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
		line-height: 24px;
		color: var(--ds-text);
	}

	.section-action {
		margin-left: auto;
	}

	.type-name {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.subtle {
		color: var(--ds-text-subtle);
	}

	form {
		margin: 0;
	}

	.icon-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}

	.icon-tile {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		background-color: var(--ds-background-neutral-subtle);
		cursor: pointer;
	}

	.icon-tile.selected {
		border-color: var(--ds-border-selected);
		background-color: var(--ds-background-selected);
	}

	.radio {
		margin: 0;
	}

	.kind-row {
		display: flex;
		gap: 16px;
	}

	.kind-option {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.form-field {
		margin: 0 0 16px;
		padding: 0;
		border: 0;
	}

	.form-field-label {
		padding: 0;
		margin-bottom: 4px;
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle);
	}

	.form-field-hint {
		display: block;
		margin-top: 4px;
		font-size: 12px;
		color: var(--ds-text-subtle);
	}
</style>
