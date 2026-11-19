<script lang="ts">
	import { goto } from "$app/navigation";
	import { untrack } from "svelte";
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";
	import type {
		EditorSpace,
		PageRef,
	} from "#lib/shared/wiki/index.ts";
		import { WikiApiError, errorMessage } from "./edit-session.svelte.ts";
	import type { Location, TreeNode } from "./helpers.ts";
	import LocationPicker from "./LocationPicker.svelte";
	import { copyPage, viewPageUrl } from "./wiki-api.ts";
	import "./screens.css";

	interface Props {
		page: PageRef;
		spaces: EditorSpace[];
		tree: TreeNode[];
	}

	let { page, spaces, tree }: Props = $props();

	let title = $state(untrack(() => `Copy of ${page.title}`));
	let location = $state<Location>(
		untrack(() => ({ spaceKey: page.spaceKey, parentId: page.parentId })),
	);
	let withChildren = $state(false);
	let withAttachments = $state(true);
	let withLabels = $state(true);
	let copying = $state(false);
	let error = $state<unknown>(null);

	let titleTaken = $derived(
		error instanceof WikiApiError && error.status === 409,
	);
	let canCopy = $derived(
		spaces.some(
			(space) => space.key === location.spaceKey && space.canCreate,
		),
	);

	async function copy() {
		copying = true;
		error = null;
		try {
			const created = await copyPage(page.id, {
				title: title.trim(),
				spaceKey: location.spaceKey,
				parentId: location.parentId,
				withChildren,
				withAttachments,
				withLabels,
			});
			void goto(viewPageUrl(created.id));
		} catch (cause) {
			error = cause;
		} finally {
			copying = false;
		}
	}
</script>

<section class="wed-narrow">
	<h1 class="wed-heading">Copy page</h1>
	<div class="wed-field">
		<label class="wed-label" for="wed-copy-title">Title</label>
		<input
			id="wed-copy-title"
			class="wed-input"
			bind:value={() => title, (value) => (title = value)}
			maxlength={255}
			aria-invalid={titleTaken}
		/>
		{#if titleTaken}
			<p class="wed-field-error field-error">{errorMessage(error)}</p>
		{/if}
	</div>
	<LocationPicker
		value={location}
		onchange={(next) => (location = next)}
		{spaces}
		initialTree={tree}
		requireCreate
	/>
	<div class="copy-checks">
		<label class="wed-check">
			<input type="checkbox" bind:checked={withChildren} />
			Copy child pages
		</label>
		<label class="wed-check">
			<input type="checkbox" bind:checked={withAttachments} />
			Copy attachments
		</label>
		<label class="wed-check">
			<input type="checkbox" bind:checked={withLabels} />
			Copy labels
		</label>
	</div>
	{#if error && !titleTaken}
		<p class="wed-error" role="alert">{errorMessage(error)}</p>
	{/if}
	<div class="wed-actions">
		<Button
			appearance="primary"
			onclick={copy}
			isLoading={copying}
			isDisabled={title.trim() === "" || !canCopy}
		>
			Copy
		</Button>
		<Button href={viewPageUrl(page.id)}>Cancel</Button>
	</div>
</section>

<style>
	.copy-checks {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 16px 0 0;
	}
	.field-error {
		margin: 4px 0 0;
	}
</style>
