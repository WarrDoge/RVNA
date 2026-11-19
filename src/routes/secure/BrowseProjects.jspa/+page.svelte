<script lang="ts">
	import PageTitle from "#lib/components/PageTitle.svelte";
	import ProjectAvatar from "#lib/components/ProjectAvatar.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();
</script>

<PageTitle title="Projects" />

<section class="projects">
	<h1>Projects</h1>
	<table class="fat-table">
		<thead>
			<tr>
				<th class="avatar-column" aria-label="Project avatar"></th>
				<th>Name</th>
				<th>Key</th>
				<th>Type</th>
				<th>Lead</th>
				<th>Category</th>
			</tr>
		</thead>
		<tbody>
			{#each data.projects as project (project.id)}
				<tr>
					<td>
						<ProjectAvatar
							name={project.name}
							avatarUrl={project.avatarUrl}
							size={24}
						/>
					</td>
					<td>
						<a class="project-link" href={`/projects/${project.key}/issues`}>
							{project.name}
						</a>
					</td>
					<td>{project.key}</td>
					<td>{project.type === "service_desk" ? "Service desk" : "Software"}</td>
					<td>{project.lead?.displayName ?? "—"}</td>
					<td>{project.category ?? "—"}</td>
				</tr>
			{:else}
				<tr>
					<td colspan="6" class="muted">No projects yet.</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<style>
	.projects {
		padding: 24px 32px;
	}

	h1 {
		margin: 0 0 16px;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text);
	}

	.fat-table {
		width: 100%;
	}

	.avatar-column {
		width: 32px;
	}

	.project-link {
		color: var(--ds-link);
	}

	.muted {
		color: var(--ds-text-subtle);
	}
</style>
