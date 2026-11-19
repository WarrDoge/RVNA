<script lang="ts">
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import Banner from "#lib/admin/Banner.svelte";
	import EmptyRow from "#lib/admin/EmptyRow.svelte";
	import Button from "#lib/components/Button.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import { permissionLabel } from "#lib/permission-labels.ts";
	import AddGrantDialog from "./AddGrantDialog.svelte";
	import AssignProjectDialog from "./AssignProjectDialog.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	type Detail = NonNullable<PageData["detail"]>;
	type Grant = Detail["grants"][number];
	type RoleRef = Detail["roles"][number];

	let addingGrant = $state(false);
	let assigning = $state(false);
	let removing = $state<string | null>(null);
	let removingProject = $state<string | null>(null);
	let confirmingGrant = $state<Grant | null>(null);
	let confirmingProject = $state<{
		id: string;
		key: string;
		name: string;
	} | null>(null);
	let confirmingDelete = $state(false);
	let deleting = $state(false);
	let error = $state<string | null>(null);

	const schemeId = $derived(data.detail?.scheme.id);
	$effect(() => {
		schemeId;
		confirmingGrant = null;
		confirmingProject = null;
		confirmingDelete = false;
	});

	function holderLabel(grant: Grant, roles: RoleRef[]): string {
		switch (grant.holderType) {
			case "projectRole": {
				const role = roles.find(
					(item) =>
						item.id.toLowerCase() ===
							(grant.holderParameter ?? "").toLowerCase() ||
						item.name.toLowerCase() ===
							(grant.holderParameter ?? "").toLowerCase(),
				);
				return `Project role: ${role?.name ?? grant.holderParameter ?? ""}`;
			}
			case "group":
				return `Group: ${grant.holderParameter}`;
			case "user":
				return `User: ${grant.holderParameter}`;
			case "projectLead":
				return "Project lead";
			case "reporter":
				return "Reporter";
			case "assignee":
				return "Assignee";
			case "anyone":
				return "Anyone";
			case "applicationRole":
				return grant.holderParameter
					? `Application role: ${grant.holderParameter}`
					: "Any logged in user";
			default:
				return `${grant.holderType}: ${grant.holderParameter ?? ""}`;
		}
	}

	function failureMessage(result: { data?: unknown }) {
		const resultData = result.data as { error?: unknown } | null;
		return typeof resultData?.error === "string"
			? resultData.error
			: "Something went wrong";
	}

	let grantGroups = $derived.by(() => {
		if (!data.detail) return [];
		const byPermission = new Map<string, Grant[]>();
		for (const grant of data.detail.grants) {
			const list = byPermission.get(grant.permissionKey) ?? [];
			list.push(grant);
			byPermission.set(grant.permissionKey, list);
		}
		return [...byPermission.entries()].sort((left, right) =>
			permissionLabel(left[0]).localeCompare(permissionLabel(right[0])),
		);
	});
</script>

{#snippet breadcrumb()}
	<a href="/secure/admin/ViewPermissionSchemes.jspa">Permission schemes</a>
{/snippet}

{#snippet actions()}
	{#if data.detail}
		<Lozenge appearance={data.detail.scheme.source === "local" ? "moved" : "default"}>
			{data.detail.scheme.source === "local" ? "Local" : "Imported"}
		</Lozenge>
		{#if data.detail.scheme.projects.length > 0}
			<span class="delete-reason">
				Remove every project before deleting this scheme.
			</span>
		{/if}
		<form
			id="delete-scheme"
			method="POST"
			use:enhance={() => {
				error = null;
				deleting = true;
				return async ({ result, update }) => {
					if (result.type === "failure") {
						error = failureMessage(result);
						deleting = false;
						return;
					}
					if (result.type === "error") {
						error = "Something went wrong";
						deleting = false;
						return;
					}
					if (result.type === "redirect") {
						await goto(result.location);
						return;
					}
					await update();
				};
			}}
		>
			<input type="hidden" name="intent" value="deleteScheme" />
			<input type="hidden" name="schemeId" value={data.detail.scheme.id} />
			<Button
				type="button"
				appearance="subtle"
				isDisabled={data.detail.scheme.projects.length > 0}
				isLoading={deleting}
				onclick={() => (confirmingDelete = true)}
			>
				Delete scheme
			</Button>
		</form>
		<Button appearance="primary" onclick={() => (addingGrant = true)}>
			Add permission grant
		</Button>
	{/if}
{/snippet}

{#if data.detail}
	{@const scheme = data.detail.scheme}
	<AdminPage
		title={scheme.name}
		description={scheme.description ?? "A permission scheme maps permissions to holders."}
		{breadcrumb}
		{actions}
	>
		{#if error}
			<Banner tone="danger">{error}</Banner>
		{/if}

		<section class="scheme-section">
			<div class="section-heading">
				<h2>Projects</h2>
				<div class="section-action">
					<Button appearance="subtle" onclick={() => (assigning = true)}>
						Assign project
					</Button>
				</div>
			</div>
			{#if scheme.projects.length === 0}
				<p class="subtle">No project uses this scheme.</p>
			{:else}
				<ul class="projects">
					{#each scheme.projects as project (project.id)}
						<li>
							<a href={`/projects/${project.key}/issues`}>{project.name}</a>
							<span class="subtle">({project.key})</span>
							<form
								id={`remove-project-${project.id}`}
								method="POST"
								use:enhance={() => {
									error = null;
									removingProject = project.id;
									return async ({ result, update }) => {
										if (result.type === "failure") {
											error = failureMessage(result);
											removingProject = null;
											return;
										}
										if (result.type === "error") {
											error = "Something went wrong";
											removingProject = null;
											return;
										}
										await update();
										removingProject = null;
									};
								}}
							>
								<input type="hidden" name="intent" value="removeProject" />
								<input type="hidden" name="schemeId" value={scheme.id} />
								<input type="hidden" name="projectId" value={project.id} />
								<Button
									type="button"
									appearance="subtle"
									spacing="compact"
									isLoading={removingProject === project.id}
									onclick={() => (confirmingProject = project)}
								>
									Remove
								</Button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section>
			<h2 class="grants-title">Grants</h2>
			<table class="fat-table grants-table">
				<thead>
					<tr>
						<th class="permission-column">Permission</th>
						<th>Granted to</th>
						<th class="grant-actions-column"></th>
					</tr>
				</thead>
				<tbody>
					{#each grantGroups as [permissionKey, permissionGrants] (permissionKey)}
						<tr>
							<td class="top">{permissionLabel(permissionKey)}</td>
							<td class="top">
								{#each permissionGrants as grant (grant.id)}
									<div class="grant-holder">
										<span>{holderLabel(grant, data.detail.roles)}</span>
										{#if grant.source === "imported"}
											<Lozenge appearance="default">Imported</Lozenge>
										{:else}
											<span class="subtle">Local</span>
										{/if}
									</div>
								{/each}
							</td>
							<td class="top right">
								{#each permissionGrants as grant (grant.id)}
									<div class="remove-cell">
										<form
											id={`remove-grant-${grant.id}`}
											method="POST"
											use:enhance={() => {
												error = null;
												removing = grant.id;
												return async ({ result, update }) => {
													if (result.type === "failure") {
														error = failureMessage(result);
														removing = null;
														return;
													}
													if (result.type === "error") {
														error = "Something went wrong";
														removing = null;
														return;
													}
													removing = null;
													await update();
												};
											}}
										>
											<input type="hidden" name="intent" value="removeGrant" />
											<input type="hidden" name="schemeId" value={scheme.id} />
											<input type="hidden" name="grantId" value={grant.id} />
											<Button
												type="button"
												appearance="subtle"
												spacing="compact"
												isLoading={removing === grant.id}
												onclick={() => (confirmingGrant = grant)}
											>
												Remove
											</Button>
										</form>
									</div>
								{/each}
							</td>
						</tr>
					{/each}
					{#if data.detail.grants.length === 0}
						<EmptyRow columns={3}>
							No permission grants. Add one to let someone use this scheme.
						</EmptyRow>
					{/if}
				</tbody>
			</table>
		</section>

		{#key scheme.id}
			{#if addingGrant}
				<AddGrantDialog
					schemeId={scheme.id}
					roles={data.detail.roles}
					groups={data.groups}
					permissionKeys={data.detail.permissionKeys}
					onClose={() => (addingGrant = false)}
				/>
			{/if}
			{#if assigning}
				<AssignProjectDialog
					schemeId={scheme.id}
					projects={data.projects}
					onClose={() => (assigning = false)}
				/>
			{/if}
		{/key}
		{#if confirmingGrant}
			<ConfirmDialog
				title="Remove permission grant"
				message={`Remove ${permissionLabel(confirmingGrant.permissionKey)} from ${holderLabel(confirmingGrant, data.detail.roles)}? The holder loses this permission in every project that uses this scheme.`}
				confirmLabel="Remove"
				onConfirm={() => {
					const grant = confirmingGrant;
					confirmingGrant = null;
					if (grant) {
						const form = document.getElementById(
							`remove-grant-${grant.id}`,
						) as HTMLFormElement | null;
						form?.requestSubmit();
					}
				}}
				onClose={() => (confirmingGrant = null)}
			/>
		{/if}
		{#if confirmingProject}
			<ConfirmDialog
				title="Remove project from permission scheme"
				message={`Remove ${confirmingProject.key} — ${confirmingProject.name} from this scheme? The project uses the built-in default after that.`}
				confirmLabel="Remove"
				onConfirm={() => {
					const project = confirmingProject;
					confirmingProject = null;
					if (project) {
						const form = document.getElementById(
							`remove-project-${project.id}`,
						) as HTMLFormElement | null;
						form?.requestSubmit();
					}
				}}
				onClose={() => (confirmingProject = null)}
			/>
		{/if}
		{#if confirmingDelete}
			<ConfirmDialog
				title="Delete permission scheme"
				message={`Delete ${scheme.name}? Its grants are removed with it. This cannot be undone.`}
				confirmLabel="Delete"
				onConfirm={() => {
					confirmingDelete = false;
					const form = document.getElementById(
						"delete-scheme",
					) as HTMLFormElement | null;
					form?.requestSubmit();
				}}
				onClose={() => (confirmingDelete = false)}
			/>
		{/if}
	</AdminPage>
{:else if data.id === ""}
	<AdminPage title="Permission scheme" {breadcrumb}>
		<Banner tone="warning">
			No permission scheme was given in the address.
		</Banner>
	</AdminPage>
{:else}
	<AdminPage title="Permission scheme not found" {breadcrumb}>
		<Banner tone="danger">{data.error}</Banner>
	</AdminPage>
{/if}

<style>
	.scheme-section {
		margin-bottom: 32px;
	}

	.section-heading {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 8px;
	}

	h2 {
		margin: 0;
		font-size: 20px;
		font-weight: 500;
	}

	.grants-title {
		margin: 0 0 8px;
	}

	.section-action {
		margin-left: auto;
	}

	.subtle {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.delete-reason {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.projects {
		margin: 0;
		padding-left: 20px;
	}

	.projects li {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.projects li form {
		margin-left: auto;
	}

	.grants-table {
		width: 100%;
	}

	.permission-column {
		width: 30%;
	}

	.grant-actions-column {
		width: 90px;
	}

	.top {
		vertical-align: top;
	}

	.right {
		text-align: right;
	}

	.grant-holder {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 4px;
	}

	.remove-cell {
		margin-bottom: 4px;
	}

	form {
		margin: 0;
	}
</style>
