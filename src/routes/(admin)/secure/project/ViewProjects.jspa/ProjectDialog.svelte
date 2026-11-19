<script lang="ts">
	import { untrack } from "svelte";
	import { enhance } from "$app/forms";
	import type { UserRef } from "#lib/api-types.ts";
	import FormField from "#lib/components/FormField.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Banner from "#lib/admin/Banner.svelte";
	import Button from "#lib/components/Button.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import UserSelect from "#lib/issue-form/UserSelect.svelte";
	import { projectKeyError, suggestProjectKey } from "./project-key.ts";
	import type { MeRef, ProjectSummary, ProjectType } from "./types.ts";

	interface Props {
		project: ProjectSummary | null;
		projects: ProjectSummary[];
		me: MeRef;
		onClose: () => void;
	}

	let { project, projects, me, onClose }: Props = $props();

	let name = $state(untrack(() => project?.name ?? ""));
	let key = $state(untrack(() => project?.key ?? ""));
	let keyTouched = $state(untrack(() => project !== null));
	let type = $state<ProjectType>(
		untrack(() => project?.type ?? "software"),
	);
	let lead = $state<UserRef | null>(
		untrack(() => project?.lead ?? null),
	);
	let leadTouched = $state(false);
	let template = $state("");
	let error = $state<string | null>(null);
	let busy = $state(false);
	let confirmingKey = $state(false);
	let keyConfirmed = false;
	let formElement: HTMLFormElement | null = $state(null);

	const formId = $props.id();

	let keyIssue = $derived(key === "" ? null : projectKeyError(key));
	let effectiveLead = $derived(
		project ? lead : leadTouched ? lead : (me as UserRef),
	);
	let keyChanged = $derived(project !== null && key !== project.key);
	let templates = $derived(
		projects.filter((row) => !row.archived && row.key !== project?.key),
	);

	function failureMessage(result: { data?: unknown }) {
		const data = result.data as { error?: unknown } | null;
		return typeof data?.error === "string"
			? data.error
			: "Something went wrong";
	}
</script>

{#snippet footer()}
	<Button
		type="submit"
		form={formId}
		appearance="primary"
		isLoading={busy}
		isDisabled={name.trim() === "" || keyIssue !== null}
	>
		{project ? "Save" : "Create"}
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal
	title={project ? "Edit project" : "Create project"}
	width={560}
	{onClose}
	{footer}
>
	{#if error}
		<Banner tone="danger">{error}</Banner>
	{/if}
	<form
		id={formId}
		bind:this={formElement}
		method="POST"
		use:enhance={({ cancel }) => {
			error = null;
			if (name.trim() === "" || keyIssue !== null) {
				cancel();
				return;
			}
			if (keyChanged && !keyConfirmed) {
				cancel();
				confirmingKey = true;
				return;
			}
			busy = true;
			return async ({ result, update }) => {
				busy = false;
				keyConfirmed = false;
				if (result.type === "failure") {
					error = failureMessage(result);
					return;
				}
				if (result.type === "error") {
					error = "Something went wrong";
					return;
				}
				await update();
				onClose();
			};
		}}
	>
		<input type="hidden" name="intent" value={project ? "update" : "create"} />
		{#if project}
			<input type="hidden" name="originalKey" value={project.key} />
		{/if}
		<input type="hidden" name="leadId" value={effectiveLead?.id ?? ""} />
		<FormField label="Name" htmlFor="project-name">
			<input
				id="project-name"
				name="name"
				value={name}
				oninput={(event) => {
					const value = event.currentTarget.value;
					name = value;
					if (!keyTouched) key = suggestProjectKey(value);
				}}
				style={inputStyle}
			/>
		</FormField>
		<FormField
			label="Key"
			htmlFor="project-key"
			hint={project
				? "The key is part of every issue key."
				: "A short prefix for issue keys, for example DEMO-1."}
			error={keyIssue}
		>
			{#snippet children(aria)}
			<input
				id="project-key"
				name="key"
				value={key}
				oninput={(event) => {
					keyTouched = true;
					key = event.currentTarget.value.toUpperCase();
				}}
				style="{inputStyle} width: 160px;" aria-describedby={aria.describedBy} aria-invalid={aria.invalid || undefined} aria-required={aria.required || undefined}/>
			{/snippet}
		</FormField>
		{#if keyChanged}
			<div class="key-warning">
				<Banner tone="warning">
					Issue keys change to {key || "…"}-1, {key || "…"}-2 and so on. Old
					links keep working: {project?.key} stays a previous key.
				</Banner>
			</div>
		{/if}
		<FormField label="Type" htmlFor="project-type">
			<select
				id="project-type"
				name="type"
				bind:value={type}
				style="{inputStyle} appearance: auto; padding-right: 4px;"
			>
				<option value="software">Software</option>
				<option value="service_desk">Service management</option>
			</select>
		</FormField>
		<FormField label="Lead" htmlFor="project-lead">
			<UserSelect
				id="project-lead"
				label="Project lead"
				value={effectiveLead}
				onChange={(value) => {
					leadTouched = true;
					lead = value;
				}}
				me={null}
			/>
		</FormField>
		{#if !project}
			<FormField
				label="Template"
				htmlFor="project-template"
				hint="Issue types, workflows and field configurations are copied; components, versions and issues are not."
			>
				{#snippet children(aria)}
				<select
					id="project-template"
					name="templateProjectKey"
					bind:value={template}
					style="{inputStyle} appearance: auto; padding-right: 4px;" aria-describedby={aria.describedBy} aria-invalid={aria.invalid || undefined} aria-required={aria.required || undefined}>
					<option value="">Default issue types and workflow</option>
					{#each templates as row (row.id)}
						<option value={row.key}>{row.key} — {row.name}</option>
					{/each}
				</select>
				{/snippet}
			</FormField>
		{/if}
	</form>
</Modal>

{#if confirmingKey}
	<ConfirmDialog
		title="Change project key"
		message={`Change the key from ${project?.key ?? ""} to ${key}? Every issue key changes to ${key}-1, ${key}-2 and so on. Old links keep working because ${project?.key ?? ""} stays a previous key.`}
		confirmLabel="Change key"
		onConfirm={() => {
			keyConfirmed = true;
			confirmingKey = false;
			formElement?.requestSubmit();
		}}
		onClose={() => (confirmingKey = false)}
	/>
{/if}

<style>
	form {
		margin: 0;
	}

	.key-warning {
		margin-bottom: 16px;
	}
</style>
