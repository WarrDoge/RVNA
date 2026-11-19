<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { Me, UserRef } from "#lib/api-types.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import Icon from "#lib/components/Icon.svelte";
	import { dismiss } from "#lib/components/dismiss.ts";
	import { inputStyle, linkButtonStyle, popupStyle } from "./styles.ts";
	import { UserSearch } from "./user-search.svelte.ts";
	import UserSearchResults from "./UserSearchResults.svelte";

	interface Props {
		id?: string;
		label: string;
		value: UserRef | null;
		onChange: (value: UserRef | null) => void;
		me: Me | null;
		allowMe?: boolean;
	}

	let { id, label, value, onChange, me, allowMe = false }: Props = $props();

	let open = $state(false);
	let query = $state("");
	const search = new UserSearch();

	$effect(() => {
		if (!open) search.cancel();
	});

	$effect(() => () => search.cancel());

	function toggle() {
		open = !open;
		if (open) search.search(query, true);
	}

	function type(value: string) {
		query = value;
		open = true;
		search.search(query);
	}

	function choose(user: UserRef) {
		onChange({
			id: user.id,
			username: user.username,
			displayName: user.displayName,
			avatarUrl: user.avatarUrl,
		});
		open = false;
		query = "";
		search.cancel();
	}

	const resultsStyle = `${popupStyle} z-index: 30;`;
	const valueStyle = `display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 8px; border: 1px solid ${token(
		"color.border.input",
	)}; border-radius: 3px; background-color: ${token(
		"color.background.input",
	)};`;
	const valueButtonStyle = `flex: 1; padding: 0; background: transparent; border: 0; color: ${token(
		"color.text",
	)}; text-align: left; cursor: pointer;`;
	const clearStyle = `display: inline-flex; padding: 0; background: transparent; border: 0; color: ${token(
		"color.text.subtle",
	)}; cursor: pointer;`;

</script>

<div {@attach dismiss(() => open, () => (open = false))} style="position: relative;">
	{#if value}
		<div style={valueStyle}>
			<Avatar user={value} size={20} />
			<button {id} type="button" onclick={toggle} style={valueButtonStyle}>
				{value.displayName}
			</button>
			<button
				type="button"
				aria-label={`Clear ${label}`}
				onclick={() => onChange(null)}
				style={clearStyle}
			>
				<Icon name="close" size={12} />
			</button>
		</div>
	{:else}
		<input
			{id}
			aria-label={label}
			placeholder="Search users"
			bind:value={query}
			onfocus={() => {
				open = true;
				search.search(query, true);
			}}
			oninput={(event) => type(event.currentTarget.value)}
			style={inputStyle}
		/>
	{/if}
	{#if allowMe && me}
		<button
			type="button"
			style={linkButtonStyle}
			onclick={() =>
				choose({
					id: me.id,
					username: me.username,
					displayName: me.displayName,
					avatarUrl: me.avatarUrl,
				})}
		>
			Assign to me
		</button>
	{/if}
	{#if open}
		<div role="listbox" aria-label={`${label} results`} style={resultsStyle}>
			<UserSearchResults
				users={search.users}
				pending={search.pending}
				failed={search.failed}
				onChoose={choose}
			/>
		</div>
	{/if}
</div>
