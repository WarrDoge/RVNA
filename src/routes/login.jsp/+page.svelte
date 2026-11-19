<script lang="ts">
	import { enhance } from "$app/forms";
	import Button from "#lib/components/Button.svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import AuthCard from "#lib/shell/AuthCard.svelte";
	import type { ActionData, PageData } from "./$types";

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let typedUsername = $state<string | null>(null);
	let username = $derived(typedUsername ?? form?.username ?? "");
	let password = $state("");
	let busy = $state(false);
	let localError = $state<string | null>(null);
	let error = $derived(localError ?? form?.error ?? null);

	let ssoUrl = $derived(
		`/auth/login${
			data.returnTo ? `?returnTo=${encodeURIComponent(data.returnTo)}` : ""
		}`,
	);
</script>

<PageTitle title="Log in" />

<AuthCard title="Log in to RVNA">
	<form
		method="POST"
		novalidate
		use:enhance={() => {
			busy = true;
			localError = null;
			return async ({ result, update }) => {
				busy = false;
				if (result.type === "redirect") {
					// A new session needs fresh layout data, so load the page again.
					window.location.assign(result.location);
					return;
				}
				if (result.type === "failure") {
					const failure = result.data as { error?: unknown } | null;
					localError =
						typeof failure?.error === "string"
							? failure.error
							: "Unable to log in. Try again.";
					password = "";
					return;
				}
				if (result.type === "error") {
					localError = "Unable to log in. Try again.";
					return;
				}
				await update({ reset: false });
				password = "";
			};
		}}
	>
		<input type="hidden" name="returnTo" value={data.returnTo} />
		<div class="field">
			<label for="login-username">Username</label>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				id="login-username"
				name="username"
				type="text"
				autocomplete="username"
				autocapitalize="none"
				spellcheck={false}
				autofocus
				required
				bind:value={() => username, (value) => {
					typedUsername = value;
				}}
			/>
		</div>
		<div class="field">
			<label for="login-password">Password</label>
			<input
				id="login-password"
				name="password"
				type="password"
				autocomplete="current-password"
				required
				bind:value={password}
			/>
		</div>
		{#if error}
			<div role="alert" class="error">{error}</div>
		{/if}
		<div class="submit">
			<Button type="submit" appearance="primary" isLoading={busy}>
				Log in
			</Button>
		</div>
	</form>

	{#if data.config.sso}
		<div class="or">
			<span></span>
			or
			<span></span>
		</div>
		<a href={ssoUrl} class="sso">Log in with SSO</a>
	{/if}
</AuthCard>

<style>
	.field {
		margin-bottom: 16px;
	}

	label {
		display: block;
		margin: 0 0 4px;
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle);
	}

	input {
		width: 100%;
		height: 40px;
		padding: 0 10px;
		background-color: var(--ds-background-input);
		border: 2px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text);
		font-size: 14px;
	}

	.error {
		margin: 0 0 16px;
		font-size: 14px;
		color: var(--ds-text-danger);
	}

	.submit :global(button) {
		width: 100%;
	}

	.or {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 24px 0;
		color: var(--ds-text-subtle);
	}

	.or span {
		flex: 1;
		height: 1px;
		background-color: var(--ds-border);
	}

	.sso {
		display: block;
		padding: 8px 12px;
		text-align: center;
		font-weight: 500;
		border-radius: 3px;
		background-color: var(--ds-background-neutral);
		color: var(--ds-text);
		text-decoration: none;
	}
</style>
