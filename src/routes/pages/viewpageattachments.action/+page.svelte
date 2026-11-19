<script lang="ts">
	import "#lib/wiki/wiki.css";
	import { invalidate } from "$app/navigation";
	import Button from "#lib/components/Button.svelte";
	import PageMessage from "#lib/wiki/PageMessage.svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import WikiLayout from "#lib/wiki/WikiLayout.svelte";
	import { deleteAttachment, uploadAttachment } from "#lib/wiki/api.ts";
	import { spaceHref } from "#lib/wiki/format.ts";
	import type { Attachment } from "#lib/wiki/types.ts";
	import AttachmentRow from "./AttachmentRow.svelte";
	import PreviewOverlay from "./PreviewOverlay.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let fileInput = $state<HTMLInputElement>();
	let preview = $state<Attachment | null>(null);
	let error = $state<string | null>(null);
	let uploading = $state(false);

	async function upload(files: File[]) {
		if (!data.page || files.length === 0) return;
		uploading = true;
		error = null;
		for (const file of files) {
			try {
				await uploadAttachment(data.page.id, file);
			} catch (cause) {
				error =
					cause instanceof Error
						? cause.message
						: "Unable to upload the file";
			}
		}
		await invalidate("app:wiki-attachments");
		await invalidate("app:wiki-page");
		uploading = false;
	}

	async function remove(id: string) {
		error = null;
		try {
			await deleteAttachment(id);
			await invalidate("app:wiki-attachments");
			await invalidate("app:wiki-page");
		} catch (cause) {
			error =
				cause instanceof Error ? cause.message : "Unable to delete the file";
		}
	}
</script>

{#if !data.page}
	<PageMessage
		title="Page not found"
		message="You cannot see this page or its attachments."
		back={false}
	/>
{:else}
	{#key data.page.id}
		<PageTitle title={data.page.title} />
		<WikiLayout
			space={data.page.space}
			tree={data.tree}
			currentPageId={data.page.id}
			contextPageId={data.page.sourceId}
			ancestorIds={data.page.ancestors.map((ancestor) => ancestor.id)}
		>
			<div class="wiki-crumbs">
				<a href={spaceHref(data.page.space.key)}>{data.page.space.name}</a>
				<span>/</span>
				<a href={`/pages/viewpage.action?pageId=${data.page.sourceId}`}>
					{data.page.title}
				</a>
				<span>/</span>
				<span>Attachments</span>
			</div>
			<div class="wiki-page-header">
				<h1 class="wiki-page-title">Attachments</h1>
				{#if data.canEdit}
					<div class="wiki-actions">
						<Button
							appearance="primary"
							onclick={() => fileInput?.click()}
							isDisabled={uploading}
						>
							{uploading ? "Uploading…" : "Upload file"}
						</Button>
						<input
							bind:this={fileInput}
							type="file"
							multiple
							aria-label="Upload attachments"
							onchange={(event) => {
								const files = Array.from(event.currentTarget.files ?? []);
								event.currentTarget.value = "";
								void upload(files);
							}}
						/>
					</div>
				{/if}
			</div>
			<p class="hint">
				Uploading a file with the name of an existing attachment adds a new
				version of it.
			</p>
			{#if error}
				<p role="alert" class="error">{error}</p>
			{/if}

			{#if data.attachments.length === 0}
				<p class="wiki-list-empty">This page has no attachments.</p>
			{:else}
				<table class="fat-table table">
					<thead>
						<tr>
							<th>Name</th>
							<th>Size</th>
							<th>Creator</th>
							<th>Date</th>
							<th>Versions</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each data.attachments as attachment (attachment.id)}
							<AttachmentRow
								{attachment}
								pageSourceId={data.page.sourceId}
								onPreview={(row) => (preview = row)}
								onDelete={(row) => void remove(row.id)}
							/>
						{/each}
					</tbody>
				</table>
			{/if}

			{#if preview}
				<PreviewOverlay
					attachment={preview}
					pageSourceId={data.page.sourceId}
					onClose={() => (preview = null)}
				/>
			{/if}
		</WikiLayout>
	{/key}
{/if}

<style>
	.hint {
		color: var(--ds-text-subtle);
		max-width: 720px;
	}

	.error {
		color: #e5493a;
	}

	.table {
		width: 100%;
		max-width: 960px;
	}

	input[type="file"] {
		display: none;
	}
</style>
