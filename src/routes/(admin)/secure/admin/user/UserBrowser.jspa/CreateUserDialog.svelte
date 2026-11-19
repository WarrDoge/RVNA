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

	let { onClose }: { onClose: () => void } = $props();

	const formId = "create-user-form";

	let username = $state("");
	let displayName = $state("");
	let email = $state("");
	let password = $state("");
	let generate = $state(false);
	let mustChange = $state(false);
	let isAdmin = $state(false);
	let submitted = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let generated = $state<string | null>(null);
	let createdName = $state("");
	let copied = $state(false);
	let action = $derived(formAction(page.url, "createUser"));

	let missing = $derived({
		username: username.trim() === "" ? "Username is required." : null,
		displayName:
			displayName.trim() === "" ? "Full name is required." : null,
	});

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
			isDisabled={busy}>Create</Button
		>
		<Button appearance="subtle" onclick={onClose}>Cancel</Button>
	{/if}
{/snippet}

<Modal title="Create user" {onClose} width={480} {footer}>
	{#if generated !== null}
		<p class="first">
			The user <strong>{createdName}</strong> was created.
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
				submitted = true;
				error = null;
				if (missing.username || missing.displayName) {
					cancel();
					return;
				}
				busy = true;
				const name = username.trim();
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
					if (data?.generatedPassword) {
						generated = data.generatedPassword;
						createdName = name;
					} else {
						onClose();
					}
				};
			}}
		>
			<FormField
				label="Username"
				htmlFor="new-username"
				required
				error={submitted ? missing.username : null}
			>
				{#snippet children(aria)}
				<input
					id="new-username"
					name="username"
					bind:value={username}
					autocomplete="off"
					style={inputStyle} aria-describedby={aria.describedBy} aria-invalid={aria.invalid || undefined} aria-required={aria.required || undefined}/>
				{/snippet}
			</FormField>
			<FormField
				label="Full name"
				htmlFor="new-display-name"
				required
				error={submitted ? missing.displayName : null}
			>
				{#snippet children(aria)}
				<input
					id="new-display-name"
					name="displayName"
					bind:value={displayName}
					style={inputStyle} aria-describedby={aria.describedBy} aria-invalid={aria.invalid || undefined} aria-required={aria.required || undefined}/>
				{/snippet}
			</FormField>
			<FormField label="Email" htmlFor="new-email">
				<input
					id="new-email"
					name="email"
					type="email"
					bind:value={email}
					style={inputStyle}
				/>
			</FormField>
			<FormField
				label="Password"
				htmlFor="new-password"
				hint="Leave empty for an account that signs in with SSO only."
			>
				{#snippet children(aria)}
				<input
					id="new-password"
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
					name="generatePassword"
					checked={generate}
					onchange={(event) => {
						generate = event.currentTarget.checked;
						if (generate) mustChange = true;
					}}
				/>
				Generate a password
			</label>
			<label class="check">
				<input type="checkbox" name="mustChangePassword" bind:checked={mustChange} />
				Must change password at next login
			</label>
			<label class="check last">
				<input type="checkbox" name="isAdmin" bind:checked={isAdmin} />
				Administrator
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
