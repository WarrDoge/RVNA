<script lang="ts">
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import EmptyRow from "#lib/admin/EmptyRow.svelte";
	import Button from "#lib/components/Button.svelte";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import CopySchemeDialog from "./CopySchemeDialog.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	type Scheme = (typeof data.schemes)[number];
	let copying = $state<Scheme | null>(null);
</script>

<AdminPage
	title="Permission schemes"
	description="Permission schemes decide what each project role can do. A project without a scheme uses the built-in default."
>
	<table class="fat-table schemes-table">
		<thead>
			<tr>
				<th>Name</th>
				<th>Projects</th>
				<th class="source-column">Source</th>
				<th class="actions-column"></th>
			</tr>
		</thead>
		<tbody>
			{#each data.schemes as scheme (scheme.id)}
				<tr>
					<td>
						<a
							class="scheme-link"
							href={`/secure/admin/ViewPermissionScheme.jspa?id=${scheme.id}`}
						>
							{scheme.name}
						</a>
						{#if scheme.description}
							<div class="subtle">{scheme.description}</div>
						{/if}
					</td>
					<td>
						{#if scheme.projects.length === 0}
							<span class="subtle">No projects</span>
						{:else}
							{#each scheme.projects as project, index (project.id)}
								{index > 0 ? ", " : ""}<a
									href={`/projects/${project.key}/issues`}>{project.name}</a
								>
							{/each}
						{/if}
					</td>
					<td>
						<Lozenge appearance={scheme.source === "local" ? "moved" : "default"}>
							{scheme.source === "local" ? "Local" : "Imported"}
						</Lozenge>
					</td>
					<td class="copy-cell">
						<Button
							appearance="subtle"
							spacing="compact"
							onclick={() => (copying = scheme)}
						>
							Copy
						</Button>
					</td>
				</tr>
			{/each}
			{#if data.schemes.length === 0}
				<EmptyRow columns={4}>
					No permission schemes yet. Import a project from Jira or copy a
					scheme.
				</EmptyRow>
			{/if}
		</tbody>
	</table>
	{#if copying}
		<CopySchemeDialog scheme={copying} onClose={() => (copying = null)} />
	{/if}
</AdminPage>

<style>
	.schemes-table {
		width: 100%;
	}

	.source-column {
		width: 110px;
	}

	.actions-column {
		width: 90px;
	}

	.scheme-link {
		color: var(--ds-link);
		font-weight: 500;
		white-space: nowrap;
	}

	.subtle {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.copy-cell {
		text-align: right;
	}
</style>
