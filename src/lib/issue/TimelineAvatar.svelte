<script lang="ts">
	import Avatar from "#lib/components/Avatar.svelte";
	import type { UserRef } from "#lib/api-types.ts";

	interface Props {
		user: UserRef | null;
	}

	let { user }: Props = $props();
</script>

{#if user}
	<Avatar {user} size={24} />
{:else}
	<span class="timeline-avatar-empty"></span>
{/if}

<style>
	.timeline-avatar-empty {
		display: inline-flex;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background-color: var(--ds-background-neutral, #091e420f);
		flex: none;
	}
</style>
