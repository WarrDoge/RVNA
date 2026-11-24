<script lang="ts">
	import { enhance } from "$app/forms";
	import { goto, invalidate } from "$app/navigation";
	import { onMount } from "svelte";
	import Button from "#lib/components/Button.svelte";
	import Icon from "#lib/components/Icon.svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import RichTextEditor from "#lib/editor/RichTextEditor.svelte";
	import PortalBreadcrumb from "../../../../PortalBreadcrumb.svelte";
	import PortalCard from "../../../../PortalCard.svelte";
	import type { ActionData, PageData, SubmitFunction } from "./$types";

	let {
		data,
		form,
	}: {
		data: PageData;
		form: ActionData;
	} = $props();

	let values = $state<Record<string, string | string[]>>({});
	let files = $state<File[]>([]);
	let fileInput = $state<HTMLInputElement>();
	let busy = $state(false);
	let submitting = $state(false);
	let localError = $state<string | null>(null);

	let actionError = $derived(
		localError ?? (submitting ? null : (form?.error ?? null)),
	);

	function valueFor(fieldId: string): string | string[] {
		return values[fieldId] ?? "";
	}

	function stringValue(fieldId: string): string {
		const value = values[fieldId];
		return typeof value === "string" ? value : "";
	}

	function joinedValue(fieldId: string): string {
		const value = values[fieldId];
		return Array.isArray(value) ? value.join(", ") : (value ?? "");
	}

	function listValue(fieldId: string): string[] {
		const value = values[fieldId];
		return Array.isArray(value) ? value : [];
	}

	onMount(() => {
		// A file chosen before hydration never fired onchange; adopt it now.
		if (fileInput && files.length === 0) {
			files = Array.from(fileInput.files ?? []);
		}
	});

	function setValue(fieldId: string, value: string | string[]) {
		values = { ...values, [fieldId]: value };
	}

	function message(cause: unknown) {
		return cause instanceof Error ? cause.message : "Could not send the request";
	}

	const submit: SubmitFunction = ({ formData }) => {
		submitting = true;
		localError = null;
		busy = true;
		formData.delete("attachment");
		for (const file of files) formData.append("attachment", file, file.name);
		return async ({ result, update }) => {
			try {
				if (result.type === "success") {
					const { created, attachmentError } = (result.data ?? {}) as {
						created?: { id: string; key: string };
						attachmentError?: string | null;
					};
					if (!created) {
						await update();
						return;
					}
					await invalidate("app:portal").catch(() => undefined);
					const query = attachmentError
						? `?attachmentError=${encodeURIComponent(attachmentError)}`
						: "";
					await goto(
						`/servicedesk/customer/portal/${data.portalId}/${created.key}${query}`,
					);
					return;
				}
				await update();
				if (result.type === "error") {
					localError = "Could not send the request";
				}
			} catch (cause) {
				localError = message(cause);
			} finally {
				busy = false;
				submitting = false;
			}
		};
	};
</script>

<PageTitle title={data.form?.requestType.name ?? "New request"} />

{#if data.form}
	{@const requestType = data.form.requestType}
	{@const visible = data.form.fields.filter((field) => !field.hidden)}
	<PortalCard>
		<PortalBreadcrumb
			items={[
				{ label: "Help Center", href: "/servicedesk/customer/portals" },
				{ label: requestType.name },
			]}
		/>
		<h1 class="title">{requestType.name}</h1>
		{#if requestType.description}
			<p class="description">{requestType.description}</p>
		{/if}

		<form
			method="POST"
			enctype="multipart/form-data"
			class="request-form"
			use:enhance={submit}
			onsubmit={() => {
				submitting = true;
				localError = null;
			}}
		>
			{#if actionError}
				<p role="alert" class="error">{actionError}</p>
			{/if}

			{#each visible as field (field.fieldId)}
				<div class="field">
					{#if field.fieldId === "attachment"}
						<label for="portal-attachment" class="field-label">
							{field.label}
						</label>
						<label for="portal-attachment" class="file-label">
							<Icon name="attachment" size={14} />
							{files.length === 0
								? "Add files"
								: `${files.length} file${files.length === 1 ? "" : "s"} attached`}
						</label>
						<input
							id="portal-attachment"
							bind:this={fileInput}
							type="file"
							name="attachment"
							multiple
							required={field.required && files.length === 0}
							class="file-input"
							onchange={(event) => {
								files = Array.from(event.currentTarget.files ?? []);
								event.currentTarget.value = "";
							}}
						/>
						{#if files.length > 0}
							<ul class="file-list">
								{#each files as file (file.name)}
									<li>{file.name}</li>
								{/each}
							</ul>
						{/if}
						{#if field.description}
							<p class="field-help">{field.description}</p>
						{/if}
					{:else}
						<label for={`field-${field.fieldId}`} class="field-label">
							{field.label}
							{#if field.required}
								<span aria-hidden="true" title="Required" class="required">*</span>
							{/if}
						</label>
						{#if field.description && field.kind !== "rich"}
							<p class="field-help">{field.description}</p>
						{/if}

						{#if field.kind === "rich"}
							<input
								id={`field-${field.fieldId}`}
								type="hidden"
								name={field.fieldId}
								value={typeof valueFor(field.fieldId) === "string"
									? (valueFor(field.fieldId) as string)
									: ""}
							/>
							<div class="fat-editor editor">
								<RichTextEditor
									value={typeof valueFor(field.fieldId) === "string"
										? (valueFor(field.fieldId) as string)
										: ""}
									onChange={(html) => setValue(field.fieldId, html)}
									placeholder={field.description ?? "Describe the request"}
									minHeight={110}
									ariaLabel={field.label}
									ariaRequired={field.required}
								/>
							</div>
						{:else if field.kind === "option" || field.kind === "priority"}
							<select
								id={`field-${field.fieldId}`}
								name={field.fieldId}
								required={field.required}
								class="input"
								bind:value={() => stringValue(field.fieldId), (value) =>
									setValue(field.fieldId, value)}
							>
								<option value="">None</option>
								{#each field.options as option (option.id)}
									<option value={option.id}>{option.label}</option>
								{/each}
							</select>
						{:else if field.kind === "components" || field.kind === "array"}
							{#if field.arrayKind === "labels" || field.arrayKind === "text"}
								<input
									id={`field-${field.fieldId}`}
									name={field.fieldId}
									type="text"
									required={field.required}
									class="input"
									bind:value={() => joinedValue(field.fieldId), (value) =>
										setValue(field.fieldId, value)}
								/>
							{:else}
								<select
									id={`field-${field.fieldId}`}
									name={field.fieldId}
									multiple
									required={field.required}
									class="input"
									size={Math.min(6, Math.max(3, field.options.length))}
									bind:value={() => listValue(field.fieldId), (value) =>
										setValue(field.fieldId, value)}
								>
									{#each field.options as option (option.id)}
										<option value={option.id}>{option.label}</option>
									{/each}
								</select>
							{/if}
						{:else}
							<input
								id={`field-${field.fieldId}`}
								name={field.fieldId}
								required={field.required}
								type={field.kind === "date"
									? "date"
									: field.kind === "datetime"
										? "datetime-local"
										: "text"}
								class="input"
								bind:value={() => stringValue(field.fieldId), (value) =>
									setValue(field.fieldId, value)}
							/>
						{/if}
					{/if}
				</div>
			{/each}

			<div class="actions">
				<Button type="submit" appearance="primary" isLoading={busy}>Send</Button>
				<a
					href={`/servicedesk/customer/portal/${requestType.portalId}`}
					class="cancel"
				>
					Cancel
				</a>
			</div>
		</form>
	</PortalCard>
{/if}

<style>
	.title {
		margin: 0 0 8px;
		font-size: 24px;
		font-weight: 600;
		line-height: 28px;
	}

	.description {
		margin: 0 0 20px;
		color: var(--ds-text-subtle);
	}

	.request-form {
		margin: 0;
	}

	.error {
		color: #e5493a;
		margin-top: 0;
	}

	.field {
		margin-bottom: 18px;
	}

	.field-label {
		display: block;
		margin-bottom: 4px;
		font-size: 14px;
		font-weight: 600;
		color: var(--ds-text);
	}

	.required {
		color: #e5493a;
		margin-left: 4px;
	}

	.field-help {
		margin: 0 0 4px;
		font-size: 12px;
		color: var(--ds-text-subtle);
	}

	.input {
		width: 100%;
		min-height: 36px;
		padding: 6px 10px;
		background-color: var(--ds-background-input);
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text);
		font-size: 14px;
	}

	.file-label {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
		border: 1px dashed var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text-subtle);
		cursor: pointer;
	}

	.file-input {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}

	.file-list {
		margin: 6px 0 0;
		padding-left: 18px;
		color: var(--ds-text-subtle);
		font-size: 13px;
	}

	.actions {
		display: flex;
		gap: 8px;
		margin-top: 24px;
	}

	.cancel {
		display: inline-flex;
		align-items: center;
		padding: 0 12px;
		color: var(--ds-link);
		text-decoration: none;
	}

</style>
