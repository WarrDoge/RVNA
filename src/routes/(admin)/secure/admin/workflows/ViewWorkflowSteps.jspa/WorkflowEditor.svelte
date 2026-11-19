<script lang="ts">
	import { untrack } from "svelte";
	import { invalidate } from "$app/navigation";
	import { api } from "#lib/api.ts";
	import Banner from "#lib/admin/Banner.svelte";
	import { errorMessage } from "#lib/admin/config.ts";
	import Button from "#lib/components/Button.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import WorkflowDiagram from "#lib/workflow/WorkflowDiagram.svelte";
	import type {
		Definition,
		PublishResult,
		WorkflowDetail,
		WorkflowStatus,
	} from "#lib/workflow/types.ts";
	import PublishDialog from "./PublishDialog.svelte";
	import RenameStatusDialog from "./RenameStatusDialog.svelte";
	import TextView from "./TextView.svelte";
	import { toDefinition } from "./definition.ts";

	interface Props {
		initialDetail: WorkflowDetail;
		mode: "text" | "diagram";
	}

	let { initialDetail, mode }: Props = $props();

	let detail = $state<WorkflowDetail>(untrack(() => initialDetail));
	let error = $state<string | null>(null);
	let notice = $state<string | null>(null);
	let busy = $state(false);
	let publishing = $state(false);
	let discarding = $state(false);
	let discardBusy = $state(false);
	let renaming = $state<WorkflowStatus | null>(null);

	async function refresh() {
		try {
			detail = await api<WorkflowDetail>(
				`/api/admin/workflows/${detail.id}`,
			);
			await invalidate("app:admin-workflows");
		} catch (cause) {
			error = errorMessage(cause);
		}
	}

	async function save(definition: Definition) {
		if (busy) return false;
		busy = true;
		error = null;
		try {
			detail = await api<WorkflowDetail>(
				`/api/admin/workflows/${detail.id}/draft`,
				{ method: "PUT", body: JSON.stringify(definition) },
			);
			notice = null;
			await invalidate("app:admin-workflows");
			return true;
		} catch (cause) {
			error = errorMessage(cause);
			return false;
		} finally {
			busy = false;
		}
	}

	function change(apply: (definition: Definition) => Definition) {
		if (busy) return Promise.resolve(false);
		return save(apply(toDefinition(detail)));
	}

	async function discard() {
		if (discardBusy) return;
		discardBusy = true;
		try {
			await api<void>(`/api/admin/workflows/${detail.id}/draft`, {
				method: "DELETE",
			});
			discarding = false;
			error = null;
			notice = "The draft was discarded. The live workflow is unchanged.";
			await refresh();
		} catch (cause) {
			discarding = false;
			error = errorMessage(cause);
		} finally {
			discardBusy = false;
		}
	}

	async function published(result: PublishResult) {
		publishing = false;
		error = null;
		notice =
			result.movedIssues > 0
				? `Published. ${result.movedIssues} ${result.movedIssues === 1 ? "issue was" : "issues were"} moved to their new status.`
				: "Published. The workflow is live.";
		await refresh();
	}
</script>

{#if notice}
	<Banner tone="success">{notice}</Banner>
{/if}
{#if error}
	<Banner tone="danger">{error}</Banner>
{/if}

{#if detail.hasDraft}
	<div class="draft-banner" role="status">
		<span class="draft-text">
			You are editing a draft of this workflow. Changes are not live until you
			publish.
		</span>
		<Button
			appearance="primary"
			isDisabled={busy}
			onclick={() => (publishing = true)}
		>
			Publish
		</Button>
		<Button isDisabled={busy} onclick={() => (discarding = true)}>
			Discard draft
		</Button>
	</div>
{:else}
	<p class="live-note">
		This is the live workflow. Your first change creates a draft; nothing goes
		live until you publish it.
		{detail.projects.length === 0 ? " No project uses this workflow yet." : ""}
	</p>
{/if}

{#if mode === "text"}
	<TextView {detail} {busy} onChange={change} onRename={(status) => (renaming = status)} />
{:else if detail.statuses.length === 0}
	<Banner>
		This workflow has no statuses yet. Switch to the text view to add some.
	</Banner>
{:else}
	<WorkflowDiagram {detail} />
{/if}

{#if publishing}
	<PublishDialog
		{detail}
		onClose={() => (publishing = false)}
		onPublished={published}
	/>
{/if}

{#if discarding}
	<ConfirmDialog
		title="Discard draft"
		confirmLabel="Discard draft"
		message="Discard all unpublished changes to this workflow? The live workflow stays as it is."
		pending={discardBusy}
		onClose={() => (discarding = false)}
		onConfirm={discard}
	/>
{/if}

{#if renaming}
	<RenameStatusDialog
		status={renaming}
		workflowId={detail.id}
		onClose={() => (renaming = null)}
		onDone={() => {
			renaming = null;
			void refresh();
		}}
	/>
{/if}

<style>
	.draft-banner {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 0 0 16px;
		padding: 8px 12px;
		border-radius: 3px;
		background-color: var(--ds-background-warning);
	}

	.draft-text {
		flex: 1;
	}

	.live-note {
		margin: 0 0 16px;
		color: var(--ds-text-subtle);
	}
</style>
