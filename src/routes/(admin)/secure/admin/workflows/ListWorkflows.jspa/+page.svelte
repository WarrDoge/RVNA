<script lang="ts">
	import { enhance } from "$app/forms";
	import { invalidate } from "$app/navigation";
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import Banner from "#lib/admin/Banner.svelte";
	import EmptyRow from "#lib/admin/EmptyRow.svelte";
	import ErrorText from "#lib/admin/ErrorText.svelte";
	import FormField from "#lib/components/FormField.svelte";
	import { inputStyle, textareaStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import { absoluteDate, relativeDate } from "#lib/dates.ts";
	import type { WorkflowSummary } from "#lib/workflow/types.ts";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	type Dialog = { kind: "add" } | { kind: "copy"; of: WorkflowSummary };

	let dialog = $state<Dialog | null>(null);
	let deleting = $state<WorkflowSummary | null>(null);
	let notice = $state<{ tone: "success" | "danger"; text: string } | null>(
		null,
	);
	let name = $state("");
	let description = $state("");
	let creating = $state(false);
	let createError = $state<string | null>(null);
	let deleteBusy = $state(false);
	let deleteForm = $state<HTMLFormElement | null>(null);

	function openAdd() {
		name = "";
		description = "";
		createError = null;
		dialog = { kind: "add" };
	}

	function openCopy(workflow: WorkflowSummary) {
		name = `Copy of ${workflow.name}`;
		description = workflow.description ?? "";
		createError = null;
		dialog = { kind: "copy", of: workflow };
	}

	function closeDialog() {
		if (creating) return;
		dialog = null;
	}

	function openDelete(workflow: WorkflowSummary) {
		deleting = workflow;
	}

	function closeDelete() {
		if (deleteBusy) return;
		deleting = null;
	}

	function submitDelete() {
		deleteForm?.requestSubmit();
	}

	async function afterDelete() {
		await invalidate("app:admin-workflows");
	}
</script>

<AdminPage
	title="Workflows"
	description="A workflow defines the statuses an issue moves through and the transitions between them. Changes to a workflow stay in a draft until you publish them."
>
	{#snippet actions()}
		<Button appearance="primary" onclick={openAdd}>Add workflow</Button>
	{/snippet}

	{#if notice}
		<Banner tone={notice.tone}>{notice.text}</Banner>
	{/if}

	<table class="fat-table workflow-table">
		<thead>
			<tr>
				<th>Name</th>
				<th>Status</th>
				<th>Used in projects</th>
				<th>Steps</th>
				<th>Last modified</th>
				<th>Actions</th>
			</tr>
		</thead>
		<tbody>
			{#if data.workflows.length === 0}
				<EmptyRow columns={6}>
					There are no workflows yet. Use Add workflow to create the first one.
				</EmptyRow>
			{/if}
			{#each data.workflows as workflow (workflow.id)}
				<tr>
					<td class="name-cell">
						<div class="workflow-name">
							<a
								href={`/secure/admin/workflows/ViewWorkflowSteps.jspa?workflowName=${encodeURIComponent(workflow.name)}&mode=text`}
							>
								{workflow.name}
							</a>
							{#if workflow.hasDraft}
								<span class="draft"><Lozenge appearance="moved">Draft</Lozenge></span>
							{/if}
						</div>
						{#if workflow.description}
							<div class="description">{workflow.description}</div>
						{/if}
					</td>
					<td>
						<Lozenge
							appearance={workflow.projects.length > 0 ? "success" : "default"}
						>
							{workflow.projects.length > 0 ? "Active" : "Inactive"}
						</Lozenge>
					</td>
					<td>
						{#if workflow.projects.length === 0}
							<span class="subtle">None</span>
						{:else}
							<ul class="used-in">
								{#each workflow.projects as project (project.id)}
									<li>
										<a
											href={`/plugins/servlet/project-config/${encodeURIComponent(project.key)}/workflows`}
											title={`Workflow scheme of ${project.name}`}
										>
											{project.name}
										</a>
										{#if project.issueTypes !== "all"}
											<span class="subtle issue-types">
												({project.issueTypes.map((type) => type.name).join(", ")})
											</span>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</td>
					<td>
						{workflow.statusCount}
						<span class="subtle">
							{workflow.statusCount === 1 ? "status" : "statuses"},{" "}
							{workflow.transitionCount}
							{workflow.transitionCount === 1 ? "transition" : "transitions"}
						</span>
					</td>
					<td title={absoluteDate(workflow.updatedAt)}>
						{relativeDate(workflow.updatedAt)}
					</td>
					<td class="actions-cell">
						<a
							href={`/secure/admin/workflows/ViewWorkflowSteps.jspa?workflowName=${encodeURIComponent(workflow.name)}&mode=text`}
						>
							Edit
						</a>
						{" | "}
						<button
							type="button"
							class="link-button"
							onclick={() => openCopy(workflow)}
						>
							Copy
						</button>
						{" | "}
						<button
							type="button"
							class="link-button"
							onclick={() => openDelete(workflow)}
						>
							Delete
						</button>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	{#if dialog}
		{@const copyOf = dialog.kind === "copy" ? dialog.of : null}
		{@const copyId = copyOf?.id ?? ""}
		<Modal
			title={copyOf ? "Copy workflow" : "Add workflow"}
			onClose={closeDialog}
		>
			{#snippet footer()}
				<Button
					appearance="primary"
					type="submit"
					form="workflow-create-form"
					isDisabled={name.trim() === "" || creating}
					isLoading={creating}
				>
					{copyOf ? "Copy" : "Add"}
				</Button>
				<Button appearance="subtle" onclick={closeDialog}>Cancel</Button>
			{/snippet}
			<form
				id="workflow-create-form"
				method="POST"
				action="?/create"
				use:enhance={({ cancel }) => {
					if (name.trim() === "") {
						createError = "Enter a workflow name";
						cancel();
						return;
					}
					creating = true;
					createError = null;
					return async ({ result, update }) => {
						if (result.type === "success") {
							const created = (result.data as { created?: WorkflowSummary })
								?.created;
							creating = false;
							dialog = null;
							notice = created
								? {
										tone: "success",
										text: `Created workflow ${created.name}.`,
									}
								: { tone: "success", text: "Workflow created." };
							await update({ reset: false });
							return;
						}
						creating = false;
						if (result.type === "failure") {
							const failure = result.data as { error?: unknown } | null;
							createError =
								typeof failure?.error === "string"
									? failure.error
									: "Could not create the workflow.";
							return;
						}
						createError = "Could not create the workflow.";
					};
				}}
			>
				<input type="hidden" name="copyFromId" value={copyId} />
				<FormField
					label="Workflow name"
					htmlFor="workflow-name"
					hint={copyOf
						? `Copies the statuses and transitions of ${copyOf.name}. Projects keep using the original.`
						: "Names are unique. Statuses and transitions are added in the editor."}
				>
					{#snippet children(aria)}
					<input
						id="workflow-name"
						name="name"
						style={inputStyle}
						bind:value={name}
						maxLength={255} aria-describedby={aria.describedBy} aria-invalid={aria.invalid || undefined} aria-required={aria.required || undefined}/>
					{/snippet}
				</FormField>
				<FormField label="Description" htmlFor="workflow-description">
					<textarea
						id="workflow-description"
						name="description"
						style={textareaStyle}
						bind:value={description}
						maxLength={2000}
					></textarea>
				</FormField>
				{#if createError}
					<ErrorText>{createError}</ErrorText>
				{/if}
				<button type="submit" hidden aria-label="Submit form"></button>
			</form>
		</Modal>
	{/if}

	{#if deleting}
		<form
			method="POST"
			action="?/delete"
			bind:this={deleteForm}
			hidden
			use:enhance={() => {
				deleteBusy = true;
						return async ({ result }) => {
					deleteBusy = false;
					const workflow = deleting;
					deleting = null;
					if (result.type === "success") {
						notice = workflow
							? {
									tone: "success",
									text: `Deleted workflow ${workflow.name}.`,
								}
							: { tone: "success", text: "Workflow deleted." };
						await afterDelete();
						return;
					}
					if (result.type === "failure") {
						const failure = result.data as { error?: unknown } | null;
						notice = {
							tone: "danger",
							text:
								typeof failure?.error === "string"
									? failure.error
									: "Could not delete the workflow.",
						};
						return;
					}
					notice = { tone: "danger", text: "Could not delete the workflow." };
				};
			}}
		>
			<input type="hidden" name="id" value={deleting.id} />
			<button type="submit" hidden aria-label="Submit form"></button>
		</form>
		<ConfirmDialog
			title="Delete workflow"
			message={`Delete the workflow ${deleting.name}? Its transitions and any draft are removed; the statuses stay.`}
			onConfirm={submitDelete}
			onClose={closeDelete}
			pending={deleteBusy}
		/>
	{/if}
</AdminPage>

<style>
	.workflow-table {
		width: 100%;
	}

	.name-cell {
		max-width: 360px;
	}

	.workflow-name {
		font-weight: 600;
	}

	.draft {
		margin-left: 8px;
	}

	.description {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.used-in {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.subtle {
		color: var(--ds-text-subtle);
	}

	.issue-types {
		font-size: 12px;
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

	.link-button:hover {
		text-decoration: underline;
	}

	form {
		margin: 0;
	}
</style>
