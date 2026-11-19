<script lang="ts">
	import { invalidate } from "$app/navigation";
	import { page } from "$app/state";
	import { api } from "#lib/api.ts";
	import Banner from "#lib/admin/Banner.svelte";
	import Button from "#lib/components/Button.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import { formatDateOnly } from "#lib/dates.ts";
	import ProjectAdminDenied from "#lib/project/ProjectAdminDenied.svelte";
	import ProjectFrame from "#lib/project/ProjectFrame.svelte";
	import { rememberProject } from "#lib/recent-projects.ts";
	import ComponentDialog from "./ComponentDialog.svelte";
	import GitlabSection from "./GitlabSection.svelte";
	import ProjectDetailsForm from "./ProjectDetailsForm.svelte";
	import ServiceDeskAccess from "./ServiceDeskAccess.svelte";
	import type { ComponentRow, VersionRow } from "./types.ts";
	import VersionDialog from "./VersionDialog.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let componentDialog = $state<ComponentRow | "new" | null>(null);
	let versionDialog = $state<VersionRow | "new" | null>(null);
	let deleting = $state<
		| { kind: "component" | "version"; id: string; name: string }
		| null
	>(null);
	let deletePending = $state(false);
	let pageError = $state<string | null>(null);
	let projectKey = $derived(data.sidebar.project.key);

	$effect(() => {
		projectKey;
		rememberProject(page.data.user?.id ?? "", {
			key: data.sidebar.project.key,
			name: data.sidebar.project.name,
			avatarUrl: data.sidebar.project.avatarUrl,
		});
		componentDialog = null;
		versionDialog = null;
		deleting = null;
		pageError = null;
	});

	async function confirmDelete() {
		if (!deleting) return;
		deletePending = true;
		pageError = null;
		try {
			const path =
				deleting.kind === "component"
					? `/api/components/${deleting.id}`
					: `/api/versions/${deleting.id}`;
			await api(path, { method: "DELETE" });
			deleting = null;
			await invalidate("app:project");
		} catch (cause) {
			pageError =
				cause instanceof Error ? cause.message : "Something went wrong";
		} finally {
			deletePending = false;
		}
	}
</script>

<PageTitle title="Project settings" />

{#if data.project}
	<ProjectFrame data={data.sidebar} active="settings">
	{#key data.project.key}
		<div class="content">
			<h1>Project settings</h1>
			<p class="roles-link">
				<a
					href={`/plugins/servlet/project-config/${data.project.key}/roles`}
				>
					Users and roles
				</a>
			</p>

			{#if data.project.archived}
				<Banner tone="warning">
					This project is archived. It is read-only.
				</Banner>
			{/if}

			{#if pageError}
				<p class="error" role="alert">{pageError}</p>
			{/if}

			<ProjectDetailsForm project={data.project} />

			{#if data.desk}
				<ServiceDeskAccess
					projectKey={data.project.key}
					openAccess={data.desk.openAccess}
				/>
			{/if}

			<section class="section">
				<div class="section-header">
					<h2>Components</h2>
					<div class="section-action">
						<Button
							appearance="primary"
							spacing="compact"
							onclick={() => (componentDialog = "new")}
						>
							Add component
						</Button>
					</div>
				</div>
				<table class="fat-table">
					<thead>
						<tr>
							<th>Name</th>
							<th>Description</th>
							<th class="actions-column"></th>
						</tr>
					</thead>
					<tbody>
						{#each data.project.components as component (component.id)}
							<tr>
								<td>{component.name}</td>
								<td>{component.description ?? "—"}</td>
								<td class="actions">
									<Button
										spacing="compact"
										onclick={() => (componentDialog = component)}
									>
										Edit
									</Button>
									{" "}
									<Button
										spacing="compact"
										appearance="danger"
										onclick={() =>
											(deleting = {
												kind: "component",
												id: component.id,
												name: component.name,
											})}
									>
										Delete
									</Button>
								</td>
							</tr>
						{:else}
							<tr>
								<td colspan="3" class="muted">No components.</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>

			<section class="section versions">
				<div class="section-header">
					<h2>Versions</h2>
					<div class="section-action">
						<Button
							appearance="primary"
							spacing="compact"
							onclick={() => (versionDialog = "new")}
						>
							Add version
						</Button>
					</div>
				</div>
				<table class="fat-table">
					<thead>
						<tr>
							<th>Name</th>
							<th>Start</th>
							<th>Release</th>
							<th>Released</th>
							<th class="actions-column"></th>
						</tr>
					</thead>
					<tbody>
						{#each data.project.versions as version (version.id)}
							<tr>
								<td>{version.name}</td>
								<td>{formatDateOnly(version.startDate) || "—"}</td>
								<td>{formatDateOnly(version.releaseDate) || "—"}</td>
								<td>{version.released ? "Yes" : "No"}</td>
								<td class="actions">
									<Button
										spacing="compact"
										onclick={() => (versionDialog = version)}
									>
										Edit
									</Button>
									{" "}
									<Button
										spacing="compact"
										appearance="danger"
										onclick={() =>
											(deleting = {
												kind: "version",
												id: version.id,
												name: version.name,
											})}
									>
										Delete
									</Button>
								</td>
							</tr>
						{:else}
							<tr>
								<td colspan="5" class="muted">No versions.</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>

			{#if data.gitlab}
				<GitlabSection projectKey={data.project.key} settings={data.gitlab} />
			{/if}
		</div>
	{/key}
	</ProjectFrame>
{:else}
	<ProjectFrame data={data.sidebar} active="settings">
		<ProjectAdminDenied
			title="Project settings"
			projectKey={data.sidebar.project.key}
		/>
	</ProjectFrame>
{/if}

{#if data.project}
	{#key data.project.key}
	{#if componentDialog}
		<ComponentDialog
			component={componentDialog}
			onClose={() => (componentDialog = null)}
		/>
	{/if}

	{#if versionDialog}
		<VersionDialog
			version={versionDialog}
			onClose={() => (versionDialog = null)}
		/>
	{/if}
	{/key}
{/if}

{#if deleting}
	<ConfirmDialog
		title={`Delete ${deleting.kind}`}
		message={`Delete "${deleting.name}"? This cannot be undone.`}
		onClose={() => (deleting = null)}
		onConfirm={() => void confirmDelete()}
		pending={deletePending}
	/>
{/if}

<style>
	.content {
		flex: 1;
		min-width: 0;
		padding: 24px 32px;
		max-width: 1000px;
	}

	h1 {
		margin: 0 0 16px;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text);
	}

	h2 {
		margin: 0;
		font-size: 20px;
		font-weight: 500;
	}

	.roles-link {
		margin: 0 0 16px;
		color: var(--ds-text-subtle);
	}

	.section {
		margin-bottom: 32px;
	}

	.versions {
		margin-bottom: 0;
	}

	.section-header {
		display: flex;
		align-items: center;
		margin-bottom: 8px;
	}

	.section-action {
		margin-left: auto;
	}

	.actions-column {
		width: 140px;
	}

	.actions {
		text-align: right;
	}

	.muted {
		color: var(--ds-text-subtle);
	}

	.error {
		margin: 0 0 12px;
		color: #e5493a;
	}

</style>
