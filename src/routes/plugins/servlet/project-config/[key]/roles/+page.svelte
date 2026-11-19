<script lang="ts">
	import { invalidate } from "$app/navigation";
	import { api } from "#lib/api.ts";
	import Banner from "#lib/admin/Banner.svelte";
	import Button from "#lib/components/Button.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import { permissionLabel } from "#lib/permission-labels.ts";
	import ProjectAdminDenied from "#lib/project/ProjectAdminDenied.svelte";
	import ProjectFrame from "#lib/project/ProjectFrame.svelte";
	import ActorLine from "./ActorLine.svelte";
	import AddRoleActorDialog from "./AddRoleActorDialog.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let adding = $state(false);
	let removing = $state<string | null>(null);
	let confirmingActor = $state<{
		roleId: string;
		actorId: string;
		displayName: string;
	} | null>(null);
	let error = $state<string | null>(null);

	let roles = $derived(data.roles);
	let projectKey = $derived(data.sidebar.project.key);

	$effect(() => {
		projectKey;
		adding = false;
		removing = null;
		confirmingActor = null;
		error = null;
	});

	async function removeActor(roleId: string, actorId: string) {
		removing = actorId;
		error = null;
		try {
			await api(
				`/api/projects/${encodeURIComponent(projectKey)}/roles/${encodeURIComponent(roleId)}/actors/${encodeURIComponent(actorId)}`,
				{ method: "DELETE" },
			);
			await Promise.all([
				invalidate("app:project-roles"),
				invalidate("app:project"),
			]);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Something went wrong";
		} finally {
			removing = null;
		}
	}

	function askRemove(roleId: string, actorId: string, displayName: string) {
		confirmingActor = { roleId, actorId, displayName };
	}
</script>

<PageTitle title="Users and roles" />

<ProjectFrame data={data.sidebar} active="settings">
	{#if roles}
	{#key data.sidebar.project.key}
	<div class="content">
		<p class="breadcrumb">
			<a
				href={`/plugins/servlet/project-config/${data.sidebar.project.key}/summary`}
			>
				Project settings
			</a>{" "}
			/ Users and roles
		</p>
		<div class="heading">
			<h1>Users and roles</h1>
			<div class="heading-action">
				<Button
					appearance="primary"
					onclick={() => (adding = true)}
					isDisabled={roles.roles.length === 0}
				>
					Add users to a role
				</Button>
			</div>
		</div>
		<p class="description">
			{data.sidebar.project.name}: add people and groups to the project roles
			that the permission scheme uses.
		</p>
		<p class="scheme">
			Permission scheme: <strong>{roles.scheme.name}</strong>
			{#if roles.scheme.source === "imported"}
				<Lozenge appearance="default">Imported</Lozenge>
			{/if}
			{#if roles.scheme.source === "local"}
				<Lozenge appearance="moved">Local</Lozenge>
			{/if}
		</p>

		{#if error}
			<Banner tone="danger">{error}</Banner>
		{/if}

		<table class="fat-table">
			<thead>
				<tr>
					<th class="role-column">Role</th>
					<th class="users-column">Users</th>
					<th class="groups-column">Groups</th>
					<th class="permissions-column">Permissions</th>
				</tr>
			</thead>
			<tbody>
				{#each roles.roles as role (role.id)}
					{@const users = role.actors.filter(
						(actor) => actor.actorType === "user",
					)}
					{@const groups = role.actors.filter(
						(actor) => actor.actorType === "group",
					)}
					<tr>
						<td class="role-name">{role.name}</td>
						<td class="top">
							{#if users.length === 0}
								<span class="subtle">No users</span>
							{:else}
								{#each users as actor (actor.id)}
									<ActorLine
										{actor}
										roleName={role.name}
										removing={removing === actor.id}
										onRemove={() => askRemove(role.id, actor.id, actor.displayName)}
									/>
								{/each}
							{/if}
						</td>
						<td class="top">
							{#if groups.length === 0}
								<span class="subtle">No groups</span>
							{:else}
								{#each groups as actor (actor.id)}
									<ActorLine
										{actor}
										roleName={role.name}
										removing={removing === actor.id}
										onRemove={() => askRemove(role.id, actor.id, actor.displayName)}
									/>
								{/each}
							{/if}
						</td>
						<td class="top permissions">
							{role.permissions.length === 0
								? "—"
								: role.permissions.map((permission) => permissionLabel(permission)).join(", ")}
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="4" class="muted">
							This project has no roles yet. Add a project role grant to its
							permission scheme.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>

		<section class="note">
			<p>
				Project roles are independent of the SSO provider. Imported memberships
				are marked; removing one here keeps it removed when the Jira import runs
				again.
			</p>
		</section>
	</div>
	{/key}
	{:else}
		<ProjectAdminDenied
			title="Users and roles"
			projectKey={data.sidebar.project.key}
		/>
	{/if}
</ProjectFrame>

{#if adding}
	<AddRoleActorDialog
		roles={data.roles?.roles ?? []}
		groups={data.roles?.groups ?? []}
		onClose={() => (adding = false)}
	/>
{/if}

{#if confirmingActor}
	<ConfirmDialog
		title="Remove from role"
		message={`Remove ${confirmingActor.displayName} from this project role? They lose the permissions the role grants in this project.`}
		confirmLabel="Remove"
		pending={removing !== null}
		onConfirm={() => {
			const target = confirmingActor;
			confirmingActor = null;
			if (target) {
				void removeActor(target.roleId, target.actorId);
			}
		}}
		onClose={() => (confirmingActor = null)}
	/>
{/if}

<style>
	.content {
		flex: 1;
		min-width: 0;
		padding: 24px 32px;
		max-width: 1100px;
	}

	h1 {
		margin: 0;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text);
	}

	.breadcrumb {
		margin: 0 0 8px;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.heading {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 8px;
	}

	.heading-action {
		margin-left: auto;
	}

	.description,
	.scheme {
		margin: 0 0 16px;
		color: var(--ds-text-subtle);
	}

	.fat-table {
		width: 100%;
	}

	.role-column {
		width: 16%;
	}

	.users-column {
		width: 36%;
	}

	.groups-column {
		width: 22%;
	}

	.permissions-column {
		width: 26%;
	}

	.role-name {
		vertical-align: top;
		font-weight: 500;
	}

	.top {
		vertical-align: top;
	}

	.permissions {
		color: var(--ds-text-subtle);
	}

	.muted {
		color: var(--ds-text-subtle);
	}

	.subtle {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.note {
		margin-top: 16px;
	}

	.note p {
		margin: 0;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

</style>
