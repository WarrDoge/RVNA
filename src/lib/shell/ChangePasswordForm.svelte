<script lang="ts">
	import { enhance } from "$app/forms";
	import Button from "#lib/components/Button.svelte";
	import FormField from "#lib/components/FormField.svelte";

	type FormData = {
		error?: string;
		intent?: string;
		changed?: boolean;
	} | null;

	interface Props {
		width?: number;
		onChanged?: () => void;
		form?: FormData;
	}

	let { width = 360, onChanged, form }: Props = $props();

	const MIN_LENGTH = 12;

	let current = $state("");
	let next = $state("");
	let confirm = $state("");
	let localError = $state<string | null>(null);
	let done = $state(false);
	let busy = $state(false);
	let serverError = $derived(
		form &&
			"error" in form &&
			"intent" in form &&
			form.intent === "changePassword"
			? form.error
			: null,
	);
	let serverDone = $derived(
		form &&
			"changed" in form &&
			"intent" in form &&
			form.intent === "changePassword",
	);
	let error = $derived(localError ?? serverError);
	let changed = $derived(done || serverDone);
</script>

<form
	method="POST"
	novalidate
	style="width: {width}px; max-width: 100%"
	use:enhance={({ cancel }) => {
		done = false;
		if (current === "") {
			localError = "Enter your current password";
			cancel();
			return;
		}
		if ([...next].length < MIN_LENGTH) {
			localError = `The new password must be at least ${MIN_LENGTH} characters long`;
			cancel();
			return;
		}
		if (next !== confirm) {
			localError = "The new passwords do not match";
			cancel();
			return;
		}
		localError = null;
		busy = true;
		return async ({ result, update }) => {
			busy = false;
			if (result.type === "failure") {
				const failure = result.data as { error?: unknown } | null;
				localError =
					typeof failure?.error === "string"
						? failure.error
						: "Unable to change the password";
				return;
			}
			if (result.type === "error") {
				localError = "Unable to change the password";
				return;
			}
			current = "";
			next = "";
			confirm = "";
			done = true;
			await update({ reset: false });
			onChanged?.();
		};
	}}
>
	<input type="hidden" name="intent" value="changePassword" />
	<FormField label="Current password" htmlFor="current-password">
		<input
			id="current-password"
			name="currentPassword"
			type="password"
			autocomplete="current-password"
			bind:value={current}
		/>
	</FormField>
	<FormField
		label="New password"
		htmlFor="new-password"
		hint={`At least ${MIN_LENGTH} characters. Length matters more than symbols. This also revokes the user's API tokens.`}
	>
		<input
			id="new-password"
			name="newPassword"
			type="password"
			autocomplete="new-password"
			aria-describedby="new-password-hint"
			bind:value={next}
		/>
	</FormField>
	<FormField label="Confirm new password" htmlFor="confirm-password">
		<input
			id="confirm-password"
			name="confirmPassword"
			type="password"
			autocomplete="new-password"
			bind:value={confirm}
		/>
	</FormField>
	{#if error}
		<div role="alert" class="error">{error}</div>
	{/if}
	{#if changed}
		<div role="status" class="done">
			Password changed. Your other sessions were signed out.
		</div>
	{/if}
	<Button type="submit" appearance="primary" isLoading={busy}>
		Change password
	</Button>
</form>

<style>
	form {
		margin: 0;
	}

	input {
		width: 100%;
		height: 32px;
		padding: 0 8px;
		background-color: var(--ds-background-input);
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text);
		font-size: 14px;
	}

	.error {
		margin: 0 0 16px;
		color: var(--ds-text-danger);
	}

	.done {
		margin: 0 0 16px;
		color: var(--ds-text-success);
	}
</style>
