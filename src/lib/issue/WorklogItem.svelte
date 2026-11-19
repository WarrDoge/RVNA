<script lang="ts">
	import { absoluteDate, formatDuration, relativeDate } from "#lib/dates.ts";
	import { api } from "#lib/api.ts";
	import type { Worklog } from "#lib/api-types.ts";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import UserLink from "#lib/components/UserLink.svelte";
	import { errorMessage } from "./activity-utils.ts";
	import TimelineAvatar from "./TimelineAvatar.svelte";

	interface Props {
		worklog: Worklog;
		issueKey: string;
		canDelete: boolean;
		onChanged: () => Promise<void> | void;
		onError: (message: string) => void;
	}

	let { worklog, issueKey, canDelete, onChanged, onError }: Props = $props();

	let confirming = $state(false);
	let removing = $state(false);

	async function remove() {
		if (removing) return;
		removing = true;
		try {
			await api(`/api/issues/${issueKey}/worklogs/${worklog.id}`, {
				method: "DELETE",
			});
			confirming = false;
			await onChanged();
		} catch (cause) {
			onError(errorMessage(cause));
		} finally {
			removing = false;
		}
	}
</script>

<div class="worklog-row">
	<TimelineAvatar user={worklog.author} />
	<div class="worklog-body">
		<div class="worklog-head">
			{#if worklog.author}
				<UserLink username={worklog.author.username}>
					<strong>{worklog.author.displayName}</strong>
				</UserLink>
			{:else}
				<strong>Unknown user</strong>
			{/if}
			<span class="worklog-date" title={absoluteDate(worklog.started)}>
				{relativeDate(worklog.started)}
			</span>
			{#if canDelete}
				<button
					type="button"
					class="link-button danger"
					onclick={() => (confirming = true)}
				>
					Delete
				</button>
			{/if}
		</div>
		<div class="worklog-line">Logged <strong>{formatDuration(worklog.seconds)}</strong>{worklog.comment ? ` — ${worklog.comment}` : ""}</div>
	</div>
	{#if confirming}
		<ConfirmDialog
			title="Delete work log"
			message="Delete this work log? The time spent will be removed."
			onClose={() => (confirming = false)}
			onConfirm={remove}
			pending={removing}
		/>
	{/if}
</div>

<style>
	.worklog-row {
		display: flex;
		gap: 10px;
		padding: 10px 0;
		border-bottom: 1px solid var(--ds-border, #091e4224);
	}
	.worklog-body {
		flex: 1;
		min-width: 0;
	}
	.worklog-head {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.worklog-date {
		color: var(--ds-text-subtle, #505258);
		font-size: 12px;
	}
	.link-button {
		margin-left: auto;
		padding: 0;
		background: transparent;
		border: 0;
		color: #e5493a;
		cursor: pointer;
		font-size: inherit;
	}
	.worklog-line {
		margin-top: 2px;
	}
</style>
