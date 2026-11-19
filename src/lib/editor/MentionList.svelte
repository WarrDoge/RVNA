<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import type { UserRef } from "#lib/api-types.ts";

	interface Props {
		users: UserRef[];
		active: number;
		pending: boolean;
		left: number;
		top: number;
		onPick: (user: UserRef) => void;
	}

	let { users, active, pending, left, top, onPick }: Props = $props();

	const listStyle = $derived(
		`position: absolute; z-index: 100; left: ${left}px; top: ${top}px; width: 280px; max-height: 220px; overflow-y: auto; background-color: ${token(
			"elevation.surface.overlay",
		)}; border: 1px solid ${token(
			"color.border",
		)}; border-radius: 3px; box-shadow: ${token("elevation.shadow.overlay")};`,
	);

	function optionStyle(index: number) {
		return `display: flex; align-items: center; gap: 8px; background-color: ${
			index === active ? token("color.background.neutral.subtle") : "transparent"
		};`;
	}
</script>

<div role="listbox" aria-label="Mention a user" style={listStyle}>
	{#if users.length === 0}
		<div
			style="padding: 8px 12px; color: {token('color.text.subtle')};"
		>
			{pending ? "Searching…" : "No users found"}
		</div>
	{:else}
		{#each users as user, index (user.id)}
			<button
				type="button"
				role="option"
				aria-selected={index === active}
				class="fat-menu-item"
				style={optionStyle(index)}
				onmousedown={(event) => event.preventDefault()}
				onclick={() => onPick(user)}
			>
				<Avatar {user} size={20} />
				<span>{user.displayName}</span>
				<span
					style="margin-left: auto; font-size: 12px; color: {token(
						'color.text.subtle',
					)};"
				>
					{user.username}
				</span>
			</button>
		{/each}
	{/if}
</div>
