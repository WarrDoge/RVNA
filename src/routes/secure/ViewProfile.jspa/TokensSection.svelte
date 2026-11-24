<script lang="ts">
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import type { ApiToken, CreatedApiToken } from "#lib/api-types.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import Textfield from "#lib/components/Textfield.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import { calendarDate } from "#lib/dates.ts";

	type FormData = {
		error?: string;
		intent?: string;
		created?: CreatedApiToken;
		revoked?: string;
	} | null;

	interface Props {
		tokens: ApiToken[];
		create?: boolean;
		hasPassword?: boolean;
		form?: FormData;
	}

	let { tokens, create = false, hasPassword = false, form }: Props = $props();

	let creating = $derived(create);
	let created = $state<CreatedApiToken | null>(null);
	let name = $state("");
	let expiresInDays = $state("90");
	let currentPassword = $state("");
	let createError = $state<string | null>(null);
	let createBusy = $state(false);
	let copied = $state(false);
	let copyError = $state<string | null>(null);
	let code = $state<HTMLElement>();
	let revoking = $state<ApiToken | null>(null);
	let revokeError = $state<string | null>(null);
	let revokeBusy = $state(false);
	let serverCreated = $derived(
		form && "intent" in form && form.intent === "createToken" && "created" in form
			? form.created
			: null,
	);
	let shownCreated = $derived(created ?? serverCreated ?? null);
	let serverCreateError = $derived(
		form && "intent" in form && form.intent === "createToken" && "error" in form
			? form.error
			: null,
	);
	let shownCreateError = $derived(createError ?? serverCreateError);
	let serverRevokeError = $derived(
		form && "intent" in form && form.intent === "revokeToken" && "error" in form
			? form.error
			: null,
	);
	let shownRevokeError = $derived(revokeError ?? serverRevokeError);

	function closeCreate() {
		creating = false;
		created = null;
		copied = false;
		createError = null;
		copyError = null;
		if (create) {
			void goto("/secure/ViewProfile.jspa?selectedTab=tokens", {
				replace: true,
				reset: false,
			});
		}
	}

	function selectToken() {
		if (!code) return false;
		const selection = window.getSelection();
		if (!selection) return false;
		const range = document.createRange();
		range.selectNodeContents(code);
		selection.removeAllRanges();
		selection.addRange(range);
		try {
			return document.execCommand("copy");
		} finally {
			selection.removeAllRanges();
		}
	}

	async function copyToken() {
		const token = shownCreated?.token;
		if (!token) return;
		copyError = null;
		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(token);
			} else if (!selectToken()) {
				throw new Error("Copy is not available");
			}
			copied = true;
		} catch {
			copyError = "Could not copy the token. Select it and copy manually.";
		}
	}
</script>

	{#snippet createFooter()}
		{#if shownCreated}
			<Button appearance="primary" onclick={closeCreate}>Done</Button>
		{:else}
			<Button
				appearance="primary"
				type="submit"
				form="token-create-form"
				isLoading={createBusy}
			>
				Create
			</Button>
			<Button
				appearance="subtle"
				href="/secure/ViewProfile.jspa?selectedTab=tokens"
			>
				Cancel
			</Button>
		{/if}
	{/snippet}

	{#snippet revokeFooter()}
		<form
			class="footer-form"
			method="POST"
			use:enhance={() => {
				revokeBusy = true;
				revokeError = null;
				return async ({ result, update }) => {
					revokeBusy = false;
					if (result.type === "failure") {
						const failure = result.data as { error?: unknown } | null;
						revokeError =
							typeof failure?.error === "string"
								? failure.error
								: "Could not revoke the token";
						return;
					}
					if (result.type === "error") {
						revokeError = "Could not revoke the token";
						return;
					}
					revoking = null;
					await update();
				};
			}}
		>
			<input type="hidden" name="intent" value="revokeToken" />
			<input type="hidden" name="id" value={revoking?.id ?? ""} />
			<Button
				type="submit"
				appearance="danger"
				isLoading={revokeBusy}
			>
				Revoke
			</Button>
			<Button appearance="subtle" onclick={() => (revoking = null)}>
				Cancel
			</Button>
		</form>
	{/snippet}

<section>
	<div class="header">
		<h2>Personal access tokens</h2>
		<form method="GET" action="/secure/ViewProfile.jspa" class="create-form">
			<input type="hidden" name="selectedTab" value="tokens" />
			<input type="hidden" name="create" value="1" />
			<Button type="submit" appearance="primary">Create token</Button>
		</form>
	</div>

	<p class="intro">
		Tokens authenticate scripts against the RVNA API. Each token is shown
		once, when you create it. A token keeps working after you sign out; revoke
		it here to end its access.
	</p>

	<table>
		<thead>
			<tr>
				{#each ["Name", "Created", "Last used", "Expires", ""] as heading}
					<th>{heading}</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#if tokens.length > 0}
				{#each tokens as token (token.id)}
					<tr>
						<td>{token.name}</td>
						<td>{calendarDate(token.createdAt)}</td>
						<td>{token.lastUsedAt ? calendarDate(token.lastUsedAt) : "Never"}</td>
						<td>{token.expiresAt ? calendarDate(token.expiresAt) : "Never"}</td>
						<td class="actions">
							<Button
								appearance="danger"
								spacing="compact"
								onclick={() => {
									revokeError = null;
									revoking = token;
								}}
							>
								Revoke
							</Button>
						</td>
					</tr>
				{/each}
			{:else}
				<tr>
					<td colspan={5} class="empty">No personal access tokens yet.</td>
				</tr>
			{/if}
		</tbody>
	</table>

	{#if creating}
		<Modal
			title={shownCreated ? "Your new token" : "Create token"}
			onClose={closeCreate}
			footer={createFooter}
		>
			{#if shownCreated}
				<p class="first">Copy this token now. It will not be shown again.</p>
				<div class="token-row">
					<code bind:this={code}>{shownCreated.token}</code>
					<Button onclick={() => void copyToken()}>
						{copied ? "Copied" : "Copy"}
					</Button>
				</div>
				{#if copyError}
					<p role="alert" class="error">{copyError}</p>
				{/if}
			{:else}
				<form
					id="token-create-form"
					method="POST"
					use:enhance={() => {
						createBusy = true;
						createError = null;
						return async ({ result, update }) => {
							createBusy = false;
							currentPassword = "";
							if (result.type === "failure") {
								const failure = result.data as { error?: unknown } | null;
								createError =
									typeof failure?.error === "string"
										? failure.error
										: "Could not create the token";
								return;
							}
							if (result.type === "error") {
								createError = "Could not create the token";
								return;
							}
							if (result.type === "success") {
								const data = result.data as
									| { created?: CreatedApiToken }
									| undefined;
								if (data?.created) created = data.created;
							}
							await update({ reset: false });
						};
					}}
				>
					<input type="hidden" name="intent" value="createToken" />
					<div class="field">
						<label for="token-name">Name</label>
						<Textfield
							id="token-name"
							name="name"
							bind:value={name}
							placeholder="e.g. CI pipeline"
							autoFocus
						/>
					</div>
					<div class="field">
						<label for="token-expiry">Expires</label>
						<select
							id="token-expiry"
							name="expiresInDays"
							bind:value={expiresInDays}
							style={inputStyle}
						>
							<option value="30">In 30 days</option>
							<option value="90">In 90 days</option>
							<option value="365">In 365 days</option>
							<option value="never">Never</option>
						</select>
					</div>
					{#if hasPassword}
						<div class="field">
							<label for="token-password">Current password</label>
							<Textfield
								id="token-password"
								name="currentPassword"
								type="password"
								autocomplete="current-password"
								bind:value={currentPassword}
							/>
						</div>
					{/if}
					{#if shownCreateError}
						<p role="alert" class="error">{shownCreateError}</p>
					{/if}
				</form>
			{/if}
		</Modal>
	{/if}

	{#if revoking}
		<Modal
			title="Revoke token"
			onClose={() => (revoking = null)}
			footer={revokeFooter}
		>
			<p class="first">
				Revoke “{revoking.name}”? Anything using it will lose access.
			</p>
			{#if shownRevokeError}
				<p role="alert" class="error">{shownRevokeError}</p>
			{/if}
		</Modal>
	{/if}
</section>

<style>
	form {
		margin: 0;
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 16px;
	}

	.create-form {
		display: contents;
	}

	h2 {
		margin: 0;
		font-size: 20px;
		font-weight: 500;
	}

	.intro {
		margin: 0 0 16px;
		color: var(--ds-text-subtle);
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	th {
		padding: 8px 12px;
		text-align: left;
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle);
		border-bottom: 1px solid var(--ds-border);
	}

	td {
		padding: 10px 12px;
		border-bottom: 1px solid var(--ds-border);
		color: var(--ds-text);
	}

	td.actions {
		text-align: right;
	}

	td.empty {
		color: var(--ds-text-subtle);
	}

	.field {
		margin-bottom: 16px;
	}

	label {
		display: block;
		margin-bottom: 4px;
		color: var(--ds-text-subtle);
	}

	.error {
		color: var(--ds-text-danger);
	}

	.first {
		margin-top: 0;
	}

	.token-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	code {
		flex: 1;
		padding: 8px 10px;
		background-color: var(--ds-background-input);
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		word-break: break-all;
	}

	.footer-form {
		display: contents;
	}
</style>
