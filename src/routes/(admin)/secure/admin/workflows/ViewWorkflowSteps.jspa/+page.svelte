<script lang="ts">
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import Banner from "#lib/admin/Banner.svelte";
	import WorkflowEditor from "./WorkflowEditor.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const textUrl = (name: string) =>
		`/secure/admin/workflows/ViewWorkflowSteps.jspa?workflowName=${encodeURIComponent(name)}&mode=text`;
	const diagramUrl = (name: string) =>
		`/secure/admin/workflows/ViewWorkflowSteps.jspa?workflowName=${encodeURIComponent(name)}&mode=diagram`;
</script>

<AdminPage
	title={data.name === "" ? "Workflow" : data.name}
	description={data.summary?.description ?? undefined}
>
	{#snippet breadcrumb()}
		<a href="/secure/admin/workflows/ListWorkflows.jspa">
			&larr; Back to workflows
		</a>
	{/snippet}

	{#snippet actions()}
		{#if data.summary}
			<nav class="mode-switch" aria-label="View">
				<a
					href={textUrl(data.summary.name)}
					aria-current={data.mode === "text" ? "page" : undefined}
					class:active={data.mode === "text"}
				>
					Text
				</a>
				<a
					href={diagramUrl(data.summary.name)}
					aria-current={data.mode === "diagram" ? "page" : undefined}
					class:active={data.mode === "diagram"}
				>
					Diagram
				</a>
			</nav>
		{/if}
	{/snippet}

	{#if !data.summary || !data.detail}
		<Banner tone="warning">
			{data.name === ""
				? "No workflow was chosen."
				: `There is no workflow named ${data.name}. It may have been renamed or deleted.`}
			{" "}
			<a href="/secure/admin/workflows/ListWorkflows.jspa">Back to workflows</a>
		</Banner>
	{:else}
		{#key data.summary.id}
			<WorkflowEditor initialDetail={data.detail} mode={data.mode} />
		{/key}
	{/if}
</AdminPage>

<style>
	.mode-switch {
		display: inline-flex;
		overflow: hidden;
		border-radius: 3px;
	}

	.mode-switch a {
		padding: 4px 12px;
		font-size: 14px;
		text-decoration: none;
		color: var(--ds-text);
		background-color: var(--ds-background-neutral);
	}

	.mode-switch a.active {
		color: var(--ds-text-selected);
		background-color: var(--ds-background-selected);
	}
</style>
