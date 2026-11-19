<script lang="ts">
	import { refreshAll } from "$app/navigation";
	import { page } from "$app/state";
	import { onMount, untrack } from "svelte";
	import { api } from "#lib/api.ts";
	import type {
		CustomFieldSpec,
		IssueDetail,
		ProjectDetail,
	} from "#lib/api-types.ts";
	import { parseDuration } from "#lib/dates.ts";
	import Modal from "#lib/components/Modal.svelte";
	import { isEditorEmpty } from "#lib/editor/editor-html.ts";
	import { fetchProject, fetchProjectCustomFields } from "./api.ts";
	import DialogFooter from "./DialogFooter.svelte";
	import IssueFields from "./IssueFields.svelte";
	import {
		changedCustomFieldBody,
		customFieldProblems,
		revealCustomFieldProblem,
	} from "./issue-values.ts";
	import { Loader } from "./loader.svelte.ts";
	import {
		errorMessage,
		fromIssue,
		parseLabels,
		type IssueFormValues,
	} from "./types.ts";

	interface Props {
		issue: IssueDetail;
		onClose: () => void;
		onSaved: (issue: IssueDetail) => void;
	}

	let { issue, onClose, onSaved }: Props = $props();

	function requestClose() {
		onClose();
	}

	let error = $state<string | null>(null);
	let values = $state<IssueFormValues>(untrack(() => fromIssue(issue)));
	let customFieldErrors = $state<Record<string, string>>({});
	let pending = $state(false);

	const project = new Loader<ProjectDetail>();
	const customFields = new Loader<CustomFieldSpec[]>();

	const me = $derived(page.data.user);

	onMount(() => {
		void project.run(() => fetchProject(issue.project.key));
		void customFields.run(() =>
			fetchProjectCustomFields(issue.project.key, issue.type.id),
		);
	});

	function update(patch: Partial<IssueFormValues>) {
		values = { ...values, ...patch };
	}

	let originalEstimate = $derived(
		values.originalEstimate.trim() === ""
			? null
			: parseDuration(values.originalEstimate),
	);
	let remainingEstimate = $derived(
		values.remainingEstimate.trim() === ""
			? null
			: parseDuration(values.remainingEstimate),
	);
	let storyPoints = $derived(
		values.storyPoints.trim() === "" ? null : Number(values.storyPoints),
	);
	let numbersValid = $derived(
		(originalEstimate !== null || values.originalEstimate.trim() === "") &&
			(remainingEstimate !== null || values.remainingEstimate.trim() === "") &&
			(storyPoints === null || Number.isFinite(storyPoints)),
	);


	async function submit() {
		if (pending) return;
		if (!numbersValid) {
			error = "Estimates and story points must be valid numbers.";
			return;
		}
		const problems = customFieldProblems(
			customFields.data ?? [],
			values.customFields,
		);
		customFieldErrors = problems;
		revealCustomFieldProblem(problems);
		if (Object.keys(problems).length > 0) return;
		error = null;
		pending = true;
		try {
			const updated = await api<IssueDetail>(
				`/api/issues/${encodeURIComponent(issue.key)}`,
				{
					method: "PATCH",
					body: JSON.stringify({
						summary: values.summary.trim(),
						description: isEditorEmpty(values.description)
							? null
							: values.description,
						priority: values.priorityId || null,
						assignee: values.assignee?.id ?? null,
						reporter: values.reporter?.id ?? null,
						labels: parseLabels(values.labels),
						components: values.componentIds,
						fixVersions: values.fixVersionIds,
						dueDate: values.dueDate || null,
						storyPoints,
						originalEstimate,
						remainingEstimate,
						epic: values.epicKey || null,
						customFields: changedCustomFieldBody(
							customFields.data ?? [],
							values.customFields,
						),
					}),
				},
			);
			await refreshAll();
			onSaved(updated);
			onClose();
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			pending = false;
		}
	}

	let loadError = $derived(
		project.error
			? "Could not load the project."
			: customFields.error
				? "Could not load the custom fields."
				: null,
	);

	const errorStyle = 'margin: 0 0 12px; color: #e5493a;';
</script>

<style>
	.retry {
		margin-left: 8px;
		padding: 0;
		background: transparent;
		border: 0;
		color: var(--ds-link, #0c66e4);
		cursor: pointer;
		font: inherit;
	}
</style>

{#snippet footer()}
	<DialogFooter
		submitLabel="Save"
		pending={pending}
		disabled={loadError !== null || project.pending || customFields.pending ||
			values.summary.trim() === "" || !numbersValid}
		onSubmit={submit}
		onCancel={requestClose}
	/>
{/snippet}

<Modal title="Edit Issue" width={810} onClose={requestClose} {footer}>
	{#if error}
		<p style={errorStyle} role="alert">{error}</p>
	{/if}
	{#if loadError}
		<p style={errorStyle} role="alert">
			{loadError}
			<button
				type="button"
				class="retry"
				onclick={() => {
					void project.run(() => fetchProject(issue.project.key));
					void customFields.run(() =>
						fetchProjectCustomFields(issue.project.key, issue.type.id),
					);
				}}>Try again</button
			>
		</p>
	{/if}
	<IssueFields
		mode="edit"
		projects={[issue.project]}
		project={project.data ?? null}
		{values}
		onChange={update}
		{me}
		excludeKey={issue.key}
		customFields={customFields.data ?? []}
		{customFieldErrors}
		canModifyReporter={issue.permissions.MODIFY_REPORTER === true}
	/>
</Modal>
