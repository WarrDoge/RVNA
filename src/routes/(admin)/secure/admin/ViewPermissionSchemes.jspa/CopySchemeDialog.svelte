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
		scheme?: Scheme | null;
		mode?: "copy" | "create";
		onClose: () => void;
	}

	let { scheme = null, mode = "copy", onClose }: Props = $props();
	let name = $state(
		untrack(() => (mode === "copy" && scheme ? `${scheme.name} copy` : "")),
	);
	let description = $state("");
	let error = $state<string | null>(null);
	let busy = $state(false);

	const formId = $props.id();
	const creating = $derived(mode === "create");

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
		{creating ? "Create" : "Copy"}
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal
	title={creating ? "Create permission scheme" : "Copy permission scheme"}
	width={480}
	{onClose}
	{footer}
>
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
		<input type="hidden" name="intent" value={creating ? "create" : "copy"} />
		{#if !creating && scheme}
			<input type="hidden" name="schemeId" value={scheme.id} />
		{/if}
		<FormField label="Name" htmlFor="scheme-name">
			<input
				id="scheme-name"
				name="name"
				bind:value={name}
				style={inputStyle}
			/>
		</FormField>
		{#if creating}
			<FormField label="Description (optional)" htmlFor="scheme-description">
				<input
					id="scheme-description"
					name="description"
					bind:value={description}
					style={inputStyle}
				/>
			</FormField>
		{/if}
		<p class="hint">
			{#if creating}
				The scheme starts with the built-in default grants. Projects are not
				assigned.
			{:else}
				The copy keeps the grants and gets a local source id. Projects are not
				copied.
			{/if}
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
