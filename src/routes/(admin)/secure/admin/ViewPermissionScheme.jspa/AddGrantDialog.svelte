<script lang="ts">
	import { untrack } from "svelte";
	import { enhance } from "$app/forms";
	import type { UserRef } from "#lib/api-types.ts";
	import Banner from "#lib/admin/Banner.svelte";
	import FormField from "#lib/components/FormField.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import UserSelect from "#lib/issue-form/UserSelect.svelte";
	import { permissionLabel } from "#lib/permission-labels.ts";

	type RoleRef = { id: string; name: string };
	type GroupRef = { id: string; name: string };

	interface Props {
		schemeId: string;
		roles: RoleRef[];
		groups: GroupRef[];
		permissionKeys: string[];
		onClose: () => void;
	}

	let { schemeId, roles, groups, permissionKeys, onClose }: Props = $props();

	let permissionKey = $state(
		untrack(() => permissionKeys[0] ?? "BROWSE_PROJECTS"),
	);
	let holderType = $state("projectRole");
	let roleId = $state(untrack(() => roles[0]?.id ?? ""));
	let groupName = $state("");
	let user = $state<UserRef | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);

	const formId = $props.id();

	let holderParameter = $derived(
		holderType === "projectRole"
			? roleId
			: holderType === "group"
				? groupName
				: holderType === "user"
					? (user?.username ?? "")
					: "",
	);
	let canAdd = $derived(
		holderType === "projectRole"
			? roleId !== ""
			: holderType === "group"
				? groupName !== ""
				: holderType === "user"
					? user !== null
					: true,
	);

	function failureMessage(result: { data?: unknown }) {
		const data = result.data as { error?: unknown } | null;
		return typeof data?.error === "string"
			? data.error
			: "Something went wrong";
	}
</script>

{#snippet footer()}
	<Button
		type="submit"
		form={formId}
		appearance="primary"
		isLoading={busy}
		isDisabled={!canAdd}
	>
		Add
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal title="Add permission grant" width={520} {onClose} {footer}>
	{#if error}
		<Banner tone="danger">{error}</Banner>
	{/if}
	<form
		id={formId}
		method="POST"
		use:enhance={({ cancel }) => {
			error = null;
			if (!canAdd) {
				cancel();
				return;
			}
			busy = true;
			return async ({ result, update }) => {
				busy = false;
				if (result.type === "failure") {
					error = failureMessage(result);
					return;
				}
				if (result.type === "error") {
					error = "Something went wrong";
					return;
				}
				await update();
				onClose();
			};
		}}
	>
		<input type="hidden" name="intent" value="addGrant" />
		<input type="hidden" name="schemeId" value={schemeId} />
		<input type="hidden" name="holderParameter" value={holderParameter} />
		<FormField label="Permission" htmlFor="grant-permission">
			<select
				id="grant-permission"
				name="permissionKey"
				bind:value={permissionKey}
				style="{inputStyle} appearance: auto;"
			>
				{#each permissionKeys as key (key)}
					<option value={key}>{permissionLabel(key)}</option>
				{/each}
			</select>
		</FormField>
		<FormField label="Grant to" htmlFor="grant-holder-type">
			<select
				id="grant-holder-type"
				name="holderType"
				bind:value={holderType}
				style="{inputStyle} appearance: auto;"
			>
				<option value="projectRole">Project role</option>
				<option value="group">Group</option>
				<option value="user">User</option>
				<option value="reporter">Reporter</option>
				<option value="assignee">Assignee</option>
				<option value="projectLead">Project lead</option>
				<option value="anyone">Anyone</option>
				<option value="applicationRole">Any logged in user</option>
			</select>
		</FormField>
		{#if holderType === "projectRole"}
			<FormField label="Role" htmlFor="grant-role">
				<select
					id="grant-role"
					bind:value={roleId}
					style="{inputStyle} appearance: auto;"
				>
					{#each roles as role (role.id)}
						<option value={role.id}>{role.name}</option>
					{/each}
				</select>
			</FormField>
		{:else if holderType === "group"}
			<FormField label="Group" htmlFor="grant-group">
				<select
					id="grant-group"
					bind:value={groupName}
					style="{inputStyle} appearance: auto;"
				>
					<option value="">Choose a group</option>
					{#each groups as group (group.id)}
						<option value={group.name}>{group.name}</option>
					{/each}
				</select>
			</FormField>
		{:else if holderType === "user"}
			<FormField label="User" htmlFor="grant-user">
				<UserSelect
					id="grant-user"
					label="User"
					value={user}
					onChange={(value) => (user = value)}
					me={null}
				/>
			</FormField>
		{/if}
		<p class="hint">
			A grant for a project role applies to every project that uses this scheme.
			The role's members are managed under each project's Users and roles page.
		</p>
	</form>
</Modal>

<style>
	form {
		margin: 0;
	}

	.hint {
		margin: 0;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}
</style>
