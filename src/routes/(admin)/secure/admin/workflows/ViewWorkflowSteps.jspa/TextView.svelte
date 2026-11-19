<script lang="ts">
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import Button from "#lib/components/Button.svelte";
	import EmptyRow from "#lib/admin/EmptyRow.svelte";
	import type {
		Definition,
		StatusCategory,
		WorkflowDetail,
		WorkflowStatus,
		WorkflowTransition,
	} from "#lib/workflow/types.ts";
	import AddStatusDialog from "./AddStatusDialog.svelte";
	import TransitionDialog from "./TransitionDialog.svelte";
	import { edits } from "./definition.ts";

	interface Props {
		detail: WorkflowDetail;
		busy: boolean;
		onChange: (
			apply: (definition: Definition) => Definition,
		) => Promise<boolean>;
		onRename: (status: WorkflowStatus) => void;
	}

	let { detail, busy, onChange, onRename }: Props = $props();

	const categoryLabel: Record<StatusCategory, string> = {
		new: "To Do",
		indeterminate: "In Progress",
		done: "Done",
	};
	const categoryAppearance = {
		new: "default",
		indeterminate: "inprogress",
		done: "success",
	} as const;

	let transitionDialog = $state<{
		transition: WorkflowTransition | null;
		from: string | null;
	} | null>(null);
	let addStatus = $state(false);
	let removing = $state<WorkflowStatus | null>(null);
	let deletingTransition = $state<WorkflowTransition | null>(null);

	let names = $derived(
		new Map(detail.statuses.map((status) => [status.id, status.name])),
	);

	function outgoing(statusId: string) {
		return detail.transitions.filter(
			(transition) => transition.fromStatusId === statusId,
		);
	}

	let fromAny = $derived(
		detail.transitions.filter((transition) => transition.fromStatusId === null),
	);

	function removalMessage(status: WorkflowStatus) {
		const touching = detail.transitions.filter(
			(transition) =>
				transition.fromStatusId === status.id ||
				transition.toStatusId === status.id,
		).length;
		const parts = [`Remove ${status.name} from this workflow?`];
		if (touching > 0) {
			parts.push(
				`The ${touching} ${touching === 1 ? "transition" : "transitions"} into and out of it are removed too.`,
			);
		}
		if (status.issueCount > 0) {
			parts.push(
				`${status.issueCount} ${status.issueCount === 1 ? "issue is" : "issues are"} in this status; you choose where to move them when you publish.`,
			);
		}
		parts.push("The change stays in the draft until you publish.");
		return parts.join(" ");
	}
</script>

<div class="toolbar">
	<Button onclick={() => (addStatus = true)} isDisabled={busy}>Add status</Button>
	<Button
		onclick={() => (transitionDialog = { transition: null, from: null })}
		isDisabled={busy || detail.statuses.length < 2}
	>
		Add transition
	</Button>
</div>

<table class="fat-table steps-table">
	<thead>
		<tr>
			<th>Step name (status)</th>
			<th>Category</th>
			<th>Outgoing transitions</th>
			<th>Actions</th>
		</tr>
	</thead>
	<tbody>
		{#if detail.statuses.length === 0}
			<EmptyRow columns={4}>
				This workflow has no statuses yet. Use Add status to pick the statuses
				issues can be in, then Add transition to connect them.
			</EmptyRow>
		{/if}
		{#each detail.statuses as status (status.id)}
			{@const isInitial = status.id === detail.initialStatusId}
			<tr class="step-row">
				<td>
					<div class="step-name">
						{status.name}
						{#if isInitial}
							<span class="initial"><Lozenge appearance="new">Initial</Lozenge></span>
						{/if}
					</div>
					<div class="issue-count">
						{status.issueCount}
						{status.issueCount === 1 ? "issue" : "issues"}
					</div>
				</td>
				<td>
					<Lozenge appearance={categoryAppearance[status.category]}>
						{categoryLabel[status.category]}
					</Lozenge>
				</td>
				<td>
					<div class="chips">
						{#each outgoing(status.id) as transition (transition.id)}
							<span class="chip">
								<span>
									{transition.name}
									<span aria-hidden="true">&rarr;</span>
									<strong>{names.get(transition.toStatusId) ?? ""}</strong>
									{#if transition.asksResolution}
										<span class="resolution" title="Asks for a resolution">
											(resolution)
										</span>
									{/if}
								</span>
								<button
									type="button"
									class="link-button"
									disabled={busy}
									onclick={() =>
										(transitionDialog = { transition, from: null })}
								>
									Edit
								</button>
								<button
									type="button"
									class="link-button danger"
									disabled={busy}
									onclick={() => (deletingTransition = transition)}
								>
									Delete
								</button>
							</span>
						{/each}
						{#if outgoing(status.id).length === 0}
							<span class="subtle">None</span>
						{/if}
					</div>
				</td>
				<td class="actions-cell">
					<button
						type="button"
						class="link-button"
						disabled={busy}
						onclick={() =>
							(transitionDialog = { transition: null, from: status.id })}
					>
						Add transition
					</button>
					{" | "}
					<button
						type="button"
						class="link-button"
						disabled={busy}
						onclick={() => onRename(status)}
					>
						Rename
					</button>
					{#if !isInitial}
						{" | "}
						<button
							type="button"
							class="link-button"
							disabled={busy}
							onclick={() =>
								onChange((definition) => edits.setInitial(definition, status.id))}
						>
							Set as initial
						</button>
					{/if}
					{" | "}
					<button
						type="button"
						class="link-button danger"
						disabled={busy}
						onclick={() => (removing = status)}
					>
						Remove from workflow
					</button>
				</td>
			</tr>
		{/each}
	</tbody>
</table>

<h2 class="any-heading">Transitions from any status</h2>
<p class="any-description">
	These transitions are available whatever status an issue is in.
</p>
<div class="chips">
	{#each fromAny as transition (transition.id)}
		<span class="chip">
			<span>
				{transition.name}
				<span aria-hidden="true">&rarr;</span>
				<strong>{names.get(transition.toStatusId) ?? ""}</strong>
				{#if transition.asksResolution}
					<span class="resolution" title="Asks for a resolution">
						(resolution)
					</span>
				{/if}
			</span>
			<button
				type="button"
				class="link-button"
				disabled={busy}
				onclick={() => (transitionDialog = { transition, from: null })}
			>
				Edit
			</button>
			<button
				type="button"
				class="link-button danger"
				disabled={busy}
				onclick={() => (deletingTransition = transition)}
			>
				Delete
			</button>
		</span>
	{/each}
	{#if fromAny.length === 0}
		<span class="subtle">None</span>
	{/if}
</div>

{#if transitionDialog}
	<TransitionDialog
		statuses={detail.statuses}
		transition={transitionDialog.transition}
		presetFrom={transitionDialog.from}
		onClose={() => (transitionDialog = null)}
		onSave={async (transition) => {
			if (
				await onChange((definition) =>
					edits.saveTransition(definition, transition),
				)
			) {
				transitionDialog = null;
			}
		}}
	/>
{/if}

{#if addStatus}
	<AddStatusDialog
		inWorkflow={new Set(detail.statuses.map((status) => status.id))}
		onClose={() => (addStatus = false)}
		onAddExisting={async (statusId) => {
			if (await onChange((definition) => edits.addStatus(definition, statusId))) {
				addStatus = false;
			}
		}}
	/>
{/if}

{#if removing}
	<ConfirmDialog
		title="Remove status from workflow"
		confirmLabel="Remove"
		message={removalMessage(removing)}
		pending={busy}
		onClose={() => (removing = null)}
		onConfirm={async () => {
			const status = removing;
			if (
				status &&
				(await onChange((definition) =>
					edits.removeStatus(definition, status.id),
				))
			) {
				removing = null;
			}
		}}
	/>
{/if}

{#if deletingTransition}
	<ConfirmDialog
		title="Delete transition"
		confirmLabel="Delete"
		message={`Delete the transition "${deletingTransition.name}"? The change stays in the draft until you publish.`}
		pending={busy}
		onClose={() => (deletingTransition = null)}
		onConfirm={async () => {
			const transition = deletingTransition;
			if (
				transition &&
				(await onChange((definition) =>
					edits.deleteTransition(definition, transition.id),
				))
			) {
				deletingTransition = null;
			}
		}}
	/>
{/if}

<style>
	.toolbar {
		display: flex;
		gap: 8px;
		margin-bottom: 12px;
	}

	.steps-table {
		width: 100%;
	}

	.step-row {
		vertical-align: top;
	}

	.step-name {
		font-weight: 600;
	}

	.initial {
		margin-left: 8px;
	}

	.issue-count {
		font-size: 12px;
		color: var(--ds-text-subtle);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px 4px 2px 8px;
		border-radius: 3px;
		background-color: var(--ds-background-neutral);
		font-size: 12px;
		line-height: 20px;
		white-space: nowrap;
	}

	.resolution {
		margin-left: 6px;
		color: var(--ds-text-subtle);
	}

	.subtle {
		color: var(--ds-text-subtle);
	}

	.actions-cell {
		white-space: nowrap;
	}

	.link-button {
		padding: 0;
		background: none;
		border: 0;
		font: inherit;
		cursor: pointer;
		color: var(--ds-link);
	}

	.link-button:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.link-button.danger {
		color: var(--ds-text-danger);
	}

	.any-heading {
		font-size: 16px;
		margin: 24px 0 8px;
	}

	.any-description {
		margin: 0 0 8px;
		color: var(--ds-text-subtle);
	}
</style>
