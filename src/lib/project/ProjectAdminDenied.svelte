<script lang="ts">
	interface Props {
		title: string;
		projectKey: string;
	}

	let { title, projectKey }: Props = $props();
</script>

<div class="content">
	<h1>{title}</h1>
	<p>
		You do not have permission to administer this project.{" "}
		<a href={`/projects/${projectKey}/issues`}>Go to the project issues</a>.
	</p>
</div>

<style>
	.content {
		flex: 1;
		min-width: 0;
		padding: 24px 32px;
		max-width: 1100px;
	}

	h1 {
		margin: 0 0 16px;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text);
	}

	p {
		margin: 0;
		color: var(--ds-text-subtle);
	}

	a {
		color: var(--ds-link);
	}
</style>
