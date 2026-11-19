<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { CustomFieldSpec, UserRef, UserWithEmail } from "#lib/api-types.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import Icon from "#lib/components/Icon.svelte";
	import { dismiss } from "#lib/components/dismiss.ts";
	import UserSearchResults from "../UserSearchResults.svelte";
	import { UserSearch } from "../user-search.svelte.ts";
	import {
		toStoredUser,
		usersOf,
		type StoredUser,
	} from "../custom-field-values.ts";
	import { chipStyle, inputStyle, menuStyle } from "../styles.ts";

	interface Props {
		field: CustomFieldSpec;
		value: unknown;
		onChange: (value: unknown) => void;
	}

	let { field, value, onChange }: Props = $props();

	let selected = $derived(usersOf(value));
	let open = $state(false);
	let query = $state("");
	const search = new UserSearch();

	$effect(() => {
		if (!open) search.cancel();
	});

	$effect(() => () => search.cancel());

	function type(value: string) {
		query = value;
		open = true;
		search.search(query);
	}

	function add(user: UserRef) {
		if (selected.some((item) => item.id === user.id)) return;
		const next = [...selected, toStoredUser(user)];
		onChange(next);
		query = "";
		open = false;
		search.cancel();
	}

	function remove(user: StoredUser) {
		const next = selected.filter((item) => item.id !== user.id);
		onChange(next.length === 0 ? null : next);
	}

	function isSelected(user: UserWithEmail) {
		return selected.some((item) => item.id === user.id);
	}

	const chipsStyle =
		"display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px;";
	const removeStyle = `display: inline-flex; padding: 0; background: transparent; border: 0; color: ${token(
		"color.text.subtle",
	)}; cursor: pointer;`;
</script>

<div {@attach dismiss(() => open, () => (open = false))} style="position: relative;">
	{#if selected.length > 0}
		<div style={chipsStyle}>
			{#each selected as user (user.id)}
				<span style={chipStyle}>
					<Avatar
						user={{
							displayName: user.displayName,
							username: user.name,
							avatarUrl: null,
						}}
						size={16}
					/>
					{user.displayName}
					<button
						type="button"
						aria-label={`Remove ${user.displayName}`}
						onclick={() => remove(user)}
						style={removeStyle}
					>
						<Icon name="close" size={10} />
					</button>
				</span>
			{/each}
		</div>
	{/if}
	<input
		aria-label={field.name}
		placeholder="Search users"
		value={query}
		onfocus={() => {
			open = true;
			search.search(query, true);
		}}
		oninput={(event) => type(event.currentTarget.value)}
		style={inputStyle}
	/>
	{#if open}
		<div role="listbox" aria-label={`${field.name} users`} style={menuStyle}>
			<UserSearchResults
				users={search.users}
				pending={search.pending}
				failed={search.failed}
				selected={isSelected}
				onChoose={add}
			/>
		</div>
	{/if}
</div>
