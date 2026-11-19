<script lang="ts">
	import { enhance } from "$app/forms";
	import { invalidate } from "$app/navigation";
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import Banner from "#lib/admin/Banner.svelte";
	import ConfigTable from "#lib/admin/ConfigTable.svelte";
	import DeleteDialog from "#lib/admin/DeleteDialog.svelte";
	import EmptyRow from "#lib/admin/EmptyRow.svelte";
	import ErrorText from "#lib/admin/ErrorText.svelte";
	import FormField from "#lib/components/FormField.svelte";
	import MoveButtons from "#lib/admin/MoveButtons.svelte";
	import RowActions from "#lib/admin/RowActions.svelte";
	import { errorMessage } from "#lib/admin/config.ts";
	import { createSortable } from "#lib/admin/sortable.svelte.ts";
	import { inputStyle } from "#lib/admin/styles.ts";
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import PriorityIcon from "#lib/components/PriorityIcon.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	type Row = PageData["priorities"][number];

	let formOpen = $state(false);
	let editing = $state<Row | null>(null);
	let draftName = $state("");
	let draftColour = $state("#FF991F");
	let formError = $state<string | null>(null);
	let saving = $state(false);
	let deleting = $state<Row | null>(null);
	let reordered = $state<Row[] | null>(null);
	let reorderError = $state<string | null>(null);
	let reorderSeq = 0;
	let reorderQueue: Promise<void> = Promise.resolve();

	let rows = $derived(reordered ?? data.priorities);
	const sortable = createSortable(
		() => rows,
		(next) => {
			void reorder(next);
		},
	);

	function openAdd() {
		editing = null;
		draftName = "";
		draftColour = "#FF991F";
		formError = null;
		formOpen = true;
	}

	function openEdit(row: Row) {
		editing = row;
		draftName = row.name;
		draftColour = row.iconColor ?? "#FF991F";
		formError = null;
		formOpen = true;
	}

	function closeForm() {
		formOpen = false;
		formError = null;
		saving = false;
	}

	function reorder(next: Row[]) {
		const seq = ++reorderSeq;
		reordered = next;
		reorderError = null;
		const run = reorderQueue.then(async () => {
			try {
				await api<void>("/api/admin/priorities/order", {
					method: "PUT",
					body: JSON.stringify({ ids: next.map((row) => row.id) }),
				});
				if (seq !== reorderSeq) return;
				await invalidate("app:admin-config");
				if (seq === reorderSeq) reordered = null;
			} catch (cause) {
				if (seq !== reorderSeq) return;
				reordered = null;
				reorderError = errorMessage(cause);
			}
		});
		reorderQueue = run.catch(() => undefined);
		return run;
	}
</script>

{#snippet swatch(colour: string | null)}
	<span class="swatch" style:background-color={colour ?? undefined}></span>
{/snippet}

<AdminPage
	title="Priorities"
	description="Priorities say how important an issue is compared with the others. The first priority is the default for new issues; drag a row to change the order."
>
	{#snippet actions()}
		<Button appearance="primary" onclick={openAdd}>Add priority</Button>
	{/snippet}

	{#if reorderError}
		<Banner tone="danger">{reorderError}</Banner>
	{/if}
	<ConfigTable
		columns={[
			{ label: "Order", width: 90 },
			{ label: "Priority" },
			{ label: "Colour", width: 160 },
			{ label: "Issues", width: 80 },
			{ label: "Actions", width: 120 },
		]}
	>
		{#each rows as row, index (row.id)}
			<tr {@attach sortable.row(index)}>
				<td>
					<MoveButtons
						index={index}
						count={rows.length}
						onMove={(delta) => sortable.moveBy(index, delta)}
						label={`priority ${row.name}`}
					/>
				</td>
				<td>
					<span class="priority-name">
						<PriorityIcon name={row.name} />
						{row.name}
						{#if index === 0}
							<span class="default-mark">(default)</span>
						{/if}
					</span>
				</td>
				<td>
					<span class="colour-cell">
						{@render swatch(row.iconColor)}
						<span class="subtle">{row.iconColor ?? "No colour"}</span>
					</span>
				</td>
				<td>{row.issueCount}</td>
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
				No priorities yet. Add one so people can say how urgent an issue is.
			</EmptyRow>
		{/if}
	</ConfigTable>
</AdminPage>

{#if formOpen}
	<Modal
		title={editing ? "Edit priority" : "Add priority"}
		onClose={closeForm}
	>
		{#snippet footer()}
			<Button
				appearance="primary"
				type="submit"
				form="priority-form"
				isLoading={saving}
				isDisabled={saving}
			>
				{editing ? "Save" : "Add"}
			</Button>
			<Button appearance="subtle" onclick={closeForm}>Cancel</Button>
		{/snippet}
		<form
			id="priority-form"
			method="POST"
			use:enhance={({ cancel }) => {
				if (saving) {
					cancel();
					return;
				}
				formError = null;
				if (!/^#[0-9a-fA-F]{6}$/.test(draftColour)) {
					formError = "Use a hex colour such as #FF991F";
					cancel();
					return;
				}
				saving = true;
				return async ({ result, update }) => {
					saving = false;
					if (result.type === "failure") {
						const failure = result.data as { error?: unknown } | null;
						formError =
							typeof failure?.error === "string"
								? failure.error
								: "Could not save the priority";
						return;
					}
					if (result.type === "error") {
						formError = "Could not save the priority";
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
			<input type="hidden" name="iconColor" value={draftColour} />
			<FormField label="Name" htmlFor="priority-name">
				<input
					id="priority-name"
					name="name"
					bind:value={draftName}
					style={inputStyle}
				/>
			</FormField>
			<FormField
				label="Colour"
				htmlFor="priority-colour"
				hint="The colour is the swatch shown next to this priority wherever it appears."
			>
				{#snippet children(aria)}
				<div class="colour-row">
					<input
						id="priority-colour"
						type="color"
						aria-label="Priority colour"
						bind:value={draftColour}
						class="colour-input" aria-describedby={aria.describedBy} aria-invalid={aria.invalid || undefined} aria-required={aria.required || undefined}/>
					<input
						aria-label="Priority colour hex value"
						bind:value={draftColour}
						style="{inputStyle} width: 120px;" aria-describedby={aria.describedBy} aria-invalid={aria.invalid || undefined} aria-required={aria.required || undefined}/>
					{@render swatch(draftColour)}
					<span class="preview">
						<PriorityIcon name={draftName} />
						<span>{draftName === "" ? "Preview" : draftName}</span>
					</span>
				</div>
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
		entity="priorities"
		itemId={target.id}
		itemName={target.name}
		noun="priority"
		candidates={rows
			.filter((row) => row.id !== target.id)
			.map((row) => ({ id: row.id, name: row.name }))}
		referenceLabel={(count) =>
			`${count} ${count === 1 ? "issue uses" : "issues use"} this priority`}
		onClose={() => (deleting = null)}
	/>
{/if}

<style>
	.subtle {
		color: var(--ds-text-subtle);
	}

	.priority-name {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.default-mark {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.colour-cell {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.swatch {
		display: inline-block;
		width: 16px;
		height: 16px;
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		background-color: var(--ds-background-neutral);
	}

	form {
		margin: 0;
	}

	.colour-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.colour-input {
		width: 48px;
		height: 32px;
		padding: 2px;
		background-color: var(--ds-background-input);
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		cursor: pointer;
	}

	.preview {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
</style>
