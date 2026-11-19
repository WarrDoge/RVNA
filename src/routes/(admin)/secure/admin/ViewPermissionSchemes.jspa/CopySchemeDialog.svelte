<script lang="ts">
	import { goto } from "$app/navigation";
	import { untrack } from "svelte";
	import { enhance } from "$app/forms";
	import Banner from "#lib/admin/Banner.svelte";
	import FormField from "#lib/components/FormField.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	
	interface Scheme {
		id: string;
		name: string;
	}

	interface Props {
		scheme: Scheme;
		onClose: () => void;
	}

	let { scheme, onClose }: Props = $props();
	let name = $state(untrack(() => `${scheme.name} copy`));
	let error = $state<string | null>(null);
	let busy = $state(false);

	const formId = $props.id();

	function failureMessage(result: { data?: unknown }) {
		const data = result.data as { error?: unknown } | null;
		return typeof data?.error === "string"
			? data.error
			: "Something went wrong";
	}
</script>

{#snippet footer()}
	<Button
		type="submit"
		form={formId}
		appearance="primary"
		isLoading={busy}
		isDisabled={name.trim() === ""}
	>
		Copy
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal title="Copy permission scheme" width={480} {onClose} {footer}>
	{#if error}
		<Banner tone="danger">{error}</Banner>
	{/if}
	<form
		id={formId}
		method="POST"
		use:enhance={({ cancel }) => {
			error = null;
			if (name.trim() === "") {
				cancel();
				return;
			}
			busy = true;
			return async ({ result, update }) => {
				busy = false;
				if (result.type === "failure") {
					error = failureMessage(result);
					return;
				}
				if (result.type === "error") {
					error = "Something went wrong";
					return;
				}
				if (result.type === "success") {
					const data = result.data as
						| { scheme?: { id: string } }
						| undefined;
					await update();
					if (data?.scheme) {
						await goto(
							`/secure/admin/ViewPermissionScheme.jspa?id=${encodeURIComponent(data.scheme.id)}`,
						);
						return;
					}
				}
				onClose();
			};
		}}
	>
		<input type="hidden" name="intent" value="copy" />
		<input type="hidden" name="schemeId" value={scheme.id} />
		<FormField label="Name" htmlFor="copy-scheme-name">
			<input
				id="copy-scheme-name"
				name="name"
				value={name}
				oninput={(event) => (name = event.currentTarget.value)}
				style={inputStyle}
			/>
		</FormField>
		<p class="hint">
			The copy keeps the grants and gets a local source id. Projects are not
			copied.
		</p>
	</form>
</Modal>

<style>
	form {
		margin: 0;
	}

	.hint {
		margin: 0;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}
</style>
