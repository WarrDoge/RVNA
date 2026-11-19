<script lang="ts">
	import { untrack } from "svelte";
	import { invalidate } from "$app/navigation";
	import { api } from "#lib/api.ts";
	import { hydratingPage } from "#lib/hydration.ts";
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import { absoluteDate, relativeDate } from "#lib/dates.ts";
	import type { PageData } from "./$types";
	
	let { data }: { data: PageData } = $props();
	
	type Settings = PageData["settings"];
	
	let homeserverUrl = $state(untrack(() => data.settings.homeserverUrl));
	const loadedDeskId = untrack(() => data.settings.serviceDeskId ?? "");
	let serviceDeskId = $state<string | undefined>(
		hydratingPage() ? undefined : loadedDeskId,
	);
	let requestTypeId = $state<string | undefined>(
		hydratingPage()
			? undefined
			: untrack(() => data.settings.requestTypeId ?? ""),
	);
	const currentDeskId = $derived(serviceDeskId ?? loadedDeskId);
	let enabled = $state(untrack(() => data.settings.enabled));
	let token = $state("");
	let saved = $state(false);
	let error = $state<string | null>(null);
	let busy = $state(false);
	let tokenError = $state<string | null>(null);
	let tokenBusy = $state(false);
	let testError = $state<string | null>(null);
	let testing = $state(false);
	let identity = $state<string | null>(null);
	
	const desk = $derived(
		data.options.desks.find((row) => row.id === currentDeskId) ?? null,
	);
	const requestTypes = $derived(desk?.requestTypes ?? []);
	
	async function save() {
		busy = true;
		error = null;
		saved = false;
		try {
			await api<Settings>("/api/admin/messenger", {
				method: "PUT",
				body: JSON.stringify({
					homeserverUrl: homeserverUrl.trim(),
					serviceDeskId: currentDeskId === "" ? null : currentDeskId,
					requestTypeId: requestTypeId || null,
					enabled,
				}),
			});
			await invalidate("app:messenger-settings");
			saved = true;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Something went wrong";
		} finally {
			busy = false;
		}
	}
	
	async function saveToken() {
		tokenBusy = true;
		tokenError = null;
		try {
			await api<Settings>("/api/admin/messenger/token", {
				method: "PUT",
				body: JSON.stringify({ token }),
			});
			token = "";
			await invalidate("app:messenger-settings");
		} catch (cause) {
			tokenError = cause instanceof Error ? cause.message : "Something went wrong";
		} finally {
			tokenBusy = false;
		}
	}
	
	async function removeToken() {
		tokenBusy = true;
		tokenError = null;
		try {
			await api<Settings>("/api/admin/messenger/token", { method: "DELETE" });
			await invalidate("app:messenger-settings");
		} catch (cause) {
			tokenError = cause instanceof Error ? cause.message : "Something went wrong";
		} finally {
			tokenBusy = false;
		}
	}
	
	async function testConnection() {
		testing = true;
		testError = null;
		identity = null;
		try {
			const result = await api<{ userId: string; serverName: string }>(
				"/api/admin/messenger/test",
				{ method: "POST" },
			);
			identity = result.userId;
			await invalidate("app:messenger-settings");
		} catch (cause) {
			testError = cause instanceof Error ? cause.message : "Something went wrong";
		} finally {
			testing = false;
		}
	}
	</script>
	
	<AdminPage title="Messenger">
		<p class="messenger-description">
			Connect one Matrix bot to RVNA. People invite it to a room or start
			an unencrypted direct chat, then send commands. Requests are opened in the
			chosen service desk.
		</p>
	
		<section class="messenger-section">
			<h2>Matrix connection</h2>
			<p class="hint">
				The homeserver URL, for example https://matrix.example.com.
			</p>
			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}
			<form
				onsubmit={(event) => {
					event.preventDefault();
					void save();
				}}
			>
				<label class="label" for="messenger-homeserver">Homeserver URL</label>
				<div class="row">
					<input
						id="messenger-homeserver"
						bind:value={() => homeserverUrl, (value) => {
							homeserverUrl = value;
							saved = false;
						}}
						placeholder="https://matrix.example.com"
						style={inputStyle}
					/>
				</div>
	
				<div class="field status-field">
					<span class="label">Bot access token</span>
					<span class="status">
						{data.settings.hasAccessToken ? "Set" : "Not set"}
					</span>
				</div>
				{#if tokenError}
					<p class="error" role="alert">{tokenError}</p>
				{/if}
				<div class="row">
					<input
						aria-label="Bot access token"
						type="password"
						bind:value={token}
						placeholder="syt_…"
						style={inputStyle}
					/>
					<Button
						type="button"
						appearance="primary"
						isLoading={tokenBusy}
						isDisabled={token.trim() === "" || !data.settings.secretsKeyConfigured}
						onclick={() => void saveToken()}
					>
						Save token
					</Button>
					{#if data.settings.hasAccessToken}
						<Button
							type="button"
							appearance="subtle"
							isLoading={tokenBusy}
							onclick={() => void removeToken()}
						>
							Remove
						</Button>
					{/if}
				</div>
				{#if !data.settings.secretsKeyConfigured}
					<p class="hint secret-hint">
						Set SECRETS_KEY on the server before saving a token.
					</p>
				{/if}
	
				<div class="row actions">
					<Button
						type="button"
						isLoading={testing}
						isDisabled={!data.settings.hasAccessToken || homeserverUrl.trim() === ""}
						onclick={() => void testConnection()}
					>
						Test connection
					</Button>
					{#if identity}
						<span class="status">Connected as {identity}</span>
					{/if}
				</div>
				{#if testError}
					<p class="error" role="alert">{testError}</p>
				{/if}
			</form>
		</section>
	
		<section class="messenger-section">
			<h2>Requests from chat</h2>
			<p class="hint">
				Chat requests use this service desk and request type. The request type's
				required fields must have defaults; otherwise the bot answers with the
				portal link.
			</p>
			<div class="field">
				<label class="label" for="messenger-desk">Service desk</label>
				<select
					id="messenger-desk"
					bind:value={() => serviceDeskId, (value) => {
						if (value !== currentDeskId) requestTypeId = "";
						serviceDeskId = value;
						saved = false;
					}}
					style={inputStyle}
				>
					<option value="">Choose a desk</option>
					{#each data.options.desks as desk (desk.id)}
						<option value={desk.id}>{desk.projectKey} — {desk.name}</option>
					{/each}
				</select>
			</div>
			<div class="field">
				<label class="label" for="messenger-request-type">Request type</label>
				<select
					id="messenger-request-type"
					bind:value={() => requestTypeId, (value) => {
						requestTypeId = value;
						saved = false;
					}}
					style={inputStyle}
				>
					<option value="">Choose a request type</option>
					{#each requestTypes as type (type.id)}
						<option value={type.id}>{type.name}</option>
					{/each}
				</select>
			</div>
			<label class="checkbox">
				<input type="checkbox" bind:checked={enabled} />
				Enabled
			</label>
			<div class="row actions">
				<Button type="button" appearance="primary" isLoading={busy} onclick={() => void save()}>
					Save
				</Button>
				{#if saved}
					<span class="status">Saved</span>
				{/if}
			</div>
		</section>
	
		<section class="messenger-section">
			<h2>Worker</h2>
			<div class="field">
				<span class="label">State</span>
				<span class="status">
					{data.settings.workerRunning ? "Running" : "Stopped"}
				</span>
			</div>
			<div class="field">
				<span class="label">Last successful sync</span>
				<span class="status">
					{#if data.settings.lastSyncAt}
						<span title={absoluteDate(data.settings.lastSyncAt)}>
							{relativeDate(data.settings.lastSyncAt)}
						</span>
					{:else}
						Never
					{/if}
				</span>
			</div>
			<div class="field">
				<span class="label">Last error</span>
				<span class="status">{data.settings.lastError ?? "None"}</span>
			</div>
			{#if data.settings.botMatrixId}
				<p class="bot-id">
					Invite {data.settings.botMatrixId} to a room or start a direct chat,
					then send <code>!ticket</code> and a summary.
				</p>
			{:else}
				<p class="hint">
					Test the connection to read the bot's Matrix id.
				</p>
			{/if}
		</section>
	</AdminPage>
	
	<style>
		.messenger-description {
			margin: 0 0 12px;
			max-width: 720px;
			color: var(--ds-text-subtle);
			font-size: 12px;
			line-height: 18px;
		}
	
		.messenger-section {
			margin-bottom: 32px;
			max-width: 720px;
		}
	
		h2 {
			margin: 0 0 4px;
			font-size: 16px;
			font-weight: 600;
			line-height: 20px;
			color: var(--ds-text);
		}
	
		.hint {
			margin: 0 0 12px;
			color: var(--ds-text-subtle);
			font-size: 12px;
			line-height: 18px;
		}
	
		.label {
			display: block;
			margin-bottom: 4px;
			color: var(--ds-text-subtle);
			font-size: 12px;
			font-weight: 600;
		}
	
		.field {
			margin-bottom: 12px;
		}
	
		.row {
			display: flex;
			align-items: center;
			gap: 8px;
			margin-bottom: 12px;
		}
	
		.actions {
			margin-top: 12px;
		}
	
		.status {
			color: var(--ds-text-subtle);
			font-size: 12px;
		}
	
		.error {
			margin: 0 0 8px;
			color: #e5493a;
		}
	
		.checkbox {
			display: flex;
			align-items: center;
			gap: 8px;
			color: var(--ds-text);
			font-size: 13px;
		}
	
		.bot-id {
			color: var(--ds-text);
			font-size: 13px;
			line-height: 20px;
		}
	</style>
