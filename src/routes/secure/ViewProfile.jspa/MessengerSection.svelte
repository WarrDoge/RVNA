<script lang="ts">
	import { invalidate } from "$app/navigation";
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";
	import type { PageData } from "./$types";

	let { info }: { info: NonNullable<PageData["messenger"]> } = $props();

	let code = $state<string | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);

	async function connect() {
		busy = true;
		error = null;
		try {
			const result = await api<{
				code: string;
				expiresAt: string;
				botMatrixId: string;
			}>("/api/profile/messenger", { method: "POST" });
			code = result.code;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Something went wrong";
		} finally {
			busy = false;
		}
	}

	async function disconnect() {
		busy = true;
		error = null;
		try {
			await api("/api/profile/messenger", { method: "DELETE" });
			code = null;
			await invalidate("app:profile");
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Something went wrong";
		} finally {
			busy = false;
		}
	}
</script>

<section class="messenger">
	<h2>Messenger</h2>
	{#if info.linkedMatrixId}
		<p class="status">Connected as <code>{info.linkedMatrixId}</code></p>
		<Button appearance="subtle" isLoading={busy} onclick={() => void disconnect()}>
			Disconnect
		</Button>
	{:else}
		<p class="status">Not connected</p>
		{#if info.enabled && info.botMatrixId}
			<Button appearance="primary" isLoading={busy} onclick={() => void connect()}>
				Connect to messenger
			</Button>
		{:else}
			<p class="hint">An administrator has not connected Messenger yet.</p>
		{/if}
	{/if}
	{#if code && info.botMatrixId}
		<p class="code">
			Send <code>!link {code}</code> to {info.botMatrixId} in Matrix. The code is
			valid for 10 minutes.
		</p>
	{/if}
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</section>

<style>
	.messenger {
		margin-top: 20px;
		padding-top: 16px;
		border-top: 1px solid var(--ds-border);
	}

	h2 {
		margin: 0 0 8px;
		font-size: 14px;
		font-weight: 600;
		color: var(--ds-text);
	}

	.status {
		margin: 0 0 8px;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.hint {
		margin: 0;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.code {
		margin: 10px 0 0;
		color: var(--ds-text);
		font-size: 12px;
		line-height: 18px;
	}

	code {
		font-family: var(--ds-font-monospace, monospace);
	}

	.error {
		margin: 8px 0 0;
		color: #e5493a;
		font-size: 12px;
	}
</style>
