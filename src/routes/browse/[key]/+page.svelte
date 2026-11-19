<script lang="ts">
	import PageTitle from "#lib/components/PageTitle.svelte";
	import IssueDetailView from "#lib/issue/IssueDetailView.svelte";
	import ProjectFrame from "#lib/project/ProjectFrame.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();
</script>

<PageTitle title={`${data.view.issue.key} ${data.view.issue.summary}`} />

{#if data.sidebar}
	<ProjectFrame data={data.sidebar} active="issues">
		{#key data.view.issue.key}
			<IssueDetailView view={data.view} />
		{/key}
	</ProjectFrame>
{:else}
	{#key data.view.issue.key}
		<IssueDetailView view={data.view} />
	{/key}
{/if}
