<script lang="ts">
	import { enhance } from "$app/forms";
	import Button from "#lib/components/Button.svelte";
	import type { PageRef } from "#lib/shared/wiki/index.ts";
	import { viewPageUrl } from "./wiki-api.ts";
	import "./screens.css";

	interface Props {
		page: PageRef;
		spaceName: string;
		canDelete: boolean;
		form: { error?: string } | null;
	}

	let { page, spaceName, canDelete, form }: Props = $props();

	let busy = $state(false);
</script>

<section class="wed-narrow">
	<h1 class="wed-heading">Delete page</h1>
	<p>
		Are you sure you want to delete <strong>{page.title || "Untitled"}</strong>?
	</p>
	<p class="wed-hint">
		The page moves to the trash of the {spaceName} space, where it can be
		restored. Its child pages move up one level.
	</p>
	{#if !canDelete}
		<p class="wed-error" role="alert">
			You do not have permission to delete this page.
		</p>
	{/if}
	{#if form?.error}
		<p class="wed-error" role="alert">{form.error}</p>
	{/if}
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
		<input type="hidden" name="pageId" value={page.id} />
		<div class="wed-actions">
			<Button
				appearance="danger"
				type="submit"
				isLoading={busy}
				isDisabled={!canDelete}
			>
				Delete
			</Button>
			<Button href={viewPageUrl(page.id)}>Cancel</Button>
		</div>
	</form>
</section>

<style>
	form {
		margin: 0;
	}
</style>
