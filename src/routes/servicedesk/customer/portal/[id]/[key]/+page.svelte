<script lang="ts">
	import { enhance } from "$app/forms";
	import { page } from "$app/state";
	import { absoluteDate, formatBytes, relativeDate } from "#lib/dates.ts";
	import Button from "#lib/components/Button.svelte";
	import Icon from "#lib/components/Icon.svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import RichTextEditor from "#lib/editor/RichTextEditor.svelte";
	import { isEditorEmpty } from "#lib/editor/editor-html.ts";
	import PortalBreadcrumb from "../../../PortalBreadcrumb.svelte";
	import PortalCard from "../../../PortalCard.svelte";
	import StatusLozenge from "#lib/issue-form/StatusLozenge.svelte";
	import type { ActionData, PageData, SubmitFunction } from "./$types";

	let {
		data,
		form,
	}: {
		data: PageData;
		form: ActionData;
	} = $props();

	let draft = $state("");
	let busy = $state(false);
	let submitting = $state(false);
	let localError = $state<string | null>(null);

	let actionError = $derived(
		localError ?? (submitting ? null : (form?.error ?? null)),
	);
	let attachmentError = $derived(page.url.searchParams.get("attachmentError"));
	let attachmentNotice = $derived(
		page.url.searchParams.get("attachmentNotice")?.match(/^\d{1,2}$/)?.[0] ??
			null,
	);

	const submit: SubmitFunction = () => {
		submitting = true;
		busy = true;
		localError = null;
		return async ({ result, update }) => {
			try {
				if (result.type === "success") {
					draft = "";
				}
				await update();
				if (result.type === "error") {
					localError = "Could not add the comment";
				}
			} finally {
				busy = false;
				submitting = false;
			}
		};
	};
</script>

<PageTitle title={data.request?.summary ?? "Request"} />

{#if attachmentError}
	<p role="alert" class="error">{attachmentError}</p>
{/if}
{#if attachmentNotice}
	<p role="alert" class="notice">
		{attachmentNotice === "1"
			? "Attachment added to the request."
			: `${attachmentNotice} attachments added to the request.`}
	</p>
{/if}
{#if data.request}
	{@const request = data.request}
	<PortalCard>
		<PortalBreadcrumb
			items={[
				{ label: "Help Center", href: "/servicedesk/customer/portals" },
				...(data.portal
					? [
							{
								label: data.portal.name,
								href: `/servicedesk/customer/portal/${data.portal.id}`,
							},
						]
					: []),
				{ label: request.key },
			]}
		/>
		<div class="heading">
			<div class="heading-text">
				<h1 class="title">{request.summary}</h1>
				<div class="meta">
					<StatusLozenge status={request.status} />
					<span>{request.key}</span>
					{#if request.requestType}<span>· {request.requestType.name}</span>{/if}
				</div>
			</div>
		</div>

		<div class="details">
			<span class="label">Raised by</span>
			<span>{request.reporter?.displayName ?? "—"}</span>
			<span class="label">Created</span>
			<span title={absoluteDate(request.created)}>
				{relativeDate(request.created)}
			</span>
		</div>

		{#if request.descriptionHtml}
			<div class="fat-rich-text description">
				{@html request.descriptionHtml}
			</div>
		{/if}

		{#if request.attachments.length > 0}
			<div class="attachments">
				<h2 class="section-title">Attachments</h2>
				<ul class="attachment-list">
					{#each request.attachments as attachment (attachment.id)}
						<li>
							<a href={`/api/attachments/${attachment.id}`} class="attachment-link">
								<Icon name="attachment" size={14} />
								{attachment.fileName}
							</a>
							<span class="attachment-size">{formatBytes(attachment.size)}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</PortalCard>

	<PortalCard>
		<h2 class="activity-title">Activity</h2>
		{#if request.comments.length === 0}
			<p class="no-comments">No comments yet.</p>
		{/if}
		{#each request.comments as comment (comment.id)}
			<div class="comment">
				<div class="comment-head">
					<strong>{comment.author ?? "Unknown user"}</strong>
					<span title={absoluteDate(comment.created)} class="comment-time">
						{relativeDate(comment.created)}
					</span>
				</div>
				{#if comment.bodyHtml}
					<div class="fat-rich-text">{@html comment.bodyHtml}</div>
				{/if}
			</div>
		{/each}

		<div class="comment-form">
			{#if actionError}
				<p role="alert" class="error">{actionError}</p>
			{/if}
			<form method="POST" class="comment-form-inner" use:enhance={submit}>
				<input id="comment-body" type="hidden" name="body" value={draft} />
				<RichTextEditor
					value={draft}
					onChange={(html) => (draft = html)}
					placeholder="Add a comment…"
					minHeight={90}
					ariaLabel="Add a comment"
				/>
				<div class="comment-actions">
					<Button
						type="submit"
						appearance="primary"
						isLoading={busy}
						isDisabled={isEditorEmpty(draft)}
					>
						Add comment
					</Button>
				</div>
			</form>
		</div>
	</PortalCard>

	<p class="back">
		<a href="/servicedesk/customer/user/requests">Back to my requests</a>
	</p>
{/if}

<style>
	.heading {
		display: flex;
		align-items: flex-start;
		gap: 16px;
		margin-bottom: 16px;
	}

	.heading-text {
		min-width: 0;
		flex: 1;
	}

	.title {
		margin: 0 0 4px;
		font-size: 24px;
		font-weight: 600;
		line-height: 28px;
	}

	.meta {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--ds-text-subtle);
		font-size: 13px;
	}

	.details {
		display: grid;
		grid-template-columns: 120px 1fr;
		gap: 6px 12px;
		margin-bottom: 20px;
		font-size: 14px;
	}

	.label {
		color: var(--ds-text-subtle);
	}

	.description {
		margin-bottom: 20px;
	}

	.attachments {
		margin-bottom: 20px;
	}

	.section-title {
		margin: 0 0 6px;
		font-size: 14px;
		font-weight: 600;
	}

	.attachment-list {
		margin: 0;
		padding-left: 18px;
	}

	.attachment-link {
		color: var(--ds-link);
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.attachment-size {
		color: var(--ds-text-subtle);
		font-size: 12px;
		margin-left: 6px;
	}

	.activity-title {
		margin: 0 0 12px;
		font-size: 16px;
		font-weight: 600;
	}

	.no-comments {
		margin: 0 0 16px;
		color: var(--ds-text-subtle);
	}

	.comment {
		padding: 10px 0;
		border-bottom: 1px solid var(--ds-border);
	}

	.comment-head {
		display: flex;
		gap: 8px;
		align-items: baseline;
		margin-bottom: 4px;
	}

	.comment-time {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.comment-form {
		margin-top: 16px;
	}

	.comment-form-inner {
		margin: 0;
	}

	.notice {
		color: var(--ds-text-success, #216e4e);
		margin-top: 0;
	}

	.error {
		color: #e5493a;
	}

	.comment-actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 8px;
	}

	.back {
		margin-top: 16px;
	}

	.back a {
		color: var(--ds-link);
	}

</style>
