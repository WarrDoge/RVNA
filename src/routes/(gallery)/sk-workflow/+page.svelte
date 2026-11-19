<script lang="ts">
	import WorkflowDiagram from "#lib/workflow/WorkflowDiagram.svelte";
	import { workflowGallery } from "#lib/workflow/gallery.ts";

	let supportStatus = $state<string | null>(null);
	let supportTransition = $state<string | null>(null);
	let releaseStatus = $state<string | null>(null);
	let releaseTransition = $state<string | null>(null);
</script>

<svelte:head>
	<title>Workflow diagram gallery - RVNA</title>
</svelte:head>

<main class="gallery">
	<h1>Workflow diagram</h1>

	<section data-gallery="workflow-small">
		<h2>{workflowGallery.supportFlow.name}</h2>
		<p class="muted">{workflowGallery.supportFlow.description}</p>
		<WorkflowDiagram
			detail={workflowGallery.supportFlow}
			selectedStatusId={supportStatus}
			selectedTransitionId={supportTransition}
			onSelectStatus={(id) => {
				supportStatus = id;
				supportTransition = null;
			}}
			onSelectTransition={(id) => {
				supportTransition = id;
				supportStatus = null;
			}}
		/>
		<p class="selection" data-testid="support-selected-status">
			Selected status: {supportStatus ?? "none"}
		</p>
		<p class="selection" data-testid="support-selected-transition">
			Selected transition: {supportTransition ?? "none"}
		</p>
	</section>

	<section data-gallery="workflow-large">
		<h2>{workflowGallery.releasePipeline.name}</h2>
		<p class="muted">{workflowGallery.releasePipeline.description}</p>
		<WorkflowDiagram
			detail={workflowGallery.releasePipeline}
			selectedStatusId={releaseStatus}
			selectedTransitionId={releaseTransition}
			onSelectStatus={(id) => {
				releaseStatus = id;
				releaseTransition = null;
			}}
			onSelectTransition={(id) => {
				releaseTransition = id;
				releaseStatus = null;
			}}
		/>
		<p class="selection" data-testid="release-selected-status">
			Selected status: {releaseStatus ?? "none"}
		</p>
		<p class="selection" data-testid="release-selected-transition">
			Selected transition: {releaseTransition ?? "none"}
		</p>
	</section>
</main>

<style>
	.gallery {
		padding: 24px 32px 64px;
		background-color: var(--ds-surface);
		color: var(--ds-text);
	}

	h1 {
		margin: 0 0 8px;
		font-size: 24px;
		font-weight: 600;
	}

	h2 {
		margin: 0 0 4px;
		font-size: 18px;
		font-weight: 600;
	}

	section {
		padding: 24px 0;
		border-bottom: 1px solid var(--ds-border);
	}

	.muted {
		margin: 0 0 16px;
		color: var(--ds-text-subtle);
	}

	.selection {
		margin: 8px 0 0;
		font-size: 12px;
		color: var(--ds-text-subtle);
	}
</style>
