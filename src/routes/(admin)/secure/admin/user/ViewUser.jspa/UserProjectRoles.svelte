<script lang="ts">
	import { invalidate } from "$app/navigation";
	import Banner from "#lib/admin/Banner.svelte";
	import { errorMessage } from "#lib/admin/users.ts";
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import AddProjectRoleDialog from "./AddProjectRoleDialog.svelte";

	type UserProjectRole = {
		projectId: string;
		projectKey: string;
		projectName: string;
		roleId: string;
		roleName: string;
		actorId: string | null;
		viaGroups: string[];
	};

	let {
		userId,
		roles,
	}: { userId: string; roles: UserProjectRole[] } = $props();

	let adding = $state(false);
	let error = $state<string | null>(null);
	let removingId = $state<string | null>(null);
	let removing = $state<UserProjectRole | null>(null);

	async function remove(role: UserProjectRole) {
		if (removingId !== null || role.actorId === null) return;
		removingId = role.actorId;
		error = null;
		try {
			await api(
				`/api/projects/${encodeURIComponent(role.projectKey)}/roles/${encodeURIComponent(role.roleId)}/actors/${encodeURIComponent(role.actorId)}`,
				{ method: "DELETE" },
			);
			await invalidate("app:admin-user");
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			removingId = null;
			removing = null;
		}
	}
</script>

<section class="section">
	<div class="heading">
		<h2>Project roles</h2>
		<div class="add">
			<Button
				appearance="primary"
				spacing="compact"
				onclick={() => (adding = true)}>Add to project role</Button
			>
		</div>
	</div>
	{#if error}
		<Banner tone="danger">{error}</Banner>
	{/if}
	<table class="fat-table table">
		<thead>
			<tr>
				<th>Project</th>
				<th>Role</th>
				<th>Access</th>
				<th style="width: 90px;"></th>
			</tr>
		</thead>
		<tbody>
			{#each roles as role (`${role.projectId}:${role.roleId}:${role.actorId ?? role.viaGroups.join(",")}`)}
				<tr>
					<td>
						<a href={`/projects/${role.projectKey}/issues`} class="project-link">
							{role.projectName}
						</a>
					</td>
					<td>{role.roleName}</td>
					<td>
						{role.actorId
							? "Direct"
							: `via ${role.viaGroups.join(", ")}`}
					</td>
					<td>
						{#if role.actorId}
							<Button
								appearance="subtle"
								spacing="compact"
								isLoading={removingId === role.actorId}
								isDisabled={removingId === role.actorId}
								onclick={() => (removing = role)}>Remove</Button
							>
						{/if}
					</td>
				</tr>
			{/each}
			{#if roles.length === 0}
				<tr>
					<td colspan={4} class="empty">
						This user has no project roles. Projects without a scheme are open to
						browse; their roles are not listed here.
					</td>
				</tr>
			{/if}
		</tbody>
	</table>
	{#if adding}
		<AddProjectRoleDialog {userId} onClose={() => (adding = false)} />
	{/if}
	{#if removing}
		{@const target = removing}
		<ConfirmDialog
			title="Remove project role"
			confirmLabel="Remove"
			message={`Remove ${target.roleName} from this user in ${target.projectName}? Their access through this role ends.`}
			pending={removingId === target.actorId}
			onClose={() => (removing = null)}
			onConfirm={() => remove(target)}
		/>
	{/if}
</section>

<style>
	.section {
		margin-bottom: 32px;
	}

	.heading {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 12px;
	}

	h2 {
		margin: 0 0 12px;
		font-size: 20px;
		font-weight: 500;
		line-height: 24px;
	}

	.add {
		margin-left: auto;
	}

	.table {
		width: 100%;
	}

	.project-link {
		color: var(--ds-link);
	}

	.empty {
		color: var(--ds-text-subtle);
	}
</style>
