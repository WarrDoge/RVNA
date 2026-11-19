<script lang="ts">
	import { enhance } from "$app/forms";
	import { invalidate } from "$app/navigation";
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import Banner from "#lib/admin/Banner.svelte";
	import FormField from "#lib/components/FormField.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import IssueTypeIcon from "#lib/components/IssueTypeIcon.svelte";
	import PriorityIcon from "#lib/components/PriorityIcon.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let titleOverride = $state<{ base: string; value: string } | null>(null);
	let issueTypeOverride = $state<{ base: string; value: string } | null>(null);
	let priorityOverride = $state<{ base: string; value: string } | null>(null);
	let saved = $state(false);
	let error = $state<string | null>(null);
	let saveBusy = $state(false);

	let title = $derived(
		titleOverride?.base === data.settings.title
			? titleOverride.value
			: data.settings.title,
	);
	let issueTypeId = $derived(
		issueTypeOverride?.base === (data.settings.defaultIssueTypeId ?? "")
			? issueTypeOverride.value
			: (data.settings.defaultIssueTypeId ?? ""),
	);
	let priorityId = $derived(
		priorityOverride?.base === (data.settings.defaultPriorityId ?? "")
			? priorityOverride.value
			: (data.settings.defaultPriorityId ?? ""),
	);

	let trimmedTitle = $derived(title.trim());
	let titleError = $derived(
		trimmedTitle === ""
			? "The site title cannot be empty"
			: trimmedTitle.length > 100
				? "The site title cannot be longer than 100 characters"
				: null,
	);
	let currentType = $derived(
		data.issueTypes.find((issueType) => issueType.id === issueTypeId),
	);
	let currentPriority = $derived(
		data.priorities.find((priority) => priority.id === priorityId),
	);

	function errorMessage(cause: unknown) {
		return cause instanceof Error ? cause.message : "Something went wrong";
	}

	function edit() {
		saved = false;
		error = null;
	}
</script>

<AdminPage
	title="General configuration"
	description="The name of this site, its base URL, and the issue type and priority used as defaults when someone creates an issue."
>
	<form
		class="settings"
		method="POST"
		use:enhance={() => {
			saveBusy = true;
			error = null;
			return async ({ result, update }) => {
				saveBusy = false;
				if (result.type === "failure") {
					const failure = result.data as { error?: unknown } | null;
					saved = false;
					error =
						typeof failure?.error === "string"
							? failure.error
							: "Something went wrong";
					return;
				}
				if (result.type === "error") {
					saved = false;
					error = errorMessage(result.error);
					return;
				}
				error = null;
				await update({ reset: false });
				saved = true;
				await invalidate("app:admin-audit");
			};
		}}
	>
		{#if saved && !saveBusy}
			<Banner tone="success">General configuration saved.</Banner>
		{/if}
		{#if error}
			<Banner tone="danger">{error}</Banner>
		{/if}

		<dl class="details">
			<dt>Base URL</dt>
			<dd>
				<span class="mono">{data.settings.baseUrl}</span>
				<div class="hint">Set with the APP_URL environment variable.</div>
			</dd>
		</dl>

		<FormField
			label="Site title"
			htmlFor="site-title"
			required
			hint="Shown in the browser tab and in the title of every page."
			error={titleError}
		>
			{#snippet children(aria)}
			<input
				id="site-title"
				name="title"
				type="text"
				bind:value={() => title, (value) => {
					titleOverride = { base: data.settings.title, value };
					edit();
				}}
				maxlength={100}
				style={inputStyle} aria-describedby={aria.describedBy} aria-invalid={aria.invalid || undefined} aria-required={aria.required || undefined}/>
			{/snippet}
		</FormField>

		<FormField
			label="Default issue type"
			htmlFor="default-issue-type"
			hint="Pre-selected when someone creates an issue. Sub-tasks cannot be a default."
		>
			{#snippet children(aria)}
			<div class="select-row">
				{#if currentType}
					<IssueTypeIcon name={currentType.name} />
				{/if}
				<select
					id="default-issue-type"
					name="defaultIssueTypeId"
					bind:value={() => issueTypeId, (value) => {
						issueTypeOverride = {
							base: data.settings.defaultIssueTypeId ?? "",
							value,
						};
						edit();
					}}
					style="{inputStyle} flex: 1; min-width: 0; appearance: auto;" aria-describedby={aria.describedBy} aria-invalid={aria.invalid || undefined} aria-required={aria.required || undefined}>
					<option value="">No default</option>
					{#each data.issueTypes as issueType (issueType.id)}
						<option value={issueType.id}>{issueType.name}</option>
					{/each}
					{#if issueTypeId && !currentType}
						<option value={issueTypeId}>Unavailable issue type</option>
					{/if}
				</select>
			</div>
			{/snippet}
		</FormField>

		<FormField
			label="Default priority"
			htmlFor="default-priority"
			hint="Pre-selected when someone creates an issue."
		>
			{#snippet children(aria)}
			<div class="select-row">
				{#if currentPriority}
					<PriorityIcon name={currentPriority.name} />
				{/if}
				<select
					id="default-priority"
					name="defaultPriorityId"
					bind:value={() => priorityId, (value) => {
						priorityOverride = {
							base: data.settings.defaultPriorityId ?? "",
							value,
						};
						edit();
					}}
					style="{inputStyle} flex: 1; min-width: 0; appearance: auto;" aria-describedby={aria.describedBy} aria-invalid={aria.invalid || undefined} aria-required={aria.required || undefined}>
					<option value="">No default</option>
					{#each data.priorities as priority (priority.id)}
						<option value={priority.id}>{priority.name}</option>
					{/each}
					{#if priorityId && !currentPriority}
						<option value={priorityId}>Unavailable priority</option>
					{/if}
				</select>
			</div>
			{/snippet}
		</FormField>

		<div class="save-row">
			<Button
				type="submit"
				appearance="primary"
				isDisabled={titleError !== null || saveBusy}
				isLoading={saveBusy}
			>
				Save
			</Button>
		</div>
	</form>
</AdminPage>

<style>
	form {
		margin: 0;
		max-width: 720px;
	}

	.details {
		display: grid;
		grid-template-columns: 160px 1fr;
		row-gap: 12px;
		column-gap: 16px;
		margin: 0 0 24px;
		padding: 0 0 16px;
		border-bottom: 1px solid var(--ds-border);
	}

	dt {
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle);
	}

	dd {
		margin: 0;
		color: var(--ds-text);
		overflow-wrap: anywhere;
	}

	.mono {
		font-family: monospace;
	}

	.hint {
		margin-top: 4px;
		font-size: 12px;
		color: var(--ds-text-subtle);
	}

	.select-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.save-row {
		display: flex;
		align-items: center;
		gap: 12px;
	}
</style>
