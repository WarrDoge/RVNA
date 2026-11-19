<script lang="ts">
	import Avatar from "#lib/components/Avatar.svelte";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import type { ProjectRoleActor } from "./types.ts";

	interface Props {
		actor: ProjectRoleActor;
		roleName: string;
		removing: boolean;
		onRemove: () => void;
	}

	let { actor, roleName, removing, onRemove }: Props = $props();
</script>

<div class="actor-line">
	{#if actor.actorType === "user"}
		<Avatar
			user={{
				displayName: actor.displayName,
				username: actor.parameter,
				avatarUrl: null,
			}}
			size={20}
		/>
	{:else}
		<span class="group-glyph" aria-hidden="true">G</span>
	{/if}
	<span class="actor-name">{actor.displayName}</span>
	{#if actor.source === "imported"}
		<Lozenge appearance="default">Imported</Lozenge>
	{/if}
	<button
		type="button"
		class="remove"
		aria-label={`Remove ${actor.displayName} from ${roleName}`}
		onclick={onRemove}
		disabled={removing}
	>
		Remove
	</button>
</div>

<style>
	.actor-line {
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		gap: 6px;
		margin-bottom: 4px;
	}

	.group-glyph {
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		border-radius: 3px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background-color: var(--ds-background-neutral);
		color: var(--ds-text-subtle);
		font-size: 10px;
		font-weight: 700;
	}

	.actor-name {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.remove {
		flex-shrink: 0;
		white-space: nowrap;
		padding: 2px 6px;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text-subtle);
		cursor: pointer;
		font-size: 12px;
	}
</style>
