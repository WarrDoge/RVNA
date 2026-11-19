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
	import { inputStyle, textareaStyle } from "#lib/admin/styles.ts";
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	type Row = PageData["resolutions"][number];

	let formOpen = $state(false);
	let editing = $state<Row | null>(null);
	let draftName = $state("");
	let draftDescription = $state("");
	let formError = $state<string | null>(null);
	let saving = $state(false);
	let deleting = $state<Row | null>(null);
	let reordered = $state<Row[] | null>(null);
	let reorderError = $state<string | null>(null);
	let reorderSeq = 0;
	let reorderQueue: Promise<void> = Promise.resolve();

	let rows = $derived(reordered ?? data.resolutions);
	const sortable = createSortable(
		() => rows,
		(next) => {
			void reorder(next);
		},
	);

	function openAdd() {
		editing = null;
		draftName = "";
		draftDescription = "";
		formError = null;
		formOpen = true;
	}

	function openEdit(row: Row) {
		editing = row;
		draftName = row.name;
		draftDescription = row.description ?? "";
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
				await api<void>("/api/admin/resolutions/order", {
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

<AdminPage
	title="Resolutions"
	description="A resolution records why an issue was closed. People pick one when they move an issue to a done status."
>
	{#snippet actions()}
		<Button appearance="primary" onclick={openAdd}>Add resolution</Button>
	{/snippet}

	{#if reorderError}
		<Banner tone="danger">{reorderError}</Banner>
	{/if}
	<p class="intro">
		Drag a row, or use the arrows, to change the order people see resolutions in.
	</p>
	<ConfigTable
		columns={[
			{ label: "Order", width: 90 },
			{ label: "Resolution" },
			{ label: "Description" },
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
						label={`resolution ${row.name}`}
					/>
				</td>
				<td>{row.name}</td>
				<td>
					{#if row.description != null}
						{row.description}
					{:else}
						<span class="subtle">—</span>
					{/if}
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
				No resolutions yet. Add one to let people close issues with a reason.
			</EmptyRow>
		{/if}
	</ConfigTable>
</AdminPage>

{#if formOpen}
	<Modal
		title={editing ? "Edit resolution" : "Add resolution"}
		onClose={closeForm}
	>
		{#snippet footer()}
			<Button
				appearance="primary"
				type="submit"
				form="resolution-form"
				isLoading={saving}
				isDisabled={saving}
			>
				{editing ? "Save" : "Add"}
			</Button>
			<Button appearance="subtle" onclick={closeForm}>Cancel</Button>
		{/snippet}
		<form
			id="resolution-form"
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
								: "Could not save the resolution";
						return;
					}
					if (result.type === "error") {
						formError = "Could not save the resolution";
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
			<FormField label="Name" htmlFor="resolution-name">
				<input
					id="resolution-name"
					name="name"
					bind:value={draftName}
					style={inputStyle}
				/>
			</FormField>
			<FormField label="Description" htmlFor="resolution-description">
				<textarea
					id="resolution-description"
					name="description"
					bind:value={draftDescription}
					style={textareaStyle}
				></textarea>
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
		entity="resolutions"
		itemId={target.id}
		itemName={target.name}
		noun="resolution"
		candidates={rows
			.filter((row) => row.id !== target.id)
			.map((row) => ({ id: row.id, name: row.name }))}
		referenceLabel={(count) =>
			`${count} ${count === 1 ? "issue uses" : "issues use"} this resolution`}
		onClose={() => (deleting = null)}
	/>
{/if}

<style>
	.intro {
		margin: 0 0 8px;
		color: var(--ds-text-subtle);
	}

	.subtle {
		color: var(--ds-text-subtle);
	}

	form {
		margin: 0;
	}
</style>
