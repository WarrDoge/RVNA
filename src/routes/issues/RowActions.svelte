<script lang="ts">
	import { api } from "#lib/api.ts";
	import type { NavigatorIssue } from "#lib/api-types.ts";
	import Icon from "#lib/components/Icon.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import { dismiss } from "#lib/components/dismiss.ts";
	import CreateIssueDialog from "#lib/issue-form/CreateIssueDialog.svelte";
	import LinkDialog from "#lib/issue/LinkDialog.svelte";
	import LogWorkDialog from "#lib/issue/LogWorkDialog.svelte";
	import { errorMessage } from "./navigator.ts";

	interface Props {
		issue: NavigatorIssue;
		isAdmin: boolean;
		onChanged: () => void;
	}

	let { issue, isAdmin, onChanged }: Props = $props();

	let open = $state(false);
	let dialog = $state<"log" | "link" | "subtask" | "delete" | null>(null);
	let error = $state<string | null>(null);
	let fileInput: HTMLInputElement;
	let pendingDelete = $state(false);

	async function upload(files: File[]) {
		const form = new FormData();
		for (const file of files) form.append("file", file, file.name);
		try {
			await api(`/api/issues/${issue.key}/attachments`, {
				method: "POST",
				body: form,
			});
			onChanged();
		} catch (cause) {
			error = errorMessage(cause);
		}
	}

	async function remove() {
		pendingDelete = true;
		try {
			await api(`/api/issues/${issue.key}`, { method: "DELETE" });
			dialog = null;
			onChanged();
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			pendingDelete = false;
		}
	}
</script>

<div class="root fat-row-actions" {@attach dismiss(() => open, () => (open = false))}>
	<button
		type="button"
		aria-label={`Actions for ${issue.key}`}
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={() => (open = !open)}
		class="trigger"
	>
		<Icon name="kebab" size={14} />
	</button>
	{#if open}
		<div role="menu" aria-label={`Actions for ${issue.key}`} class="menu">
			<button
				type="button"
				role="menuitem"
				class="fat-menu-item"
				onclick={() => {
					open = false;
					dialog = "log";
				}}
			>
				Log work
			</button>
			<button
				type="button"
				role="menuitem"
				class="fat-menu-item"
				onclick={() => {
					open = false;
					fileInput?.click();
				}}
			>
				Attach files
			</button>
			<button
				type="button"
				role="menuitem"
				class="fat-menu-item"
				onclick={() => {
					open = false;
					dialog = "link";
				}}
			>
				Link
			</button>
			{#if !issue.type.subtask}
				<button
					type="button"
					role="menuitem"
					class="fat-menu-item"
					onclick={() => {
						open = false;
						dialog = "subtask";
					}}
				>
					Create sub-task
				</button>
			{/if}
			{#if isAdmin}
				<button
					type="button"
					role="menuitem"
					class="fat-menu-item danger"
					onclick={() => {
						open = false;
						dialog = "delete";
					}}
				>
					Delete
				</button>
			{/if}
		</div>
	{/if}
	<input
		bind:this={fileInput}
		type="file"
		multiple
		aria-label={`Attach files to ${issue.key}`}
		class="file-input"
		onchange={(event) => {
			void upload(Array.from(event.currentTarget.files ?? []));
			event.currentTarget.value = "";
		}}
	/>
	{#if dialog === "log"}
		<LogWorkDialog
			issueKey={issue.key}
			onClose={() => (dialog = null)}
			onSaved={onChanged}
			onError={(message) => (error = message)}
		/>
	{/if}
	{#if dialog === "link"}
		<LinkDialog
			issueKey={issue.key}
			onClose={() => (dialog = null)}
			onSaved={onChanged}
			onError={(message) => (error = message)}
		/>
	{/if}
	{#if dialog === "subtask"}
		<CreateIssueDialog
			defaults={{ projectKey: issue.project.key, parent: issue.key }}
			onClose={() => (dialog = null)}
			onCreated={() => {
				dialog = null;
				onChanged();
			}}
		/>
	{/if}
	{#if dialog === "delete"}
		<ConfirmDialog
			title="Delete issue"
			message={`Delete ${issue.key}? This cannot be undone.`}
			onClose={() => (dialog = null)}
			onConfirm={() => void remove()}
			pending={pendingDelete}
		/>
	{/if}
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</div>

<style>
	.root {
		position: relative;
	}

	.trigger {
		display: inline-flex;
		padding: 2px;
		background: transparent;
		border: 0;
		color: var(--ds-text-subtle, #a9abaf);
		cursor: pointer;
	}

	.menu {
		position: absolute;
		right: 0;
		top: 24px;
		z-index: 120;
		min-width: 180px;
		padding-block: 4px;
		background-color: var(--ds-surface-overlay, #22272b);
		border: 1px solid var(--ds-border, #3b3d42);
		border-radius: 3px;
		box-shadow: var(--ds-shadow-overlay, 0 8px 12px #1e1f2126);
	}

	.danger {
		color: #e5493a;
	}

	.file-input {
		display: none;
	}

	.error {
		margin: 0;
		color: #e5493a;
		font-size: 12px;
	}
</style>
