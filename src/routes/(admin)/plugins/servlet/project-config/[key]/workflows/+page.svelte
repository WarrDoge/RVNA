<script lang="ts">
	import { enhance } from "$app/forms";
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import Banner from "#lib/admin/Banner.svelte";
	import EmptyRow from "#lib/admin/EmptyRow.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import type { Assignment, Needed } from "#lib/workflow/types.ts";
	import type { PageData } from "./$types";

	const DEFAULT_KEY = "default";
	const NO_WORKFLOW = "";

	let { data }: { data: PageData } = $props();

	type Choice = Record<string, string>;

	function initialChoice(assignment: Assignment): Choice {
		const choice: Choice = {
			[DEFAULT_KEY]: assignment.defaultWorkflowId ?? NO_WORKFLOW,
		};
		for (const row of assignment.perType) {
			choice[row.issueTypeId] = row.workflowId;
		}
		return choice;
	}

	const mappingKey = (item: Needed) => `${item.issueTypeId}:${item.statusId}`;

	/** Preselects the status of the same name, so renamed copies of a workflow need no clicks. */
	function suggestion(item: Needed) {
		return item.candidates.find((status) => status.name === item.statusName)?.id;
	}

	let assignment = $derived(data.assignment);
	let projectId = $derived(assignment.project.id);
	let choiceDraft = $state<{ projectId: string; value: Choice } | null>(null);
	let neededDraft = $state<{
		projectId: string;
		value: Needed[] | null;
	} | null>(null);
	let mappingDraft = $state<{
		projectId: string;
		needed: Needed[] | null;
		value: Record<string, string>;
	} | null>(null);
	let noticeState = $state<{ projectId: string; text: string } | null>(null);
	let errorState = $state<{ projectId: string; text: string } | null>(null);
	let saving = $state(false);

	let choice = $derived(
		choiceDraft?.projectId === projectId
			? choiceDraft.value
			: initialChoice(assignment),
	);
	let needed = $derived(
		neededDraft?.projectId === projectId ? neededDraft.value : null,
	);
	let mapping = $derived(
		mappingDraft?.projectId === projectId &&
			mappingDraft.needed === needed
			? mappingDraft.value
			: {},
	);
	let notice = $derived(
		noticeState?.projectId === projectId ? noticeState.text : null,
	);
	let error = $derived(
		errorState?.projectId === projectId ? errorState.text : null,
	);

	function setChoice(key: string, value: string) {
		choiceDraft = { projectId, value: { ...choice, [key]: value } };
		noticeState = null;
		errorState = null;
	}

	function setMapping(key: string, value: string) {
		mappingDraft = {
			projectId,
			needed,
			value: { ...mapping, [key]: value },
		};
		errorState = null;
	}

	function setNotice(text: string) {
		noticeState = { projectId, text };
		errorState = null;
	}

	function setError(text: string) {
		errorState = { projectId, text };
		noticeState = null;
	}

	function clearNeeded() {
		neededDraft = null;
		mappingDraft = null;
	}

	let rows = $derived([
		{
			key: DEFAULT_KEY,
			label: "Default (all other issue types)",
			empty: "No workflow",
		},
		...assignment.issueTypes.map((type) => ({
			key: type.id,
			label: type.name,
			empty: "Same as the default",
		})),
	]);

	let complete = $derived(
		needed !== null && needed.every((item) => mapping[mappingKey(item)]),
	);
	let total = $derived(
		(needed ?? []).reduce((sum, item) => sum + item.issueCount, 0),
	);

	function workflowName(id: string) {
		return assignment.workflows.find((workflow) => workflow.id === id)?.name;
	}

	function showNeeded(list: Needed[]) {
		neededDraft = { projectId, value: list };
		mappingDraft = {
			projectId,
			needed: list,
			value: Object.fromEntries(
				list.flatMap((item) => {
					const guess = suggestion(item);
					return guess ? [[mappingKey(item), guess]] : [];
				}),
			),
		};
		errorState = null;
	}
</script>

<AdminPage
	title="Workflows"
	description={`Choose the workflow each issue type follows in ${assignment.project.name}.`}
>
	{#snippet breadcrumb()}
		<a href="/secure/project/ViewProjects.jspa">Projects</a>
		{" / "}
		<a href={`/projects/${assignment.project.key}`}>{assignment.project.name}</a>
	{/snippet}

	{#if notice}
		<Banner tone="success">{notice}</Banner>
	{/if}
	{#if error}
		<Banner tone="danger">{error}</Banner>
	{/if}
	{#if assignment.workflows.length === 0}
		<Banner tone="warning">
			There are no workflows yet.{" "}
			<a href="/secure/admin/workflows/ListWorkflows.jspa">Create one first</a>.
		</Banner>
	{/if}

	<form
		method="POST"
		use:enhance={() => {
			saving = true;
			return async ({ result, update }) => {
				saving = false;
				if (result.type === "success") {
					const resultData = result.data as { moved?: number } | null;
					const moved = resultData?.moved ?? 0;
					clearNeeded();
					await update({ reset: false });
					choiceDraft = null;
					setNotice(
						moved > 0
							? `Workflows saved. ${moved} ${moved === 1 ? "issue was" : "issues were"} moved to their new status.`
							: "Workflows saved.",
					);
					return;
				}
				if (result.type === "failure") {
					const failure = result.data as {
						error?: unknown;
						needed?: unknown;
					} | null;
					if (Array.isArray(failure?.needed)) {
						showNeeded(failure.needed as Needed[]);
						return;
					}
					setError(
						typeof failure?.error === "string"
							? failure.error
							: "Could not save the workflows.",
					);
					return;
				}
				setError("Could not save the workflows.");
			};
		}}
	>
		<input
			type="hidden"
			name="defaultWorkflowId"
			value={choice[DEFAULT_KEY] ?? ""}
		/>
		{#each assignment.issueTypes as type (type.id)}
			<input
				type="hidden"
				name={`workflow:${type.id}`}
				value={choice[type.id] ?? ""}
			/>
		{/each}

		{#if needed}
			<Banner tone="warning">
				The new workflow does not have every status the existing issues are in.
				Choose a status for each group below; {total}
				{total === 1 ? "issue is" : "issues are"} moved when you confirm.
			</Banner>
			<table class="fat-table mapping-table">
				<thead>
					<tr>
						<th>Issue type</th>
						<th>Current status</th>
						<th>Issues</th>
						<th>Move to</th>
					</tr>
				</thead>
				<tbody>
					{#each needed as item (mappingKey(item))}
						<tr>
							<td>{item.issueTypeName}</td>
							<td>{item.statusName}</td>
							<td>{item.issueCount}</td>
							<td>
								{#if item.candidates.length === 0}
									<span class="danger-text">
										The new workflow has no statuses. Add some in the workflow
										editor first.
									</span>
								{:else}
									<select
										aria-label={`New status for ${item.issueTypeName} issues in ${item.statusName}`}
										style={inputStyle}
										name={`mapping:${mappingKey(item)}`}
										bind:value={() => mapping[mappingKey(item)] ?? "", (value) => {
											error = null;
											mapping = {
												...mapping,
												[mappingKey(item)]: value,
											};
										}}
									>
										<option value="">Select a status</option>
										{#each item.candidates as status (status.id)}
											<option value={status.id}>{status.name}</option>
										{/each}
									</select>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<div class="buttons">
				<Button
					appearance="primary"
					type="submit"
					isDisabled={!complete}
					isLoading={saving}
				>
					Confirm and migrate
				</Button>
				<Button appearance="subtle" onclick={clearNeeded}>Back</Button>
			</div>
		{:else}
			<table class="fat-table assignment-table">
				<thead>
					<tr>
						<th>Issue type</th>
						<th>Workflow</th>
					</tr>
				</thead>
				<tbody>
					{#if assignment.issueTypes.length === 0}
						<EmptyRow columns={2}>
							This project has no issue types, so only the default row applies.
						</EmptyRow>
					{/if}
					{#each rows as row (row.key)}
						{@const chosen = workflowName(choice[row.key] ?? "")}
						<tr>
							<td class:default-row={row.key === DEFAULT_KEY}>{row.label}</td>
							<td>
								<div class="workflow-choice">
									<select
										aria-label={`Workflow for ${row.label}`}
										style={`${inputStyle} max-width: 420px;`}
										bind:value={() => choice[row.key] ?? NO_WORKFLOW, (value) =>
											setChoice(row.key, value)}
									>
										<option value={NO_WORKFLOW}>{row.empty}</option>
										{#each assignment.workflows as workflow (workflow.id)}
											<option value={workflow.id}>{workflow.name}</option>
										{/each}
									</select>
									{#if chosen}
										<a
											href={`/secure/admin/workflows/ViewWorkflowSteps.jspa?workflowName=${encodeURIComponent(chosen)}&mode=text`}
										>
											Edit workflow
										</a>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<div class="buttons">
				<Button appearance="primary" type="submit" isLoading={saving}>
					Save
				</Button>
			</div>
		{/if}
	</form>
</AdminPage>

<style>
	.assignment-table {
		width: 100%;
		max-width: 720px;
	}

	.mapping-table {
		width: 100%;
		max-width: 840px;
	}

	.default-row {
		font-weight: 600;
	}

	.workflow-choice {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.buttons {
		display: flex;
		gap: 8px;
		margin-top: 16px;
	}

	.danger-text {
		color: var(--ds-text-danger);
	}

	form {
		margin: 0;
	}
</style>
