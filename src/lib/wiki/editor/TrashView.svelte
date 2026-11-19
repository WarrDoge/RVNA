<script lang="ts">
	import { enhance } from "$app/forms";
	import { absoluteDate } from "#lib/dates.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import Button from "#lib/components/Button.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import type {
		EditorSpace,
		TrashEntry,
	} from "#lib/shared/wiki/index.ts";
	import "./screens.css";

	interface Props {
		spaceKey: string;
		entries: TrashEntry[];
		spaces: EditorSpace[];
		canRestore: boolean;
		canPurge: boolean;
		form: { error?: string; [key: string]: unknown } | null;
	}

	let {
		spaceKey,
		entries,
		spaces,
		canRestore,
		canPurge,
		form,
	}: Props = $props();

	let purging = $state<TrashEntry | null>(null);
	let purgeId = $state("");
	let purgeForm = $state<HTMLFormElement>();
	let purgeBusy = $state(false);
	let restoring = $state<string | null>(null);

	let spaceName = $derived(
		spaces.find((space) => space.key === spaceKey)?.name ?? spaceKey,
	);

	function confirmPurge() {
		if (!purging) return;
		purgeId = purging.page.id;
		purging = null;
		queueMicrotask(() => purgeForm?.requestSubmit());
	}
</script>

<section class="trash-page">
	<h1 class="wed-heading">Trash</h1>
	<p class="wed-hint trash-hint">
		Deleted pages of the {spaceName} space.
	</p>
	{#if form?.error}
		<p class="wed-error" role="alert">{form.error}</p>
	{/if}
	<table class="fat-table trash-table">
		<thead>
			<tr>
				<th>Page</th>
				<th>Deleted by</th>
				<th>Deleted</th>
				<th aria-label="Actions"></th>
			</tr>
		</thead>
		<tbody>
			{#each entries as entry (entry.page.id)}
				<tr>
					<td>{entry.page.title}</td>
					<td>
						{#if entry.trashedBy}
							<span class="deleted-by">
								<Avatar user={entry.trashedBy} size={20} />
								{entry.trashedBy.displayName}
							</span>
						{:else}
							Unknown
						{/if}
					</td>
					<td>{absoluteDate(entry.trashedAt)}</td>
					<td>
						<div class="wed-table-actions">
							{#if canRestore}
								<form
									method="POST"
									action="?/restore"
									use:enhance={() => {
										restoring = entry.page.id;
										return async ({ update }) => {
											await update();
											restoring = null;
										};
									}}
								>
									<input type="hidden" name="pageId" value={entry.page.id} />
									<Button
										type="submit"
										isLoading={restoring === entry.page.id}
									>
										Restore
									</Button>
								</form>
							{/if}
							{#if canPurge}
								<Button
									appearance="danger"
									onclick={() => (purging = entry)}
								>
									Purge
								</Button>
							{/if}
						</div>
					</td>
				</tr>
			{/each}
			{#if entries.length === 0}
				<tr>
					<td colspan={4} class="empty-row">The trash is empty.</td>
				</tr>
			{/if}
		</tbody>
	</table>
	<form
		method="POST"
		action="?/purge"
		bind:this={purgeForm}
		hidden
		use:enhance={() => {
			purgeBusy = true;
			return async ({ update }) => {
				await update();
				purgeBusy = false;
			};
		}}
	>
		<input type="hidden" name="pageId" value={purgeId} />
	</form>
	{#if purging}
		<ConfirmDialog
			title="Purge page"
			message={`"${purging.page.title}" with its attachments and history will be deleted permanently. This cannot be undone.`}
			confirmLabel="Purge"
			pending={purgeBusy}
			onConfirm={confirmPurge}
			onClose={() => (purging = null)}
		/>
	{/if}
</section>

<style>
	.trash-page {
		padding: 24px 32px;
		max-width: 960px;
	}
	.trash-hint {
		margin-bottom: 16px;
	}
	.trash-table {
		width: 100%;
	}
	.deleted-by {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.empty-row {
		color: var(--ds-text-subtle);
	}
	form {
		margin: 0;
	}
</style>
