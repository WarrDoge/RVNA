<script lang="ts">
	import type { UserWithEmail } from "#lib/api-types.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import { menuItemStyle, noneStyle } from "./styles.ts";

	interface Props {
		users: UserWithEmail[];
		pending: boolean;
		failed: boolean;
		selected?: (user: UserWithEmail) => boolean;
		onChoose: (user: UserWithEmail) => void;
	}

	let { users, pending, failed, selected, onChoose }: Props = $props();

	const mutedStyle = `padding: 6px; ${noneStyle}`;
	const usernameStyle = `margin-left: auto; ${noneStyle} font-size: 12px;`;
</script>

{#if pending}
	<div style={mutedStyle}>Searching…</div>
{/if}
{#each users as user (user.id)}
	<button
		type="button"
		role="option"
		aria-selected={selected?.(user) ?? false}
		onclick={() => onChoose(user)}
		style={menuItemStyle}
	>
		<Avatar user={user} size={20} />
		<span>{user.displayName}</span>
		<span style={usernameStyle}>{user.username}</span>
	</button>
{/each}
{#if !pending && !failed && users.length === 0}
	<div style={mutedStyle}>No users found.</div>
{/if}
