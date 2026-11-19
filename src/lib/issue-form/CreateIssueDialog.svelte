<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import { refreshAll } from "$app/navigation";
	import { page } from "$app/state";
	import { onMount, untrack } from "svelte";
	import { api } from "#lib/api.ts";
	import type {
		CustomFieldSpec,
		IssueDetail,
		ProjectDetail,
		ProjectSummary,
	} from "#lib/api-types.ts";
	import Modal from "#lib/components/Modal.svelte";
	import { isEditorEmpty } from "#lib/editor/editor-html.ts";
	import {
		recentProjects,
		rememberProject,
	} from "#lib/recent-projects.ts";
	import {
		fetchProject,
		fetchProjectCustomFields,
		fetchProjects,
	} from "./api.ts";
	import DialogFooter from "./DialogFooter.svelte";
	import IssueFields from "./IssueFields.svelte";
	import {
		customFieldBody,
		customFieldProblems,
		revealCustomFieldProblem,
	} from "./issue-values.ts";
	import { Loader } from "./loader.svelte.ts";
	import {
		emptyValues,
		errorMessage,
		parseLabels,
		type CreateDefaults,
		type IssueFormValues,
	} from "./types.ts";

	interface Props {
		defaults: CreateDefaults;
		onClose: () => void;
		onCreated: (key: string) => void;
	}

	let { defaults, onClose, onCreated }: Props = $props();

	function requestClose() {
		onClose();
	}

	let createAnother = $state(false);
	let formKey = $state(0);
	let error = $state<string | null>(null);
	let rememberedProject = $state("");
	let values = $state<IssueFormValues>(
		untrack(() => ({
			...emptyValues(defaults.projectKey ?? ""),
			typeId: defaults.typeId ?? "",
			parentKey: defaults.parent ?? "",
			epicKey: defaults.epic ?? "",
		})),
	);
	let customFieldErrors = $state<Record<string, string>>({});
	let typeChosen = $state(Boolean(untrack(() => defaults.typeId)));
	let priorityChosen = $state(false);
	let pending = $state(false);

	const projects = new Loader<ProjectSummary[]>();
	const project = new Loader<ProjectDetail>();
	const customFields = new Loader<CustomFieldSpec[]>();

	const me = $derived(page.data.user);
	const site = $derived(page.data.site);

	onMount(() => {
		void projects.run(fetchProjects);
		rememberedProject = recentProjects(me?.id ?? "")[0]?.key ?? "";
	});

	let permittedProjects = $derived(
		(projects.data ?? []).filter(
			(project) => project.permissions.CREATE_ISSUES === true,
		),
	);
	let effectiveProjectKey = $derived.by(() => {
		const list = permittedProjects;
		const chosen = values.projectKey;
		if (
			chosen !== "" &&
			(list.length === 0 || list.some((project) => project.key === chosen))
		) {
			return chosen;
		}
		return (
			list.find((project) => project.key === rememberedProject)?.key ??
			list[0]?.key ??
			""
		);
	});

	$effect(() => {
		const key = effectiveProjectKey;
		if (key === "") {
			project.reset();
			return;
		}
		void project.run(() => fetchProject(key));
	});

	let effectiveTypeId = $derived.by(() => {
		const detail = project.data;
		if (!detail) return values.typeId || defaults.typeId || "";
		if (
			typeChosen &&
			detail.issueTypes.some((type) => type.id === values.typeId)
		) {
			return values.typeId;
		}
		const siteType = site.defaultIssueTypeId
			? detail.issueTypes.find(
					(type) => type.id === site.defaultIssueTypeId,
				)
			: undefined;
		const fallbackType =
			(defaults.typeId
				? detail.issueTypes.find((type) => type.id === defaults.typeId)
				: undefined) ??
			(defaults.parent
				? detail.issueTypes.find((type) => type.subtask)
				: undefined) ??
			detail.issueTypes.find((type) => type.name === "Task") ??
			detail.issueTypes.find((type) => type.name === "Story") ??
			detail.issueTypes.find((type) => !type.subtask) ??
			detail.issueTypes[0];
		return (siteType ?? fallbackType)?.id ?? "";
	});

	let effectivePriorityId = $derived.by(() => {
		const detail = project.data;
		if (!detail) return values.priorityId;
		if (
			priorityChosen &&
			detail.priorities.some(
				(priority) => priority.id === values.priorityId,
			)
		) {
			return values.priorityId;
		}
		const sitePriority = site.defaultPriorityId
			? detail.priorities.find(
					(priority) => priority.id === site.defaultPriorityId,
				)
			: undefined;
		return (
			(
				sitePriority ??
				detail.priorities.find((priority) => priority.name === "Medium") ??
				detail.priorities[0]
			)?.id ?? ""
		);
	});

	let displayValues = $derived({
		...values,
		projectKey: effectiveProjectKey,
		typeId: effectiveTypeId,
		priorityId: effectivePriorityId,
	});

	$effect(() => {
		const key = effectiveProjectKey;
		const typeId = effectiveTypeId;
		if (key === "" || typeId === "") {
			customFields.reset();
			return;
		}
		void customFields.run(() => fetchProjectCustomFields(key, typeId));
	});

	function update(patch: Partial<IssueFormValues>) {
		if (patch.typeId !== undefined) typeChosen = true;
		if (patch.priorityId !== undefined) priorityChosen = true;
		if (
			patch.projectKey !== undefined &&
			patch.projectKey !== values.projectKey
		) {
			typeChosen = false;
			priorityChosen = false;
		}
		const current = values;
		const next = { ...current, ...patch };
		if (
			patch.projectKey !== undefined &&
			patch.projectKey !== current.projectKey
		) {
			next.typeId = "";
			next.priorityId = "";
			next.assignee = null;
			next.componentIds = [];
			next.fixVersionIds = [];
			next.epicKey = "";
			next.parentKey = "";
			next.customFields = {};
			const chosen = permittedProjects.find(
				(project) => project.key === patch.projectKey,
			);
			if (chosen && me) {
				rememberProject(me.id, {
					key: chosen.key,
					name: chosen.name,
					avatarUrl: chosen.avatarUrl,
				});
			}
		}
		if (patch.typeId !== undefined && patch.typeId !== current.typeId) {
			next.customFields = {};
		}
		values = next;
	}

	let selectedType = $derived(
		project.data?.issueTypes.find((type) => type.id === effectiveTypeId),
	);
	let missing = $derived(
		[
			displayValues.projectKey === "" && "Project",
			displayValues.typeId === "" && "Issue Type",
			displayValues.summary.trim() === "" && "Summary",
			selectedType?.subtask && displayValues.parentKey === "" && "Parent",
		].filter((item): item is string => Boolean(item)),
	);
	let loadError = $derived(
		projects.error
			? "Could not load the projects."
			: project.error
				? "Could not load the project."
				: customFields.error
					? "Could not load the custom fields."
					: null,
	);

	async function retry() {
		void projects.run(fetchProjects);
		if (effectiveProjectKey !== "") {
			void project.run(() => fetchProject(effectiveProjectKey));
		}
		if (effectiveProjectKey !== "" && effectiveTypeId !== "") {
			void customFields.run(() =>
				fetchProjectCustomFields(effectiveProjectKey, effectiveTypeId),
			);
		}
	}

	async function submit() {
		if (pending) return;
		if (missing.length > 0) {
			error = `Required: ${missing.join(", ")}.`;
			return;
		}
		const form = displayValues;
		const problems = customFieldProblems(
			customFields.data ?? [],
			form.customFields,
		);
		customFieldErrors = problems;
		revealCustomFieldProblem(problems);
		if (Object.keys(problems).length > 0) return;
		error = null;
		pending = true;
		try {
			const issue = await api<IssueDetail>("/api/issues", {
				method: "POST",
				body: JSON.stringify({
					project: form.projectKey,
					type: form.typeId,
					summary: form.summary.trim(),
					description: isEditorEmpty(form.description)
						? null
						: form.description,
					priority: form.priorityId || null,
					assignee: form.assignee?.id ?? null,
					labels: parseLabels(form.labels),
					components: form.componentIds,
					fixVersions: form.fixVersionIds,
					parent: selectedType?.subtask ? form.parentKey : null,
					epic: form.epicKey || null,
					customFields: customFieldBody(
						customFields.data ?? [],
						form.customFields,
					),
				}),
			});
			await refreshAll();
			onCreated(issue.key);
			if (createAnother) {
				values = {
					...values,
					summary: "",
					description: "",
					labels: "",
					customFields: {},
				};
				customFieldErrors = {};
				formKey += 1;
				error = null;
			} else {
				onClose();
			}
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			pending = false;
		}
	}

	const introStyle = `margin: 0 0 14px; color: ${token(
		"color.text.subtle",
	)}; font-size: 12px;`;
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
		bind:createAnother
		showCreateAnother
		submitLabel="Create"
		pending={pending}
		disabled={loadError !== null || projects.pending || project.pending ||
			customFields.pending}
		onSubmit={submit}
		onCancel={requestClose}
	/>
{/snippet}

<Modal title="Create Issue" width={810} onClose={requestClose} {footer}>
	<p style={introStyle}>Required fields are marked with an asterisk.</p>
	{#if error}
		<p style={errorStyle} role="alert">{error}</p>
	{/if}
	{#if loadError}
		<p style={errorStyle} role="alert">
			{loadError}
			<button type="button" class="retry" onclick={retry}>Try again</button>
		</p>
	{/if}
	{#key formKey}
		<IssueFields
			mode="create"
			projects={permittedProjects}
			project={project.data ?? null}
			values={displayValues}
			onChange={update}
			{me}
			customFields={customFields.data ?? []}
			{customFieldErrors}
		/>
	{/key}
</Modal>
