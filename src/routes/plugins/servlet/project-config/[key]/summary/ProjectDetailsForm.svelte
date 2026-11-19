<script lang="ts">
	import { enhance } from "$app/forms";
	import type { UserRef } from "#lib/api-types.ts";
	import Button from "#lib/components/Button.svelte";
	import { inputStyle, textareaStyle } from "#lib/admin/styles.ts";
	import UserSelect from "#lib/issue-form/UserSelect.svelte";

	interface Props {
		project: {
			name: string;
			description: string | null;
			lead: UserRef | null;
		};
	}

	let { project }: Props = $props();

	// svelte-ignore state_referenced_locally
	let name = $state(project.name);
	// svelte-ignore state_referenced_locally
	let description = $state(project.description ?? "");
	// svelte-ignore state_referenced_locally
	let lead = $state<UserRef | null>(project.lead);
	let saved = $state(false);
	let error = $state<string | null>(null);
	let saving = $state(false);
</script>

<section class="section">
	<h2>Details</h2>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	<div class="form-column">
		<form
			method="POST"
			use:enhance={() => {
				saving = true;
				error = null;
				return async ({ result, update }) => {
					saving = false;
					if (result.type === "failure") {
						error =
							String(
								(result.data as { error?: string } | undefined)?.error ??
									"Something went wrong",
							);
						saved = false;
					} else if (result.type === "success") {
						saved = true;
						error = null;
					}
					await update({ reset: false });
				};
			}}
		>
			<input type="hidden" name="intent" value="details" />
			<div class="field">
				<span class="field-label">Name</span>
				<input
					aria-label="Project name"
					name="name"
					bind:value={() => name, (value) => {
						name = value;
						saved = false;
					}}
					style={inputStyle}
				/>
			</div>
			<div class="field">
				<span class="field-label">Description</span>
				<textarea
					aria-label="Project description"
					name="description"
					bind:value={() => description, (value) => {
						description = value;
						saved = false;
					}}
					style={`${textareaStyle} min-height: 80px;`}
				></textarea>
			</div>
			<div class="field">
				<span class="field-label">Lead</span>
				<UserSelect
					label="Project lead"
					value={lead}
					onChange={(value) => {
						lead = value;
						saved = false;
					}}
					me={null}
				/>
				<input type="hidden" name="leadId" value={lead?.id ?? ""} />
			</div>
			<div class="save-row">
				<Button
					appearance="primary"
					type="submit"
					isLoading={saving}
					isDisabled={name.trim() === ""}
				>
					Save
				</Button>
				{#if saved}
					<span class="muted">Saved</span>
				{/if}
			</div>
		</form>
	</div>
</section>

<style>
	.section {
		margin-bottom: 32px;
	}

	h2 {
		margin: 0 0 12px;
		font-size: 20px;
		font-weight: 500;
	}

	.error {
		margin: 0 0 12px;
		color: #e5493a;
	}

	.form-column {
		max-width: 640px;
	}

	form {
		margin: 0;
	}

	.field {
		margin-bottom: 12px;
	}

	.field-label {
		display: block;
		margin-bottom: 4px;
		color: var(--ds-text-subtle);
		font-size: 12px;
		font-weight: 600;
	}

	.save-row {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.muted {
		color: var(--ds-text-subtle);
	}
</style>
