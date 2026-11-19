<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type {
		CustomFieldSpec,
		IssueTypeRef,
		Me,
		ProjectDetail,
	} from "#lib/api-types.ts";
	import IssueTypeIcon from "#lib/components/IssueTypeIcon.svelte";
	import RichTextEditor from "#lib/editor/RichTextEditor.svelte";
	import FieldValueEditor from "./FieldValueEditor.svelte";
	import FormRow from "./FormRow.svelte";
	import IssueKeyPicker from "./IssueKeyPicker.svelte";
	import LabelInput from "./LabelInput.svelte";
	import MultiSelect from "./MultiSelect.svelte";
	import { parseLabels, type IssueFormValues } from "./types.ts";
	import { inputStyle, selectStyle } from "./styles.ts";
	import UserSelect from "./UserSelect.svelte";

	interface Props {
		mode: "create" | "edit";
		projects: { key: string; name: string }[];
		project: ProjectDetail | null;
		values: IssueFormValues;
		onChange: (patch: Partial<IssueFormValues>) => void;
		me: Me | null;
		excludeKey?: string;
		customFields: CustomFieldSpec[];
		customFieldErrors: Record<string, string>;
		canModifyReporter?: boolean;
	}

	let {
		mode,
		projects,
		project,
		values,
		onChange,
		me,
		excludeKey,
		customFields,
		customFieldErrors,
		canModifyReporter = false,
	}: Props = $props();

	let selectedType: IssueTypeRef | undefined = $derived(
		project?.issueTypes.find((type) => type.id === values.typeId),
	);
	let canAssign = $derived(project?.permissions.ASSIGN_ISSUES === true);
	let labels = $derived(parseLabels(values.labels));

	const gridStyle =
		"display: grid; grid-template-columns: 140px minmax(0, 1fr); row-gap: 10px; column-gap: 12px;";
	const typeRowStyle = "display: flex; align-items: center; gap: 8px;";
	const customHeadingStyle = `grid-column: 1 / -1; margin-top: 6px; padding-top: 10px; border-top: 1px solid ${token(
		"color.border",
	)}; font-size: 12px; font-weight: 600; color: ${token("color.text.subtle")};`;
	const customErrorStyle = "margin-top: 4px; font-size: 12px; color: #e5493a;";
</script>

<div style={gridStyle}>
	<FormRow label="Project" required>
		<select
			aria-label="Project"
			value={values.projectKey}
			disabled={mode === "edit"}
			onchange={(event) =>
				onChange({ projectKey: event.currentTarget.value })}
			style={selectStyle}
		>
			<option value="">Select a project</option>
			{#each projects as item (item.key)}
				<option value={item.key}>{item.name} ({item.key})</option>
			{/each}
		</select>
	</FormRow>

	<FormRow label="Issue Type" required>
		<div style={typeRowStyle}>
			{#if selectedType}
				<span aria-hidden="true" style="display: inline-flex;">
					<IssueTypeIcon
						decorative
						id={selectedType.id}
						name={selectedType.name}
						icon={selectedType.iconUrl}
					/>
				</span>
			{/if}
			<select
				aria-label="Issue Type"
				value={values.typeId}
				disabled={mode === "edit"}
				onchange={(event) => onChange({ typeId: event.currentTarget.value })}
				style={`${selectStyle} flex: 1;`}
			>
				<option value="">Select an issue type</option>
				{#each project?.issueTypes ?? [] as type (type.id)}
					<option value={type.id}>{type.name}</option>
				{/each}
			</select>
		</div>
	</FormRow>

	{#if mode === "create" && selectedType?.subtask}
		<FormRow
			label="Parent"
			required
			hint="Sub-tasks must be attached to an issue in the same project."
		>
			<IssueKeyPicker
				label="Parent"
				projectKey={values.projectKey}
				jql="issuetype in standardIssueTypes()"
				value={values.parentKey}
				{excludeKey}
				onChange={(parentKey) => onChange({ parentKey })}
			/>
		</FormRow>
	{/if}

	<FormRow label="Summary" required>
		{#snippet children({ id, describedBy })}
			<input
				{id}
				aria-describedby={describedBy}
				aria-label="Summary"
				value={values.summary}
				oninput={(event) => onChange({ summary: event.currentTarget.value })}
				style={inputStyle}
			/>
		{/snippet}
	</FormRow>

	<FormRow label="Description">
		<RichTextEditor
			value={values.description}
			onChange={(description) => onChange({ description })}
			placeholder="Describe the issue…"
			minHeight={140}
		/>
	</FormRow>

	<FormRow label="Priority">
		<select
			aria-label="Priority"
			value={values.priorityId}
			onchange={(event) => onChange({ priorityId: event.currentTarget.value })}
			style={selectStyle}
		>
			<option value="">None</option>
			{#each project?.priorities ?? [] as priority (priority.id)}
				<option value={priority.id}>{priority.name}</option>
			{/each}
		</select>
	</FormRow>

	{#if canAssign}
		<FormRow label="Assignee">
			<UserSelect
				label="Assignee"
				value={values.assignee}
				onChange={(assignee) => onChange({ assignee })}
				{me}
				allowMe
			/>
		</FormRow>
	{/if}

	{#if mode === "edit"}
		<FormRow label="Reporter">
			{#if canModifyReporter}
				<UserSelect
					label="Reporter"
					value={values.reporter}
					onChange={(reporter) => onChange({ reporter })}
					{me}
				/>
			{:else}
				<input
					aria-label="Reporter"
					value={values.reporter?.displayName ?? ""}
					readonly
					style={inputStyle}
				/>
			{/if}
		</FormRow>
	{/if}

	<FormRow label="Labels">
		<LabelInput
			value={values.labels}
			onChange={(next) => onChange({ labels: next })}
		/>
	</FormRow>

	<FormRow label="Components">
		<MultiSelect
			label="Components"
			options={project?.components ?? []}
			selected={values.componentIds}
			onChange={(componentIds) => onChange({ componentIds })}
		/>
	</FormRow>

	<FormRow label="Fix versions">
		<MultiSelect
			label="Fix versions"
			options={project?.versions ?? []}
			selected={values.fixVersionIds}
			onChange={(fixVersionIds) => onChange({ fixVersionIds })}
		/>
	</FormRow>

	<FormRow label="Epic Link">
		<IssueKeyPicker
			label="Epic Link"
			projectKey={values.projectKey}
			jql="issuetype = Epic"
			value={values.epicKey}
			{excludeKey}
			onChange={(epicKey) => onChange({ epicKey })}
		/>
	</FormRow>

	{#if mode === "edit"}
		<FormRow label="Due date">
			<input
				aria-label="Due date"
				type="date"
				value={values.dueDate}
				oninput={(event) => onChange({ dueDate: event.currentTarget.value })}
				style={inputStyle}
			/>
		</FormRow>
		<FormRow label="Story points">
			<input
				aria-label="Story points"
				type="number"
				min="0"
				step="0.5"
				value={values.storyPoints}
				oninput={(event) =>
					onChange({ storyPoints: event.currentTarget.value })}
				style={inputStyle}
			/>
		</FormRow>
		<FormRow
			label="Original estimate"
			hint="For example 2h 30m. Leave empty to clear it."
		>
			<input
				aria-label="Original estimate"
				value={values.originalEstimate}
				oninput={(event) =>
					onChange({ originalEstimate: event.currentTarget.value })}
				style={inputStyle}
			/>
		</FormRow>
		<FormRow
			label="Remaining estimate"
			hint="For example 1h. Leave empty to clear it."
		>
			<input
				aria-label="Remaining estimate"
				value={values.remainingEstimate}
				oninput={(event) =>
					onChange({ remainingEstimate: event.currentTarget.value })}
				style={inputStyle}
			/>
		</FormRow>
	{/if}

	{#if customFields.length > 0}
		<div style={customHeadingStyle}>Additional fields</div>
	{/if}
	{#each customFields as field (field.id)}
		<FormRow
			label={field.name}
			required={field.required}
			hint={field.description ?? undefined}
			anchorId={`custom-field-${field.id}`}
		>
			<FieldValueEditor
				field={field}
				value={values.customFields[field.id]}
				onChange={(value) =>
					onChange({
						customFields: { ...values.customFields, [field.id]: value },
					})}
				{me}
			/>
			{#if customFieldErrors[field.id]}
				<div role="alert" style={customErrorStyle}>
					{customFieldErrors[field.id]}
				</div>
			{/if}
		</FormRow>
	{/each}
</div>
