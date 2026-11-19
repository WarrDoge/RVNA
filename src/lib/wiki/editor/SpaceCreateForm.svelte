<script lang="ts">
	import { enhance } from "$app/forms";
	import Button from "#lib/components/Button.svelte";
	import { suggestSpaceKey } from "./helpers.ts";
	import "./screens.css";

	interface Props {
		isAdmin: boolean;
		form: { error?: string } | null;
	}

	let { isAdmin, form }: Props = $props();

	let name = $state("");
	let key = $state("");
	let keyEdited = $state(false);
	let description = $state("");
	let busy = $state(false);

	let keyTaken = $derived(
		form?.error !== undefined && form.error.includes("already in use"),
	);
	let ready = $derived(
		name.trim() !== "" && /^[A-Za-z0-9]{2,255}$/.test(key.trim()),
	);

	function onName(value: string) {
		name = value;
		if (!keyEdited) key = suggestSpaceKey(value);
	}
</script>

{#if !isAdmin}
	<section class="wed-narrow">
		<h1 class="wed-heading">Create space</h1>
		<p>
			Only RVNA administrators can create spaces. Ask an administrator to
			create one for you.
		</p>
	</section>
{:else}
	<section class="wed-narrow">
		<h1 class="wed-heading">Create space</h1>
		<form
			method="POST"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					await update();
					busy = false;
				};
			}}
		>
			<div class="wed-field">
				<label class="wed-label" for="wed-space-name">Space name</label>
				<input
					id="wed-space-name"
					name="name"
					class="wed-input"
					bind:value={() => name, (value) => onName(value)}
					maxlength={255}
				/>
			</div>
			<div class="wed-field">
				<label class="wed-label" for="wed-space-key">Space key</label>
				<input
					id="wed-space-key"
					name="key"
					class="wed-input"
					bind:value={() => key, (value) => {
						key = value.toUpperCase();
						keyEdited = true;
					}}
					maxlength={255}
					aria-invalid={keyTaken}
				/>
				<p class={keyTaken ? "wed-field-error key-message" : "wed-hint"}>
					{keyTaken
						? form?.error
						: "2 or more letters and digits. It appears in the address of the space and cannot be changed later."}
				</p>
			</div>
			<div class="wed-field">
				<label class="wed-label" for="wed-space-description">Description</label>
				<textarea
					id="wed-space-description"
					name="description"
					class="wed-input wed-textarea"
					bind:value={description}
				></textarea>
			</div>
			{#if form?.error && !keyTaken}
				<p class="wed-error" role="alert">{form.error}</p>
			{/if}
			<div class="wed-actions">
				<Button
					appearance="primary"
					type="submit"
					isLoading={busy}
					isDisabled={!ready}
				>
					Create
				</Button>
				<Button href="/">Cancel</Button>
			</div>
		</form>
	</section>
{/if}

<style>
	form {
		margin: 0;
	}
	.key-message {
		margin: 4px 0 0;
	}
</style>
