<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { Snippet } from "svelte";
	import type { UserRef } from "#lib/api-types.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import UserLink from "#lib/components/UserLink.svelte";

	interface Props {
		label: string;
		user: UserRef | null;
		empty: string;
		action?: Snippet;
	}

	let { label, user, empty, action }: Props = $props();

	const rowStyle = "display: flex; gap: 8px; align-items: flex-start;";
	const labelStyle = `width: 82px; flex: none; color: ${token(
		"color.text.subtle",
	)}; font-size: 14px; line-height: 20px;`;
	const valueStyle = "min-width: 0; flex: 1;";
	const userRowStyle = "display: flex; align-items: center; gap: 6px;";
	const emptyStyle = `color: ${token("color.text.subtle")};`;
</script>

<div style={rowStyle}>
	<div style={labelStyle}>{label}</div>
	<div style={valueStyle}>
		<div style={userRowStyle}>
			{#if user}
				<Avatar user={user} size={20} />
				<UserLink username={user.username}>{user.displayName}</UserLink>
			{:else}
				<span style={emptyStyle}>{empty}</span>
			{/if}
		</div>
		{#if action}
			{@render action()}
		{/if}
	</div>
</div>
