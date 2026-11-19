<script lang="ts">
	import { untrack } from "svelte";
	import { enhance } from "$app/forms";
	import { invalidate } from "$app/navigation";
	import { api } from "#lib/api.ts";
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import Banner from "#lib/admin/Banner.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import { absoluteDate, relativeDate } from "#lib/dates.ts";
	import CopyButton from "./CopyButton.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	type Settings = PageData["settings"];

	let baseUrl = $state(untrack(() => data.settings.baseUrl));
	let baseError = $state<string | null>(null);
	let baseBusy = $state(false);
	let saved = $state(false);

	let secret = $state<string | null>(null);
	let secretError = $state<string | null>(null);
	let generating = $state(false);
	let confirmingSecret = $state(false);

	let token = $state("");
	let tokenError = $state<string | null>(null);
	let tokenBusy = $state(false);
	let removeError = $state<string | null>(null);
	let removeBusy = $state(false);
	let confirmingRemove = $state(false);
	let removeConfirmed = false;
	let removeForm: HTMLFormElement | null = $state(null);

	let version = $state<string | null>(null);
	let testError = $state<string | null>(null);
	let testing = $state(false);

	const id = $props.id();
	const baseFormId = `${id}-base`;
	const tokenFormId = `${id}-token`;

	function failureMessage(result: { data?: unknown }) {
		const resultData = result.data as { error?: unknown } | null;
		return typeof resultData?.error === "string"
			? resultData.error
			: "Something went wrong";
	}

	async function generateSecret() {
		generating = true;
		secretError = null;
		try {
			const result = await api<Settings & { secret: string }>(
				"/api/admin/gitlab/secret",
				{ method: "POST" },
			);
			secret = result.secret;
			await invalidate("app:gitlab-settings");
		} catch (cause) {
			secretError =
				cause instanceof Error ? cause.message : "Something went wrong";
		} finally {
			generating = false;
		}
	}

	async function testConnection() {
		testing = true;
		testError = null;
		try {
			const result = await api<{ version: string }>("/api/admin/gitlab/test", {
				method: "POST",
			});
			version = result.version;
		} catch (cause) {
			version = null;
			testError =
				cause instanceof Error ? cause.message : "Something went wrong";
		} finally {
			testing = false;
		}
	}
</script>

<AdminPage title="GitLab integration">
	<p class="gitlab-description">
		Show branches, commits, merge requests and pipelines on issues, and
		optionally turn GitLab activity into smart commits and transitions.
	</p>
	<section class="gitlab-section">
		<h2>GitLab connection</h2>
		<p class="hint">
			The base URL of the self-hosted GitLab, for example
			https://gitlab.example.com.
		</p>
		{#if baseError}
			<p class="error" role="alert">{baseError}</p>
		{/if}
		<form
			id={baseFormId}
			method="POST"
			use:enhance={({ cancel }) => {
				baseError = null;
				if (baseUrl.trim() === "") {
					cancel();
					return;
				}
				baseBusy = true;
				return async ({ result, update }) => {
					baseBusy = false;
					if (result.type === "failure") {
						baseError = failureMessage(result);
						return;
					}
					if (result.type === "error") {
						baseError = "Something went wrong";
						return;
					}
					await update({ reset: false });
					saved = true;
				};
			}}
		>
			<input type="hidden" name="intent" value="saveBaseUrl" />
			<div class="row">
				<div class="grow">
					<label class="label" for="gitlab-base-url">Base URL</label>
					<input
						id="gitlab-base-url"
						name="baseUrl"
						bind:value={() => baseUrl, (value) => {
							baseUrl = value;
							saved = false;
						}}
						placeholder="https://gitlab.example.com"
						style={inputStyle}
					/>
				</div>
				<Button
					type="submit"
					appearance="primary"
					isLoading={baseBusy}
					isDisabled={baseUrl.trim() === ""}
				>
					Save
				</Button>
			</div>
		</form>
		{#if saved}
			<span class="status">Saved</span>
		{/if}
	</section>

	<section class="gitlab-section">
		<h2>Webhook</h2>
		<p class="hint">
			Add this URL as a webhook in GitLab. Enable push events, tag push events,
			merge request events, pipeline events and comments, and keep SSL
			verification on.
		</p>
		<div class="field">
			<span class="label">URL</span>
			<div class="inline">
				<input
					readonly
					aria-label="Webhook URL"
					value={data.settings.webhookUrl}
					style={inputStyle}
				/>
				<CopyButton value={data.settings.webhookUrl} />
			</div>
		</div>

		<div class="field">
			<span class="label">Secret token</span>
			<div class="secret-row">
				<span class="status">
					{data.settings.hasWebhookSecret ? "Configured" : "Not configured"}
				</span>
				<Button
					spacing="compact"
					onclick={() => {
						if (data.settings.hasWebhookSecret) confirmingSecret = true;
						else void generateSecret();
					}}
					isLoading={generating}
					isDisabled={!data.settings.secretsKeyConfigured}
				>
					{data.settings.hasWebhookSecret ? "Replace secret" : "Generate secret"}
				</Button>
			</div>
			{#if !data.settings.secretsKeyConfigured}
				<p class="hint secret-hint">
					Set SECRETS_KEY on the server before saving a secret.
				</p>
			{/if}
			{#if secretError}
				<p class="error" role="alert">{secretError}</p>
			{/if}
		</div>

		<div>
			<span class="label">Last delivery</span>
			<span class="status">
				{#if data.settings.lastDeliveryAt}
					<span title={absoluteDate(data.settings.lastDeliveryAt)}>
						{relativeDate(data.settings.lastDeliveryAt)}
					</span>
					{data.settings.lastDeliveryStatus
						? ` — ${data.settings.lastDeliveryStatus}`
						: ""}
				{:else}
					No deliveries yet
				{/if}
			</span>
		</div>
	</section>

	<section class="gitlab-section">
		<h2>Access token</h2>
		<p class="hint">
			A personal or project access token with read_api scope. It is used for
			back-fill and link unfurling, stored encrypted and never returned.
		</p>
		<div class="field status-field">
			<span class="label">Status</span>
			<span class="status">
				{data.settings.hasAccessToken ? "Configured" : "Not configured"}
			</span>
		</div>
		{#if tokenError}
			<p class="error" role="alert">{tokenError}</p>
		{/if}
		{#if removeError}
			<p class="error" role="alert">{removeError}</p>
		{/if}
		<div class="row token-row">
			<form
				id={tokenFormId}
				method="POST"
				class="grow"
				use:enhance={({ cancel }) => {
					tokenError = null;
					if (token.trim() === "" || !data.settings.secretsKeyConfigured) {
						cancel();
						return;
					}
					tokenBusy = true;
					return async ({ result, update }) => {
						tokenBusy = false;
						if (result.type === "failure") {
							tokenError = failureMessage(result);
							return;
						}
						if (result.type === "error") {
							tokenError = "Something went wrong";
							return;
						}
						token = "";
						await update();
					};
				}}
			>
				<input type="hidden" name="intent" value="saveToken" />
				<label class="label" for="gitlab-token">Token</label>
				<input
					id="gitlab-token"
					name="token"
					type="password"
					bind:value={token}
					placeholder="glpat-…"
					style={inputStyle}
				/>
			</form>
			<Button
				type="submit"
				form={tokenFormId}
				appearance="primary"
				isLoading={tokenBusy}
				isDisabled={token.trim() === "" || !data.settings.secretsKeyConfigured}
			>
				Save
			</Button>
			<Button
				onclick={testConnection}
				isLoading={testing}
				isDisabled={!data.settings.hasAccessToken || !data.settings.baseUrl}
			>
				Test
			</Button>
			{#if data.settings.hasAccessToken}
				<form
					bind:this={removeForm}
					method="POST"
					use:enhance={({ cancel }) => {
						removeError = null;
						if (!removeConfirmed) {
							cancel();
							confirmingRemove = true;
							return;
						}
						removeConfirmed = false;
						removeBusy = true;
						return async ({ result, update }) => {
							removeBusy = false;
							if (result.type === "failure") {
								removeError = failureMessage(result);
								return;
							}
							if (result.type === "error") {
								removeError = "Something went wrong";
								return;
							}
							version = null;
							await update();
						};
					}}
				>
					<input type="hidden" name="intent" value="removeToken" />
					<Button
						type="button"
						appearance="subtle"
						isLoading={removeBusy}
						onclick={() => (confirmingRemove = true)}
					>
						Remove
					</Button>
				</form>
			{/if}
		</div>
		{#if version}
			<span class="status">Connected to GitLab {version}</span>
		{/if}
		{#if testError}
			<p class="error" role="alert">{testError}</p>
		{/if}
	</section>
</AdminPage>

{#if secret}
	<Modal
		title="Webhook secret"
		onClose={() => (secret = null)}
	>
		{#snippet footer()}
			<Button appearance="primary" onclick={() => (secret = null)}>Done</Button>
		{/snippet}
		<p class="modal-text">
			Paste this secret into the webhook's "Secret token" field. It is shown
			once and cannot be read back.
		</p>
		<div class="inline">
			<input
				readonly
				aria-label="Webhook secret"
				value={secret}
				style={inputStyle}
			/>
			<CopyButton value={secret} />
		</div>
	</Modal>
{/if}

{#if confirmingSecret}
	<ConfirmDialog
		title="Replace webhook secret"
		message="The current secret stops working immediately. GitLab deliveries fail until the new secret is pasted into the webhook."
		confirmLabel="Replace secret"
		pending={generating}
		onConfirm={() => {
			confirmingSecret = false;
			void generateSecret();
		}}
		onClose={() => (confirmingSecret = false)}
	/>
{/if}

{#if confirmingRemove}
	<ConfirmDialog
		title="Remove access token"
		message="Back-fill and link unfurling stop working until a new token is saved."
		confirmLabel="Remove"
		pending={removeBusy}
		onConfirm={() => {
			removeConfirmed = true;
			confirmingRemove = false;
			removeForm?.requestSubmit();
		}}
		onClose={() => (confirmingRemove = false)}
	/>
{/if}

<style>
	.gitlab-description {
		margin: 0 0 12px;
		max-width: 720px;
		color: var(--ds-text-subtle);
		font-size: 12px;
		line-height: 18px;
	}

	.gitlab-section {
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

	.row {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		margin-bottom: 12px;
	}

	.grow {
		flex: 1;
		min-width: 0;
	}

	.inline {
		display: flex;
		gap: 8px;
	}

	.secret-row {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.field {
		margin-bottom: 12px;
	}

	.status-field {
		margin-bottom: 8px;
	}

	.status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.error {
		margin: 0;
		color: #e5493a;
	}

	.secret-hint {
		margin-top: 8px;
	}

	.token-row {
		margin-bottom: 12px;
	}

	form {
		margin: 0;
	}

	.modal-text {
		margin-top: 0;
	}
</style>
