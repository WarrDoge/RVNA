<script lang="ts">
	import { enhance } from "$app/forms";
	import { page } from "$app/state";
	import Banner from "#lib/admin/Banner.svelte";
	import CopyPassword from "#lib/admin/CopyPassword.svelte";
	import { copyToClipboard } from "#lib/admin/clipboard.ts";
	import FormField from "#lib/components/FormField.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import { formAction } from "#lib/admin/users.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";

	let {
		user,
		onClose,
	}: { user: { id: string; username: string }; onClose: () => void } =
		$props();

	const formId = "set-user-password-form";

	let password = $state("");
	let generate = $state(false);
	let mustChange = $state(true);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let generated = $state<string | null>(null);
	let copied = $state(false);
	let action = $derived(formAction(page.url, "setPassword"));

	async function copy() {
		if (generated) copied = await copyToClipboard(generated);
	}
</script>

{#snippet footer()}
	{#if generated !== null}
		<Button appearance="primary" onclick={onClose}>Done</Button>
	{:else}
		<Button
			appearance="primary"
			type="submit"
			form={formId}
			isLoading={busy}
			isDisabled={busy}>Set password</Button
		>
		<Button appearance="subtle" onclick={onClose}>Cancel</Button>
	{/if}
{/snippet}

<Modal title="Set password" {onClose} width={480} {footer}>
	{#if generated !== null}
		<p class="first">
			The password of <strong>{user.username}</strong> was set.
		</p>
		<CopyPassword password={generated} {copied} onCopy={copy} />
		<p class="subtle">Copy it now: it is shown only once.</p>
	{:else}
		{#if error}
			<Banner tone="danger">{error}</Banner>
		{/if}
		<form
			id={formId}
			method="POST"
			action={action}
			novalidate
			use:enhance={({ cancel }) => {
				if (busy) {
					cancel();
					return;
				}
				error = null;
				busy = true;
				return async ({ result, update }) => {
					busy = false;
					if (result.type === "failure") {
						const data = result.data as { error?: unknown } | null;
						error =
							typeof data?.error === "string"
								? data.error
								: "Something went wrong";
						return;
					}
					if (result.type === "error") {
						error = "Something went wrong";
						return;
					}
					const data =
						result.type === "success"
							? (result.data as {
									generatedPassword?: string | null;
								} | null)
							: null;
					await update();
					if (data?.generatedPassword) generated = data.generatedPassword;
					else onClose();
				};
			}}
		>
			<input type="hidden" name="userId" value={user.id} />
			<FormField
				label="New password"
				htmlFor="user-password"
				hint="Saving a password signs the user out of every session. This also revokes the user's API tokens."
			>
				{#snippet children(aria)}
				<input
					id="user-password"
					name="password"
					type="password"
					bind:value={password}
					disabled={generate}
					autocomplete="new-password"
					style={inputStyle} aria-describedby={aria.describedBy} aria-invalid={aria.invalid || undefined} aria-required={aria.required || undefined}/>
				{/snippet}
			</FormField>
			<label class="check">
				<input
					type="checkbox"
					name="generate"
					checked={generate}
					onchange={(event) => (generate = event.currentTarget.checked)}
				/>
				Generate a password
			</label>
			<label class="check last">
				<input
					type="checkbox"
					name="mustChangePassword"
					bind:checked={mustChange}
				/>
				Must change password at next login
			</label>
		</form>
	{/if}
</Modal>

<style>
	.first {
		margin-top: 0;
	}

	.subtle {
		color: var(--ds-text-subtle);
	}

	form {
		margin: 0;
	}

	.check {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}

	.check.last {
		margin-bottom: 0;
	}
</style>
