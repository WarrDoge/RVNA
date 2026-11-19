<script lang="ts">
	import { enhance } from "$app/forms";
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import Banner from "#lib/admin/Banner.svelte";
	import EmptyRow from "#lib/admin/EmptyRow.svelte";
	import FormField from "#lib/components/FormField.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let search = $state("");
	let query = $state("");
	let creating = $state(false);
	let name = $state("");
	let createError = $state<string | null>(null);
	let createBusy = $state(false);

	$effect(() => {
		const value = search;
		const timer = setTimeout(() => {
			query = value.trim().toLowerCase();
		}, 300);
		return () => clearTimeout(timer);
	});

	let groups = $derived(
		query === ""
			? data.groups
			: data.groups.filter((group) =>
					group.name.toLowerCase().includes(query),
				),
	);

	function openAdd() {
		name = "";
		createError = null;
		creating = true;
	}

	function closeAdd() {
		creating = false;
		createError = null;
	}

	function errorMessage(error: unknown) {
		return error instanceof Error ? error.message : "Something went wrong";
	}
</script>

{#snippet addFooter()}
	<Button
		appearance="primary"
		type="submit"
		form="add-group-form"
		isLoading={createBusy}
		isDisabled={createBusy}
	>
		Add
	</Button>
	<Button appearance="subtle" onclick={closeAdd}>Cancel</Button>
{/snippet}

{#snippet addDialog()}
	<Modal title="Add group" onClose={closeAdd} width={420} footer={addFooter}>
		{#if createError}
			<Banner tone="danger">{createError}</Banner>
		{/if}
		<form
			id="add-group-form"
			method="POST"
			use:enhance={({ cancel }) => {
				if (createBusy) {
					cancel();
					return;
				}
				createBusy = true;
				createError = null;
				return async ({ result, update }) => {
					createBusy = false;
					if (result.type === "failure") {
						const failure = result.data as { error?: unknown } | null;
						createError =
							typeof failure?.error === "string"
								? failure.error
								: "Something went wrong";
						return;
					}
					if (result.type === "error") {
						createError = errorMessage(result.error);
						return;
					}
					creating = false;
					await update();
				};
			}}
		>
			<FormField
				label="Group name"
				htmlFor="group-name"
				required
				hint="Members of a local group are managed by hand; the login sync never changes them."
			>
				{#snippet children(aria)}
				<input
					id="group-name"
					name="name"
					bind:value={name}
					style={inputStyle} aria-describedby={aria.describedBy} aria-invalid={aria.invalid || undefined} aria-required={aria.required || undefined}/>
				{/snippet}
			</FormField>
		</form>
	</Modal>
{/snippet}

<AdminPage
	title="Groups"
	description="Groups come from the identity provider on login or are created here. Local groups keep their membership."
>
	{#snippet actions()}
		<Button appearance="primary" onclick={openAdd}>Add group</Button>
	{/snippet}

	<div class="search-row">
		<input
			aria-label="Search groups"
			placeholder="Search groups"
			bind:value={search}
			style="{inputStyle} width: 260px;"
		/>
	</div>

	<table class="fat-table groups-table">
		<thead>
			<tr>
				<th>Name</th>
				<th class="type-column">Type</th>
				<th class="members-column">Members</th>
			</tr>
		</thead>
		<tbody>
			{#each groups as group (group.id)}
				<tr>
					<td>
						<a
							class="group-link"
							href={`/secure/admin/user/ViewGroup.jspa?name=${encodeURIComponent(group.name)}`}
						>
							{group.name}
						</a>
					</td>
					<td>
						<Lozenge appearance={group.local ? "moved" : "default"}>
							{group.local ? "Local" : "SSO"}
						</Lozenge>
					</td>
					<td>{group.memberCount}</td>
				</tr>
			{:else}
				<EmptyRow columns={3}>
					{#if query === ""}
						No groups yet.{" "}
						<button type="button" class="link-button" onclick={openAdd}>
							Add the first group
						</button>
					{:else}
						No groups match this search.
					{/if}
				</EmptyRow>
			{/each}
		</tbody>
	</table>

	<p class="footnote">
		Groups from the identity provider appear on first login and their membership is
		replaced on every login.
	</p>

	{#if creating}
		{@render addDialog()}
	{/if}
</AdminPage>

<style>
	.search-row {
		margin-bottom: 16px;
	}

	.groups-table {
		width: 100%;
	}

	.type-column {
		width: 120px;
	}

	.members-column {
		width: 120px;
	}

	.group-link {
		color: var(--ds-link);
		font-weight: 500;
	}

	.link-button {
		padding: 0;
		background: none;
		border: 0;
		color: var(--ds-link);
		font-size: 14px;
		cursor: pointer;
	}

	.footnote {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 12px;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}
</style>
