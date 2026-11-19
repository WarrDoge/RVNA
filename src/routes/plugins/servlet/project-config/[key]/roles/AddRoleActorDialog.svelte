<script lang="ts">
	import { enhance } from "$app/forms";
	import type { UserWithEmail } from "#lib/api-types.ts";
	import { inputStyle } from "#lib/admin/styles.ts";
	import FormField from "#lib/components/FormField.svelte";
	import { api } from "#lib/api.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import Banner from "#lib/admin/Banner.svelte";
	import Button from "#lib/components/Button.svelte";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import type { ProjectRole } from "./types.ts";

	interface Props {
		roles: ProjectRole[];
		groups: { id: string; name: string; local: boolean }[];
		onClose: () => void;
	}

	let { roles, groups, onClose }: Props = $props();

	let roleId = $state("");
	let tab = $state<"users" | "groups">("users");
	const tabs = [
		["users", "Users"],
		["groups", "Groups"],
	] as const;
	let search = $state("");
	let users = $state<UserWithEmail[]>([]);
	let usersPending = $state(false);
	let usersFailed = $state(false);
	let userId = $state<string | null>(null);
	let groupId = $state<string | null>(null);
	let error = $state<string | null>(null);
	let pending = $state(false);

	let filteredGroups = $derived(
		groups.filter((group) =>
			group.name.toLowerCase().includes(search.trim().toLowerCase()),
		),
	);
	let canAdd = $derived(
		roleId !== "" && (tab === "users" ? userId !== null : groupId !== null),
	);
	let selectedActorId = $derived(tab === "users" ? userId : groupId);

	let requestVersion = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function loadUsers(query: string) {
		const version = ++requestVersion;
		usersPending = true;
		usersFailed = false;
		try {
			const list = await api<UserWithEmail[]>(
				`/api/users?query=${encodeURIComponent(query)}`,
			);
			if (version !== requestVersion) return;
			users = list;
		} catch {
			if (version !== requestVersion) return;
			users = [];
			usersFailed = true;
		} finally {
			if (version === requestVersion) usersPending = false;
		}
	}

	function retryUsers() {
		clearTimeout(timer);
		void loadUsers(search.trim());
	}

	$effect(() => {
		if (tab !== "users") return;
		const query = search.trim();
		clearTimeout(timer);
		timer = setTimeout(() => {
			void loadUsers(query);
		}, 300);
		return () => clearTimeout(timer);
	});
</script>

{#snippet footer()}
	<Button
		appearance="primary"
		type="submit"
		isLoading={pending}
		isDisabled={!canAdd}
	>
		Add
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<form
	method="POST"
	use:enhance={() => {
		pending = true;
		error = null;
		return async ({ result, update }) => {
			pending = false;
			if (result.type === "failure") {
				error = String(
					(result.data as { error?: string } | undefined)?.error ??
						"Something went wrong",
				);
			}
			await update({ reset: false });
			if (result.type === "success") onClose();
		};
	}}
>
	<Modal title="Add users to a role" width={560} {onClose} {footer}>
		{#if error}
			<Banner tone="danger">{error}</Banner>
		{/if}
		<input type="hidden" name="roleId" value={roleId} />
		<input type="hidden" name="actorType" value={tab === "users" ? "user" : "group"} />
		<input type="hidden" name="actorId" value={selectedActorId ?? ""} />

		<FormField label="Role" htmlFor="add-role">
			<select
				id="add-role"
				value={roleId}
				onchange={(event) => (roleId = event.currentTarget.value)}
				style="{inputStyle} appearance: auto;"
			>
				<option value="" disabled>Choose a role</option>
				{#each roles as role (role.id)}
					<option value={role.id}>{role.name}</option>
				{/each}
			</select>
		</FormField>

		<div class="tabs" role="tablist" aria-label="Actor type">
			{#each tabs as [value, label] (value)}
				<button
					type="button"
					id={`actor-tab-${value}`}
					role="tab"
					aria-selected={tab === value}
					aria-controls="add-actor-panel"
					class:selected={tab === value}
					onclick={() => (tab = value)}
				>
					{label}
				</button>
			{/each}
		</div>

		<FormField
			label={tab === "users" ? "Search users" : "Search groups"}
			htmlFor="add-actor-search"
		>
			<input
				id="add-actor-search"
				value={search}
				oninput={(event) => (search = event.currentTarget.value)}
				placeholder={tab === "users" ? "Name or username" : "Group name"}
				style={inputStyle}
			/>
		</FormField>

		<div
			class="actor-list"
			id="add-actor-panel"
			role="tabpanel"
			aria-labelledby={`actor-tab-${tab}`}
		>
			{#if tab === "users"}
				{#if usersFailed}
					<Banner tone="danger">
						Could not load users.
						<button type="button" class="retry" onclick={retryUsers}>
							Retry
						</button>
					</Banner>
				{/if}
				{#each users as user (user.id)}
					<button
						type="button"
						class="actor"
						class:selected={userId === user.id}
						aria-pressed={userId === user.id}
						onclick={() => (userId = user.id)}
					>
						<Avatar user={user} size={20} />
						<span>{user.displayName}</span>
						<span class="username">{user.username}</span>
					</button>
				{/each}
				{#if !usersPending && !usersFailed && users.length === 0}
					<p class="empty">No users match.</p>
				{/if}
			{:else}
				{#each filteredGroups as group (group.id)}
					<button
						type="button"
						class="actor"
						class:selected={groupId === group.id}
						aria-pressed={groupId === group.id}
						onclick={() => (groupId = group.id)}
					>
						<span>{group.name}</span>
						{#if !group.local}
							<Lozenge appearance="default">Imported</Lozenge>
						{/if}
					</button>
				{/each}
				{#if filteredGroups.length === 0}
					<p class="empty">No groups match.</p>
				{/if}
			{/if}
		</div>
	</Modal>
</form>

<style>
	form {
		margin: 0;
	}

	.tabs {
		display: flex;
		gap: 4px;
		margin-bottom: 12px;
	}

	.tabs button {
		height: 30px;
		padding: 0 12px;
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		background-color: transparent;
		color: var(--ds-text);
		cursor: pointer;
		font-weight: 400;
	}

	.tabs button.selected {
		background-color: var(--ds-background-selected);
		color: var(--ds-text-selected);
		font-weight: 600;
	}

	.actor-list {
		max-height: 260px;
		overflow-y: auto;
		border: 1px solid var(--ds-border);
		border-radius: 3px;
	}

	.actor {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 10px;
		text-align: left;
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--ds-border);
		color: var(--ds-text);
		cursor: pointer;
	}

	.actor.selected {
		background: var(--ds-background-selected);
		color: var(--ds-text-selected);
	}

	.username {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.empty {
		padding: 10px;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.retry {
		margin-left: 6px;
		padding: 0;
		background: transparent;
		border: 0;
		color: var(--ds-link);
		cursor: pointer;
		font: inherit;
	}
</style>
