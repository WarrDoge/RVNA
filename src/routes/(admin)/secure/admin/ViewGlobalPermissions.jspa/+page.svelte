<script lang="ts">
	import { enhance } from "$app/forms";
	import { invalidate } from "$app/navigation";
	import { page } from "$app/state";
	import { api } from "#lib/api.ts";
	import type { UserRef } from "#lib/api-types.ts";
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import Banner from "#lib/admin/Banner.svelte";
	import EmptyRow from "#lib/admin/EmptyRow.svelte";
	import FormField from "#lib/components/FormField.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import UserSelect from "#lib/issue-form/UserSelect.svelte";
	import type { PageData } from "./$types";

	type GroupOption = { id: string; name: string; local: boolean };

	let { data }: { data: PageData } = $props();

	let adding = $state(false);
	let holderType = $state<"user" | "group">("user");
	let user = $state<UserRef | null>(null);
	let groupName = $state("");
	let groups = $state<GroupOption[]>([]);
	let addError = $state<string | null>(null);
	let addBusy = $state(false);
	let removeError = $state<string | null>(null);
	let removePending = $state<string | null>(null);
	let removing = $state<PageData["holders"][number] | null>(null);

	let canAdd = $derived(
		holderType === "user" ? user !== null : groupName !== "",
	);

	function errorMessage(error: unknown) {
		return error instanceof Error ? error.message : "Something went wrong";
	}

	async function openAdd() {
		adding = true;
		holderType = "user";
		user = null;
		groupName = "";
		addError = null;
		try {
			groups = await api<GroupOption[]>("/api/admin/groups");
		} catch {
			groups = [];
		}
	}

	function closeAdd() {
		adding = false;
		addError = null;
	}

	async function remove(holder: PageData["holders"][number]) {
		if (removePending !== null) return;
		removePending = holder.id;
		try {
			await api(
				`/api/admin/global-permissions/${encodeURIComponent(holder.id)}`,
				{ method: "DELETE" },
			);
			removeError = null;
			await refreshHolders();
		} catch (error) {
			removeError = errorMessage(error);
		} finally {
			removePending = null;
			removing = null;
		}
	}

	async function refreshHolders() {
		await invalidate("app:admin-global-permissions");
	}
</script>

{#snippet addFooter()}
	<Button
		appearance="primary"
		type="submit"
		form="global-permission-form"
		isLoading={addBusy}
		isDisabled={!canAdd}
	>
		Add
	</Button>
	<Button appearance="subtle" onclick={closeAdd}>Cancel</Button>
{/snippet}

{#snippet addDialog()}
	<Modal
		title="Add global permission"
		onClose={closeAdd}
		width={480}
		footer={addFooter}
	>
		{#if addError}
			<Banner tone="danger">{addError}</Banner>
		{/if}
		<form
			id="global-permission-form"
			method="POST"
			use:enhance={() => {
				addBusy = true;
				addError = null;
				return async ({ result, update }) => {
					addBusy = false;
					if (result.type === "failure") {
						const failure = result.data as { error?: unknown } | null;
						addError =
							typeof failure?.error === "string"
								? failure.error
								: "Something went wrong";
						return;
					}
					if (result.type === "error") {
						addError = errorMessage(result.error);
						return;
					}
					adding = false;
					await update();
				};
			}}
		>
			<FormField label="Grant to" htmlFor="global-holder-type">
				<select
					id="global-holder-type"
					name="holderType"
					bind:value={holderType}
					style="{inputStyle} appearance: auto;"
				>
					<option value="user">User</option>
					<option value="group">Group</option>
				</select>
			</FormField>
			{#if holderType === "user"}
				<FormField label="User" htmlFor="global-user">
					<UserSelect
						label="User"
						value={user}
						onChange={(value) => (user = value)}
						me={page.data.user}
					/>
				</FormField>
				<input
					type="hidden"
					name="holderParameter"
					value={user?.username ?? ""}
				/>
			{:else}
				<FormField label="Group" htmlFor="global-group">
					<select
						id="global-group"
						name="holderParameter"
						bind:value={groupName}
						style="{inputStyle} appearance: auto;"
					>
						<option value="">Choose a group</option>
						{#each groups as group (group.id)}
							<option value={group.name}>{group.name}</option>
						{/each}
					</select>
				</FormField>
			{/if}
			<p class="hint">
				Global ADMINISTER lets a user or group administer every project. A local
				grant is kept when the Jira import runs again.
			</p>
		</form>
	</Modal>
{/snippet}

<AdminPage
	title="Global permissions"
	description="Global permissions apply everywhere in RVNA. ADMINISTER is the one that makes an application administrator."
>
	{#snippet actions()}
		<Button appearance="primary" onclick={openAdd}>
			Add global permission
		</Button>
	{/snippet}

	{#if removeError}
		<Banner tone="danger">{removeError}</Banner>
	{/if}

	<h2>ADMINISTER</h2>
	<table class="fat-table holders-table">
		<thead>
			<tr>
				<th>User or group</th>
				<th class="type-column">Type</th>
				<th class="source-column">Source</th>
				<th class="actions-column"></th>
			</tr>
		</thead>
		<tbody>
			{#each data.holders as holder (holder.id)}
				<tr>
					<td>{holder.holderParameter}</td>
					<td class="capitalize">{holder.holderType}</td>
					<td>
						{#if holder.source === "imported"}
							<Lozenge appearance="default">Imported</Lozenge>
						{:else}
							<span class="subtle">Local</span>
						{/if}
					</td>
					<td class="right">
						<Button
							appearance="subtle"
							spacing="compact"
							onclick={() => (removing = holder)}
							isLoading={removePending === holder.id}
							isDisabled={removePending === holder.id}
						>
							Remove
						</Button>
					</td>
				</tr>
			{:else}
				<EmptyRow columns={4}>
					No global ADMINISTER holders. Application administrators marked on
					their user page still pass.
				</EmptyRow>
			{/each}
		</tbody>
	</table>

	{#if adding}
		{@render addDialog()}
	{/if}
	{#if removing}
		{@const target = removing}
		<ConfirmDialog
			title="Remove global permission"
			confirmLabel="Remove"
			message={`Remove ADMINISTER from ${target.holderParameter}? They will no longer administer RVNA through this global permission.`}
			pending={removePending === target.id}
			onClose={() => (removing = null)}
			onConfirm={() => remove(target)}
		/>
	{/if}
</AdminPage>

<style>
	h2 {
		margin: 0 0 8px;
		font-size: 20px;
		font-weight: 500;
	}

	.holders-table {
		width: 100%;
	}

	.type-column {
		width: 140px;
	}

	.source-column {
		width: 110px;
	}

	.actions-column {
		width: 90px;
	}

	.capitalize {
		text-transform: capitalize;
	}

	.subtle {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.right {
		text-align: right;
	}

	.hint {
		margin: 0;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}
</style>
