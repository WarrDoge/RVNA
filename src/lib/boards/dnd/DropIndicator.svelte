<script lang="ts">
	interface Props {
		active?: boolean;
		testId?: string;
	}

	let { active = true, testId }: Props = $props();
</script>

{#if active}
	<div class="drop-indicator" data-testid={testId} aria-hidden="true"></div>
{/if}

<style>
	.drop-indicator {
		position: absolute;
		top: -1px;
		left: 0;
		right: 0;
		z-index: 2;
		height: 2px;
		border-radius: 1px;
		background-color: var(--ds-border-dropindicator, #4688ec);
		pointer-events: none;
	}
</style>
