<script lang="ts">
	import { invalidate } from "$app/navigation";
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import Banner from "#lib/admin/Banner.svelte";
	import {
		errorMessage,
		loginMethods,
		originLabel,
	} from "#lib/admin/users.ts";
	import { api } from "#lib/api.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import Button from "#lib/components/Button.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import { absoluteDate, relativeDate } from "#lib/dates.ts";
	import EditDetailsDialog from "./EditDetailsDialog.svelte";
	import SetPasswordDialog from "./SetPasswordDialog.svelte";
	import UserDetailRow from "./UserDetailRow.svelte";
	import UserProjectRoles from "./UserProjectRoles.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let user = $derived(data.state === "found" ? data.user : null);
	let actionError = $state<string | null>(null);
	let passwordOpen = $state(false);
	let editOpen = $state(false);
	let removePasswordOpen = $state(false);
	let removePasswordPending = $state(false);
	let confirmState = $state<"deactivate" | "reactivate" | null>(null);
	let activePending = $state(false);
	let revoking = $state<{ id: string; name: string } | null>(null);
	let revokePending = $state(false);
	let adminOverride = $state<{
		userId: string;
		base: boolean;
		value: boolean;
	} | null>(null);
	let adminPending = $state(false);

	let adminChecked = $derived(
		user &&
			adminOverride?.userId === user.id &&
			adminOverride.base === user.adminLocal
			? adminOverride.value
			: (user?.adminLocal ?? false),
	);

	async function toggleAdmin(value: boolean) {
		const current = user;
		if (!current) return;
		adminOverride = { userId: current.id, base: current.adminLocal, value };
		adminPending = true;
		try {
			await api(`/api/admin/users/${current.id}`, {
				method: "PATCH",
				body: JSON.stringify({ isAdmin: value }),
			});
			actionError = null;
			await invalidate("app:admin-user");
		} catch (cause) {
			adminOverride = null;
			actionError = errorMessage(cause);
		} finally {
			adminPending = false;
		}
	}

	async function setActive(action: "deactivate" | "reactivate") {
		const current = user;
		if (!current) return;
		activePending = true;
		try {
			await api(`/api/admin/users/${current.id}/${action}`, {
				method: "POST",
			});
			actionError = null;
			confirmState = null;
			await invalidate("app:admin-user");
		} catch (cause) {
			actionError = errorMessage(cause);
			confirmState = null;
		} finally {
			activePending = false;
		}
	}

	async function removePassword() {
		const current = user;
		if (!current || removePasswordPending) return;
		removePasswordPending = true;
		try {
			await api(`/api/admin/users/${current.id}/password`, {
				method: "DELETE",
			});
			actionError = null;
			removePasswordOpen = false;
			await invalidate("app:admin-user");
		} catch (cause) {
			actionError = errorMessage(cause);
			removePasswordOpen = false;
		} finally {
			removePasswordPending = false;
		}
	}

	async function revokeToken() {
		const current = user;
		const token = revoking;
		if (!current || !token) return;
		revokePending = true;
		try {
			await api(`/api/admin/users/${current.id}/tokens/${token.id}`, {
				method: "DELETE",
			});
			actionError = null;
			revoking = null;
			await invalidate("app:admin-user");
		} catch (cause) {
			actionError = errorMessage(cause);
			revoking = null;
		} finally {
			revokePending = false;
		}
	}
</script>

{#snippet breadcrumb()}
	<a href="/secure/admin/user/UserBrowser.jspa">Users</a>
{/snippet}

{#snippet actions()}
	{#if user}
		<Button appearance="subtle" onclick={() => (editOpen = true)}>
			Edit details
		</Button>
		<Button appearance="primary" onclick={() => (passwordOpen = true)}>
			{user.hasPassword ? "Reset password" : "Set password"}
		</Button>
		<Button
			appearance="subtle"
			isDisabled={!user.hasPassword || !user.hasSso}
			title={!user.hasPassword
				? "This user has no local password"
				: !user.hasSso
					? "The user has no SSO identity and would not be able to log in"
					: undefined}
			onclick={() => (removePasswordOpen = true)}
		>
			Remove password
		</Button>
		{#if user.active}
			<Button appearance="subtle" onclick={() => (confirmState = "deactivate")}>
				Deactivate
			</Button>
		{:else}
			<Button appearance="primary" onclick={() => (confirmState = "reactivate")}>
				Reactivate
			</Button>
		{/if}
	{/if}
{/snippet}

{#snippet removePasswordFooter()}
	<Button
		appearance="danger"
		isLoading={removePasswordPending}
		isDisabled={removePasswordPending}
		onclick={removePassword}>Remove password</Button
	>
	<Button appearance="subtle" onclick={() => (removePasswordOpen = false)}>
		Cancel
	</Button>
{/snippet}

{#if data.state === "missing"}
	<AdminPage title="User" {breadcrumb}>
		<Banner tone="warning">No username was given in the address.</Banner>
	</AdminPage>
{:else if data.state === "notFound"}
	<AdminPage title="User not found" {breadcrumb}>
		<p>
			No user has the username <strong>{data.username}</strong>.
		</p>
	</AdminPage>
{:else if user}
	<AdminPage title={user.displayName} {breadcrumb} {actions}>
		{#if actionError}
			<Banner tone="danger">{actionError}</Banner>
		{/if}
		{#if !user.active}
			<Banner tone="warning">
				This account is deactivated. It cannot sign in until it is reactivated.
			</Banner>
		{/if}

		<section class="section">
			<div class="identity">
				<Avatar user={user} size={40} />
				<div>
					<div class="username">{user.username}</div>
					<div class="subtle small">{user.email ?? "no email address"}</div>
				</div>
			</div>
			<table class="details">
				<tbody>
					<UserDetailRow label="Full name">{user.displayName}</UserDetailRow>
					<UserDetailRow label="Email">{user.email ?? "—"}</UserDetailRow>
					<UserDetailRow label="Groups">
						{#if user.groups.length === 0}
							<span class="subtle">No groups</span>
						{:else}
							{#each user.groups as group (group.id)}
								<a
									href={`/secure/admin/user/ViewGroup.jspa?name=${encodeURIComponent(group.name)}`}
									class="group-link"
								>
									<Lozenge appearance={group.local ? "moved" : "default"}>
										{group.name}
									</Lozenge>
								</a>
							{/each}
						{/if}
					</UserDetailRow>
					<UserDetailRow label="Login methods">{loginMethods(user)}</UserDetailRow>
					<UserDetailRow label="Origin">{originLabel(user)}</UserDetailRow>
					<UserDetailRow label="Active">{user.active ? "Yes" : "No"}</UserDetailRow>
					<UserDetailRow label="Administrator">
						<label class="admin-toggle">
							<input
								type="checkbox"
								bind:checked={() => adminChecked, (value) => toggleAdmin(value)}
								disabled={adminPending}
							/>
							Can administer RVNA
						</label>
						{#if user.isAdmin && !user.adminLocal}
							<div class="subtle small note">
								Administrator through membership of the SSO administrator group.
							</div>
						{/if}
					</UserDetailRow>
					<UserDetailRow label="Created">{absoluteDate(user.createdAt)}</UserDetailRow>
					<UserDetailRow label="Last login">
						{#if user.lastLoginAt}
							<span title={absoluteDate(user.lastLoginAt)}>
								{relativeDate(user.lastLoginAt)}
							</span>
						{:else}
							<span class="subtle">Never</span>
						{/if}
					</UserDetailRow>
					<UserDetailRow label="Sessions">{user.sessionCount}</UserDetailRow>
				</tbody>
			</table>
			{#if !user.hasSso}
				<p class="subtle small note">
					The password cannot be removed: the user has no SSO identity and would
					not be able to log in.
				</p>
			{/if}
			{#if !user.hasPassword}
				<p class="subtle small note">This account has no local password.</p>
			{/if}
		</section>

		<UserProjectRoles userId={user.id} roles={data.projectRoles} />

		<section class="section">
			<h2>API tokens</h2>
			<table class="fat-table table">
				<thead>
					<tr>
						<th>Name</th>
						<th class="date-column">Created</th>
						<th class="date-column">Last used</th>
						<th class="date-column">Expires</th>
						<th class="action-column"></th>
					</tr>
				</thead>
				<tbody>
					{#each user.tokens as token (token.id)}
						<tr>
							<td>{token.name}</td>
							<td>{absoluteDate(token.createdAt)}</td>
							<td>{token.lastUsedAt ? absoluteDate(token.lastUsedAt) : "Never"}</td>
							<td>{token.expiresAt ? absoluteDate(token.expiresAt) : "Never"}</td>
							<td>
								<Button
									appearance="subtle"
									onclick={() => (revoking = token)}
								>
									Revoke
								</Button>
							</td>
						</tr>
					{/each}
					{#if user.tokens.length === 0}
						<tr>
							<td colspan={5} class="empty">This user has no API tokens.</td>
						</tr>
					{/if}
				</tbody>
			</table>
		</section>

		{#if passwordOpen}
			<SetPasswordDialog {user} onClose={() => (passwordOpen = false)} />
		{/if}
		{#if editOpen}
			<EditDetailsDialog {user} onClose={() => (editOpen = false)} />
		{/if}
		{#if removePasswordOpen}
			<Modal
				title="Remove password"
				onClose={() => (removePasswordOpen = false)}
				footer={removePasswordFooter}
			>
				<p class="first">
					{user.displayName} will only be able to sign in with SSO. Their sessions
					are signed out.
				</p>
			</Modal>
		{/if}
		{#if confirmState}
			<ConfirmDialog
				title={confirmState === "deactivate"
					? "Deactivate user"
					: "Reactivate user"}
				message={confirmState === "deactivate"
					? `Deactivate ${user.displayName}? Their sessions and API tokens are deleted, and they cannot sign in until the account is reactivated.`
					: `Reactivate ${user.displayName}? They will be able to sign in again.`}
				confirmLabel={confirmState === "deactivate" ? "Deactivate" : "Reactivate"}
				pending={activePending}
				onConfirm={() => setActive(confirmState as "deactivate" | "reactivate")}
				onClose={() => (confirmState = null)}
			/>
		{/if}
		{#if revoking}
			<ConfirmDialog
				title="Revoke API token"
				message={`Revoke the token "${revoking.name}"? Scripts that use it stop working immediately.`}
				confirmLabel="Revoke"
				pending={revokePending}
				onConfirm={revokeToken}
				onClose={() => (revoking = null)}
			/>
		{/if}
	</AdminPage>
{/if}

<style>
	.section {
		margin-bottom: 32px;
	}

	.identity {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 12px;
	}

	.username {
		font-size: 20px;
		font-weight: 500;
	}

	.small {
		font-size: 12px;
	}

	.subtle {
		color: var(--ds-text-subtle);
	}

	.details {
		border-collapse: collapse;
		width: 100%;
		max-width: 720px;
	}

	.group-link {
		margin-right: 8px;
		white-space: nowrap;
	}

	.admin-toggle {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.note {
		margin-top: 8px;
	}

	.first {
		margin-top: 0;
	}

	h2 {
		margin: 0 0 12px;
		font-size: 20px;
		font-weight: 500;
		line-height: 24px;
	}

	.table {
		width: 100%;
	}

	.date-column {
		width: 140px;
	}

	.action-column {
		width: 90px;
	}

	.empty {
		padding: 24px;
		text-align: center;
		color: var(--ds-text-subtle);
	}
</style>
