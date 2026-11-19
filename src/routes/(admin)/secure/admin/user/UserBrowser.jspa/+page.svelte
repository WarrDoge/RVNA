<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { onDestroy } from "svelte";
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import EmptyRow from "#lib/admin/EmptyRow.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import { loginMethods, originLabel } from "#lib/admin/users.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import Button from "#lib/components/Button.svelte";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import { absoluteDate, relativeDate } from "#lib/dates.ts";
	import CreateUserDialog from "./CreateUserDialog.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let searchDraft = $state<string | null>(null);
	let activeDraft = $state<"all" | "true" | "false" | null>(null);
	let groupDraft = $state<string | null>(null);
	let creating = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	onDestroy(() => clearTimeout(timer));

	let search = $derived(searchDraft ?? data.filters.query);
	let query = $derived(data.filters.query);
	let active = $derived(activeDraft ?? data.filters.active);
	let group = $derived(groupDraft ?? data.filters.group);
	let total = $derived(data.total);
	let start = $derived(total === 0 ? 0 : data.filters.offset + 1);
	let end = $derived(Math.min(data.filters.offset + data.pageSize, total));
	let filtered = $derived(query !== "" || active !== "all" || group !== "");

	function address(next: {
		query: string;
		active: "all" | "true" | "false";
		group: string;
		offset: number;
	}) {
		const params = new URLSearchParams();
		if (next.query !== "") params.set("query", next.query);
		if (next.active !== "all") params.set("active", next.active);
		if (next.group !== "") params.set("group", next.group);
		if (next.offset > 0) params.set("offset", String(next.offset));
		const search = params.toString();
		return `${page.url.pathname}${search === "" ? "" : `?${search}`}`;
	}

	async function go(next: Partial<{
		query: string;
		active: "all" | "true" | "false";
		group: string;
		offset: number;
	}>) {
		await goto(
			address({
				query,
				active,
				group,
				offset: data.filters.offset,
				...next,
			}),
			{ replace: true, reset: false },
		);
	}

	function onSearch(value: string) {
		searchDraft = value;
		clearTimeout(timer);
		timer = setTimeout(() => {
			const next = value.trim();
			void go({ query: next, offset: 0 }).then(() => {
				if (searchDraft?.trim() === next) searchDraft = null;
			});
		}, 300);
	}
</script>

{#snippet actions()}
	<Button appearance="primary" onclick={() => (creating = true)}>
		Create user
	</Button>
{/snippet}

<AdminPage
	title="Users"
	description="Users arrive from the identity provider, from the Jira import, or as local accounts created here."
	{actions}
>
	<div class="filters">
		<input
			aria-label="Search users"
			placeholder="Search users"
			bind:value={() => search, (value) => onSearch(value)}
			style="{inputStyle} width: 260px;"
		/>
		<label class="filter-label">
			Active
			<select
				aria-label="Filter by active"
				bind:value={() => active, (value) => {
					const next = value as "all" | "true" | "false";
					activeDraft = next;
					void go({ active: next, offset: 0 }).then(() => {
						if (activeDraft === next) activeDraft = null;
					});
				}}
				class="select"
			>
				<option value="all">All</option>
				<option value="true">Active</option>
				<option value="false">Inactive</option>
			</select>
		</label>
		<label class="filter-label">
			Group
			<select
				aria-label="Filter by group"
				bind:value={() => group, (value) => {
					groupDraft = value;
					void go({ group: value, offset: 0 }).then(() => {
						if (groupDraft === value) groupDraft = null;
					});
				}}
				class="select"
			>
				<option value="">All groups</option>
				{#each data.groups as item (item.id)}
					<option value={item.name}>{item.name}</option>
				{/each}
			</select>
		</label>
	</div>

	<table class="fat-table table">
		<thead>
			<tr>
				<th>User</th>
				<th class="username-column">Username</th>
				<th class="email-column">Email</th>
				<th class="groups-column">Groups</th>
				<th class="last-login-column">Last login</th>
				<th class="active-column">Active</th>
				<th class="methods-column">Login methods</th>
				<th class="origin-column">Origin</th>
			</tr>
		</thead>
		<tbody>
			{#each data.users as user (user.id)}
				<tr>
					<td>
						<span class="user-cell">
							<Avatar user={user} size={24} />
							<a
								href={`/secure/admin/user/ViewUser.jspa?name=${encodeURIComponent(user.username)}`}
								class="user-link"
								class:inactive={!user.active}
							>
								{user.displayName}
							</a>
							{#if user.isAdmin}
								<Lozenge appearance="new">Administrator</Lozenge>
							{/if}
						</span>
					</td>
					<td class="subtle">{user.username}</td>
					<td>{user.email ?? "—"}</td>
					<td>
						{#if user.groups.length === 0}
							<span class="subtle">—</span>
						{:else}
							{#each user.groups as item (item.id)}
								<span
									class="group"
									title={item.local
										? "Local group, membership is managed here"
										: "Group from the identity provider"}
								>
									<Lozenge appearance={item.local ? "moved" : "default"}>
										{item.name}
									</Lozenge>
								</span>
							{/each}
						{/if}
					</td>
					<td title={absoluteDate(user.lastLoginAt)}>
						{#if user.lastLoginAt}
							{relativeDate(user.lastLoginAt)}
						{:else}
							<span class="subtle">Never</span>
						{/if}
					</td>
					<td>{user.active ? "Yes" : "No"}</td>
					<td>{loginMethods(user)}</td>
					<td class="subtle">{originLabel(user)}</td>
				</tr>
			{/each}
			{#if data.users.length === 0}
				<EmptyRow columns={8}>
					{#if filtered}
						No users match these filters.
					{:else}
						No users yet.{" "}
						<button
							type="button"
							class="link-button"
							onclick={() => (creating = true)}
						>
							Create the first user
						</button>
					{/if}
				</EmptyRow>
			{/if}
		</tbody>
	</table>

	<div class="pager">
		<span>{total === 0 ? "No users" : `${start}–${end} of ${total}`}</span>
		<div class="pager-buttons">
			<button
				type="button"
				disabled={data.filters.offset === 0}
				onclick={() => go({ offset: Math.max(0, data.filters.offset - data.pageSize) })}
				class="pager-button"
			>
				Previous
			</button>
			<button
				type="button"
				disabled={end >= total}
				onclick={() => go({ offset: data.filters.offset + data.pageSize })}
				class="pager-button"
			>
				Next
			</button>
		</div>
	</div>

	{#if creating}
		<CreateUserDialog onClose={() => (creating = false)} />
	{/if}
</AdminPage>

<style>
	.filters {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-bottom: 16px;
		flex-wrap: wrap;
	}

	.filter-label {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.select {
		height: 32px;
		padding: 0 4px;
		background-color: var(--ds-background-input);
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text);
		font-size: 14px;
	}

	.table {
		width: 100%;
	}

	.username-column {
		width: 130px;
	}

	.email-column {
		width: 170px;
	}

	.groups-column {
		width: 180px;
	}

	.last-login-column {
		width: 110px;
	}

	.active-column {
		width: 60px;
	}

	.methods-column {
		width: 110px;
	}

	.origin-column {
		width: 195px;
	}

	.user-cell {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.user-link {
		color: var(--ds-link);
		font-weight: 500;
		text-decoration: none;
	}

	.user-link.inactive {
		text-decoration: line-through;
	}

	.subtle {
		color: var(--ds-text-subtle);
	}

	.group {
		margin-right: 4px;
		white-space: nowrap;
	}

	.link-button {
		padding: 0;
		background: none;
		border: 0;
		color: var(--ds-link);
		cursor: pointer;
		font-size: 14px;
	}

	.pager {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 12px;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.pager-buttons {
		margin-left: auto;
		display: flex;
		gap: 8px;
	}

	.pager-button {
		height: 28px;
		padding: 0 10px;
		background-color: var(--ds-background-neutral);
		color: var(--ds-text);
		border: 0;
		border-radius: 3px;
		cursor: pointer;
		font-size: 13px;
	}

	.pager-button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
