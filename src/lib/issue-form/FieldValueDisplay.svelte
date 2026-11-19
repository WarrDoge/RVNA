<script lang="ts">
	import type { CustomFieldSpec, UserRef } from "#lib/api-types.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import { absoluteDate, formatDateOnly } from "#lib/dates.ts";
	import {
		cascadingOf,
		httpUrl,
		isEmptyFieldValue,
		optionOf,
		optionsOf,
		stringsOf,
		toUserRef,
		usersOf,
	} from "./custom-field-values.ts";
	import { chipStyle, linkStyle, noneStyle } from "./styles.ts";

	interface Props {
		field: CustomFieldSpec;
		value: unknown;
	}

	let { field, value }: Props = $props();

	const lozengeWrapStyle =
		"display: inline-flex; flex-wrap: wrap; gap: 4px;";
	const userWrapStyle = "display: inline-flex; flex-wrap: wrap; gap: 10px;";
	const userLineStyle = "display: inline-flex; align-items: center; gap: 6px;";
</script>

{#snippet lozenges(values: string[])}
	{#if values.length === 0}
		<span style={noneStyle}>None</span>
	{:else}
		<span style={lozengeWrapStyle}>
			{#each values as item (item)}
				<span style={chipStyle}>{item}</span>
			{/each}
		</span>
	{/if}
{/snippet}

{#snippet userLine(user: UserRef)}
	<span style={userLineStyle}>
		<Avatar {user} size={20} />
		{user.displayName}
	</span>
{/snippet}

{#if isEmptyFieldValue(value)}
	<span style={noneStyle}>None</span>
{:else if field.type === "paragraph"}
	<span style="white-space: pre-wrap;">{String(value)}</span>
{:else if field.type === "date"}
	<span>{formatDateOnly(String(value))}</span>
{:else if field.type === "datetime"}
	<span>{absoluteDate(String(value))}</span>
{:else if field.type === "select"}
	<span>{optionOf(value)?.value ?? ""}</span>
{:else if field.type === "multiselect"}
	{@render lozenges(optionsOf(value).map((item) => item.value))}
{:else if field.type === "cascading"}
	{@const parent = cascadingOf(value)}
	{#if parent}
		<span>
			{parent.value}
			{parent.child ? ` / ${parent.child.value}` : ""}
		</span>
	{:else}
		<span style={noneStyle}>None</span>
	{/if}
{:else if field.type === "user"}
	{@const user = toUserRef(value)}
	{#if user}
		{@render userLine(user)}
	{:else}
		<span style={noneStyle}>None</span>
	{/if}
{:else if field.type === "multiuser"}
	{@const users = usersOf(value)}
	{#if users.length === 0}
		<span style={noneStyle}>None</span>
	{:else}
		<span style={userWrapStyle}>
			{#each users as item (item.id)}
				{@render userLine({
					id: item.id,
					username: item.name,
					displayName: item.displayName,
					avatarUrl: null,
				})}
			{/each}
		</span>
	{/if}
{:else if field.type === "labels"}
	{@render lozenges(stringsOf(value))}
{:else if field.type === "url"}
	{@const href = httpUrl(String(value))}
	{#if href}
		<a href={href} target="_blank" rel="noopener noreferrer" style={linkStyle}
			>{href}</a
		>
	{:else}
		<span>{String(value)}</span>
	{/if}
{:else}
	<span>{String(value)}</span>
{/if}
