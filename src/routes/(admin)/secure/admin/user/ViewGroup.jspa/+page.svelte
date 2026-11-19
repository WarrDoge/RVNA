<script lang="ts">
	import { goto, invalidate } from "$app/navigation";
	import { api } from "#lib/api.ts";
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import Banner from "#lib/admin/Banner.svelte";
	import EmptyRow from "#lib/admin/EmptyRow.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import Button from "#lib/components/Button.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import Lozenge from "#lib/components/Lozenge.svelte";
		import type { PageData } from "./$types";

	type Candidate = {
		id: string;
		username: string;
		displayName: string;
		avatarUrl: string | null;
	};

	let { data }: { data: PageData } = $props();

	const sourceLabels: Record<string, string> = {
		local: "Added here",
		oidc: "Identity provider",
		jira: "Jira import",
		confluence: "Confluence import",
	};

	function sourceLabel(source: string) {
		return sourceLabels[source] ?? source;
	}

	function errorMessage(error: unknown) {
		return error instanceof Error ? error.message : "Something went wrong";
	}

	let actionError = $state<string | null>(null);
	let actionErrorGroupId: string | null = null;
	let memberSearch = $state("");
	let picker = $state("");
	let pickerQuery = $state("");
	let candidates = $state<Candidate[]>([]);
	let candidatesPending = $state(false);
	let addingId = $state<string | null>(null);
	let removingId = $state<string | null>(null);
	let removingMember = $state<
		NonNullable<PageData["group"]>["members"][number] | null
	>(null);
	let deleting = $state(false);
	let deletePending = $state(false);
	let searchVersion = 0;

	$effect(() => {
		const value = picker;
		const timer = setTimeout(() => {
			pickerQuery = value.trim();
		}, 250);
		return () => clearTimeout(timer);
	});

	$effect(() => {
		const query = pickerQuery;
		const group = data.group;
		if (query === "" || !group) {
			candidates = [];
			candidatesPending = false;
			return;
		}
		const controller = new AbortController();
		const version = ++searchVersion;
		candidatesPending = true;
		const params = new URLSearchParams({
			query,
			active: "true",
			offset: "0",
			limit: "8",
		});
		api<{ users: Candidate[] }>(`/api/admin/users?${params.toString()}`, {
			signal: controller.signal,
		})
			.then((result) => {
				if (version !== searchVersion || controller.signal.aborted) return;
				candidates = result.users;
			})
			.catch(() => {
				if (version !== searchVersion || controller.signal.aborted) return;
				candidates = [];
			})
			.finally(() => {
				if (version === searchVersion && !controller.signal.aborted) {
					candidatesPending = false;
				}
			});
		return () => controller.abort();
	});

	$effect(() => {
		const groupId = data.group?.id ?? null;
		if (actionErrorGroupId !== groupId) {
			actionErrorGroupId = groupId;
			actionError = null;
		}
	});

	let needle = $derived(memberSearch.trim().toLowerCase());
	let members = $derived(
		needle === ""
			? (data.group?.members ?? [])
			: (data.group?.members ?? []).filter(
					(member) =>
						member.displayName.toLowerCase().includes(needle) ||
						member.username.toLowerCase().includes(needle) ||
						(member.email ?? "").toLowerCase().includes(needle),
				),
	);
	let memberIds = $derived(
		new Set((data.group?.members ?? []).map((member) => member.id)),
	);
	let suggestions = $derived(
		candidates.filter((user) => !memberIds.has(user.id)),
	);

	async function addMember(userId: string) {
		const group = data.group;
		if (!group || addingId !== null) return;
		addingId = userId;
		try {
			await api(`/api/admin/groups/${group.id}/members`, {
				method: "POST",
				body: JSON.stringify({ userId }),
			});
			actionError = null;
			picker = "";
			pickerQuery = "";
			candidates = [];
			await invalidate("app:admin-group");
		} catch (error) {
			actionError = errorMessage(error);
		} finally {
			addingId = null;
		}
	}

	async function removeMember(userId: string) {
		const group = data.group;
		if (!group || removingId !== null) return;
		removingId = userId;
		try {
			await api(`/api/admin/groups/${group.id}/members/${userId}`, {
				method: "DELETE",
			});
			actionError = null;
			await invalidate("app:admin-group");
		} catch (error) {
			actionError = errorMessage(error);
		} finally {
			removingId = null;
		}
	}

	async function deleteGroup() {
		const group = data.group;
		if (!group) return;
		deletePending = true;
		try {
			await api(`/api/admin/groups/${group.id}`, { method: "DELETE" });
			deleting = false;
			await invalidate("app:admin-groups");
			await goto("/secure/admin/user/GroupBrowser.jspa", {
				replace: true,
			});
		} catch (error) {
			actionError = errorMessage(error);
			deleting = false;
		} finally {
			deletePending = false;
		}
	}
</script>

{#snippet groupsLink()}
	<a href="/secure/admin/user/GroupBrowser.jspa">Groups</a>
{/snippet}

{#if data.missingName}
	<AdminPage title="Group" breadcrumb={groupsLink}>
		<Banner tone="warning">No group name was given in the address.</Banner>
	</AdminPage>
{:else if !data.group}
	<AdminPage title="Group not found" breadcrumb={groupsLink}>
		<p>
			No group is named <strong>{data.name}</strong>.
		</p>
	</AdminPage>
{:else}
	{@const group = data.group}
	<AdminPage title={group.name} breadcrumb={groupsLink}>
		{#snippet description()}
			<span class="group-description">
				<Lozenge appearance={group.local ? "moved" : "default"}>
					{group.local ? "Local group" : "SSO or imported group"}
				</Lozenge>
				{group.members.length}
				{group.members.length === 1 ? "member" : "members"}
			</span>
		{/snippet}

		{#snippet actions()}
			{#if group.local}
				<Button appearance="danger" onclick={() => (deleting = true)}>
					Delete group
				</Button>
			{/if}
		{/snippet}

		{#if actionError}
			<Banner tone="danger">{actionError}</Banner>
		{/if}
		{#if !group.local}
			<Banner tone="information">
				Members that come from the identity provider or an import follow their
				source. Members added here stay until someone removes them here.
			</Banner>
		{/if}

		<section class="add-members">
			<h2>Add members</h2>
			<input
				aria-label="Search users to add"
				placeholder="Search by name, username or email"
				bind:value={picker}
				style="{inputStyle} width: 320px;"
			/>
			{#if pickerQuery !== ""}
				<ul class="suggestions">
					{#each suggestions as user (user.id)}
						<li>
							<Avatar user={user} size={20} />
							<span>{user.displayName}</span>
							<span class="username">{user.username}</span>
							<span class="add-button">
								<Button
									appearance="subtle"
									onclick={() => addMember(user.id)}
									isLoading={addingId === user.id}
									isDisabled={addingId !== null}
								>
									Add
								</Button>
							</span>
						</li>
					{:else}
						<li class="suggestion-empty">
							{candidatesPending
								? "Searching…"
								: candidates.length > 0
									? "Everyone matching this search is already a member."
									: "No matching user to add."}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section>
			<div class="members-header">
				<h2>Members</h2>
				<input
					aria-label="Search members"
					placeholder="Search members"
					bind:value={memberSearch}
					style="{inputStyle} width: 240px; margin-left: auto;"
				/>
			</div>
			<table class="fat-table members-table">
				<thead>
					<tr>
						<th>Name</th>
						<th class="username-column">Username</th>
						<th class="email-column">Email</th>
						<th class="active-column">Active</th>
						<th class="source-column">Source</th>
						<th class="actions-column"></th>
					</tr>
				</thead>
				<tbody>
					{#each members as member (member.id)}
						<tr>
							<td>
								<span class="member-name">
									<Avatar user={member} size={24} />
									<a
										href={`/secure/admin/user/ViewUser.jspa?name=${encodeURIComponent(member.username)}`}
									>
										{member.displayName}
									</a>
								</span>
							</td>
							<td class="muted">{member.username}</td>
							<td>{member.email ?? "—"}</td>
							<td>{member.active ? "Yes" : "No"}</td>
							<td>{member.sources.map(sourceLabel).join(", ")}</td>
							<td>
								{#if member.sources.includes("local")}
									<Button
										appearance="subtle"
										onclick={() => (removingMember = member)}
										isLoading={removingId === member.id}
										isDisabled={removingId !== null}
									>
										Remove
									</Button>
								{/if}
							</td>
						</tr>
					{:else}
						<EmptyRow columns={6}>
							{group.members.length === 0
								? "This group has no members yet."
								: "No members match this search."}
						</EmptyRow>
					{/each}
				</tbody>
			</table>
		</section>

		{#if removingMember}
			{@const member = removingMember}
			<ConfirmDialog
				title="Remove group member"
				confirmLabel="Remove"
				message={`Remove ${member.displayName} from ${group.name}? They lose the access this group gives them.`}
				pending={removingId === member.id}
				onClose={() => (removingMember = null)}
				onConfirm={() => removeMember(member.id)}
			/>
		{/if}
		{#if deleting}
			<ConfirmDialog
				title="Delete group"
				message={`Delete the group ${group.name}? Its ${group.members.length} memberships are removed with it.`}
				confirmLabel="Delete"
				pending={deletePending}
				onConfirm={deleteGroup}
				onClose={() => (deleting = false)}
			/>
		{/if}
	</AdminPage>
{/if}

<style>
	.group-description {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.add-members {
		margin-bottom: 24px;
	}

	h2 {
		margin: 0 0 8px;
		font-size: 16px;
		font-weight: 600;
	}

	.suggestions {
		list-style: none;
		margin: 8px 0 0;
		padding: 0;
		max-width: 480px;
		border: 1px solid var(--ds-border);
		border-radius: 3px;
	}

	.suggestions li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		border-bottom: 1px solid var(--ds-border);
	}

	.suggestions li:last-child {
		border-bottom: 0;
	}

	.suggestion-empty {
		padding: 8px;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.username {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.add-button {
		margin-left: auto;
	}

	.members-header {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 8px;
	}

	.members-header h2 {
		margin: 0;
	}

	.members-table {
		width: 100%;
	}

	.username-column {
		width: 160px;
	}

	.email-column {
		width: 220px;
	}

	.active-column {
		width: 80px;
	}

	.source-column {
		width: 160px;
	}

	.actions-column {
		width: 100px;
	}

	.member-name {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.muted {
		color: var(--ds-text-subtle);
	}
</style>
