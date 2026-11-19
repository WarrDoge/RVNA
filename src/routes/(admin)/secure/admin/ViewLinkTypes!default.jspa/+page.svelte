<script lang="ts">
	import { enhance } from "$app/forms";
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import ConfigTable from "#lib/admin/ConfigTable.svelte";
	import DeleteDialog from "#lib/admin/DeleteDialog.svelte";
	import EmptyRow from "#lib/admin/EmptyRow.svelte";
	import ErrorText from "#lib/admin/ErrorText.svelte";
	import FormField from "#lib/components/FormField.svelte";
	import RowActions from "#lib/admin/RowActions.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	type Row = PageData["linkTypes"][number];

	let formOpen = $state(false);
	let editing = $state<Row | null>(null);
	let draftName = $state("");
	let draftOutward = $state("");
	let draftInward = $state("");
	let formError = $state<string | null>(null);
	let saving = $state(false);
	let deleting = $state<Row | null>(null);

	function openAdd() {
		editing = null;
		draftName = "";
		draftOutward = "";
		draftInward = "";
		formError = null;
		formOpen = true;
	}

	function openEdit(row: Row) {
		editing = row;
		draftName = row.name;
		draftOutward = row.outward;
		draftInward = row.inward;
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
	title="Issue Linking"
	description="Link types describe how two issues relate, for example “blocks” or “duplicates”. Each type reads one way from each side of the link."
>
	{#snippet actions()}
		<Button appearance="primary" onclick={openAdd}>Add link type</Button>
	{/snippet}

	<ConfigTable
		columns={[
			{ label: "Link type" },
			{ label: "Outward description" },
			{ label: "Inward description" },
			{ label: "Links", width: 80 },
			{ label: "Actions", width: 120 },
		]}
	>
		{#each data.linkTypes as row (row.id)}
			<tr>
				<td>{row.name}</td>
				<td>{row.outward}</td>
				<td>{row.inward}</td>
				<td>{row.linkCount}</td>
				<td>
					<RowActions
						label={row.name}
						onEdit={() => openEdit(row)}
						onDelete={() => (deleting = row)}
					/>
				</td>
			</tr>
		{/each}
		{#if data.linkTypes.length === 0}
			<EmptyRow columns={5}>
				No link types yet. Add one so people can connect related issues.
			</EmptyRow>
		{/if}
	</ConfigTable>
</AdminPage>

{#if formOpen}
	<Modal
		title={editing ? "Edit link type" : "Add link type"}
		onClose={closeForm}
		width={520}
	>
		{#snippet footer()}
			<Button
				appearance="primary"
				type="submit"
				form="link-type-form"
				isLoading={saving}
				isDisabled={saving}
			>
				{editing ? "Save" : "Add"}
			</Button>
			<Button appearance="subtle" onclick={closeForm}>Cancel</Button>
		{/snippet}
		<form
			id="link-type-form"
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
								: "Could not save the link type";
						return;
					}
					if (result.type === "error") {
						formError = "Could not save the link type";
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
			<FormField label="Name" htmlFor="link-type-name">
				<input
					id="link-type-name"
					name="name"
					bind:value={draftName}
					style={inputStyle}
				/>
			</FormField>
			<FormField
				label="Outward description"
				htmlFor="link-type-outward"
				hint="How the link reads from the issue you are looking at, for example “blocks”."
			>
				{#snippet children(aria)}
				<input
					id="link-type-outward"
					name="outward"
					bind:value={draftOutward}
					style={inputStyle} aria-describedby={aria.describedBy} aria-invalid={aria.invalid || undefined} aria-required={aria.required || undefined}/>
				{/snippet}
			</FormField>
			<FormField
				label="Inward description"
				htmlFor="link-type-inward"
				hint="How the link reads from the other issue, for example “is blocked by”."
			>
				{#snippet children(aria)}
				<input
					id="link-type-inward"
					name="inward"
					bind:value={draftInward}
					style={inputStyle} aria-describedby={aria.describedBy} aria-invalid={aria.invalid || undefined} aria-required={aria.required || undefined}/>
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
		entity="link-types"
		itemId={target.id}
		itemName={target.name}
		noun="link type"
		candidates={data.linkTypes
			.filter((row) => row.id !== target.id)
			.map((row) => ({ id: row.id, name: row.name }))}
		referenceLabel={(count) =>
			`${count} ${count === 1 ? "link uses" : "links use"} this link type`}
		migrationHint="The existing links move to the other type and keep their issues."
		onClose={() => (deleting = null)}
	/>
{/if}

<style>
	form {
		margin: 0;
	}
</style>
