<script lang="ts">
	import { enhance } from "$app/forms";
	import { invalidate } from "$app/navigation";
	import { tick } from "svelte";
	import {
		isOptionType,
		type AdminFieldDetail,
		type FieldOption,
		type FieldOptionChild,
	} from "#lib/admin/custom-fields.ts";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import EmptyRow from "#lib/admin/EmptyRow.svelte";
	import ErrorText from "#lib/admin/ErrorText.svelte";
	import DeleteOptionDialog from "./DeleteOptionDialog.svelte";
	import OptionGroup from "./OptionGroup.svelte";

	interface Props {
		field: AdminFieldDetail;
	}

	let { field }: Props = $props();

	type DeleteTarget = { option: FieldOptionChild; parentId: string | null };

	let draft = $state("");
	let error = $state<string | null>(null);
	let pending = $state(false);
	let deleting = $state<DeleteTarget | null>(null);
	let form: HTMLFormElement | undefined = $state();

	let cascading = $derived(field.type === "cascading");
	let hasOptions = $derived(isOptionType(field.type));
	function failureMessage(data: unknown) {
		if (
			typeof data === "object" &&
			data !== null &&
			"error" in data &&
			typeof data.error === "string"
		) {
			return data.error;
		}
		return "Could not add the option";
	}

	async function submitPasted(event: ClipboardEvent) {
		const text = event.clipboardData?.getData("text") ?? "";
		if (!/[\r\n]/.test(text)) return;
		event.preventDefault();
		draft = text;
		await tick();
		form?.requestSubmit();
	}

	let siblings = $derived(
		deleting
			? deleting.parentId === null
				? field.options
				: (field.options.find((option) => option.id === deleting?.parentId)
						?.children ?? [])
			: [],
	);
</script>

{#if hasOptions}
	<section class="options-section">
		<h2 class="section-title">Options</h2>
		<p class="section-hint">
			Only enabled options can be chosen on an issue; a disabled option keeps
			the values already stored. Paste several lines to add them all at once.
		</p>
		<form
			bind:this={form}
			method="POST"
			class="add-option-form"
			use:enhance={({ cancel }) => {
				if (pending) {
					cancel();
					return;
				}
				pending = true;
				error = null;
				return async ({ result, update }) => {
					pending = false;
					if (result.type === "failure") {
						error = failureMessage(result.data);
						return;
					}
					if (result.type === "error") {
						error = "Could not add the option";
						return;
					}
					draft = "";
					await update({ reset: false });
					await invalidate("app:admin-fields");
				};
			}}
		>
			<input type="hidden" name="intent" value="addOption" />
			<input type="hidden" name="id" value={field.id} />
			<input type="hidden" name="parentOptionId" value="" />
			<input
				aria-label="Add option"
				placeholder="Add option"
				name="value"
				bind:value={draft}
				onpaste={(event) => void submitPasted(event)}
				style="{inputStyle} width: 320px;"
			/>
			<Button
				type="submit"
				isLoading={pending}
				isDisabled={pending || draft.trim() === ""}
			>
				Add
			</Button>
			{#if error}
				<ErrorText>{error}</ErrorText>
			{/if}
		</form>

		<table class="fat-table options-table">
			<thead>
				<tr>
					<th class="reorder-column" aria-label="Reorder"></th>
					<th>Value</th>
					<th class="state-column">State</th>
					<th class="actions-column">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#if field.options.length === 0}
					<EmptyRow columns={4}>
						This field has no options yet. Add the first one above.
					</EmptyRow>
				{/if}
				<OptionGroup
					fieldId={field.id}
					options={field.options}
					{cascading}
					onDelete={(option, parentId) => (deleting = { option, parentId })}
				/>
			</tbody>
		</table>
	</section>
{/if}

{#if deleting}
	<DeleteOptionDialog
		fieldId={field.id}
		option={deleting.option}
		parentId={deleting.parentId}
		siblings={siblings}
		onClose={() => (deleting = null)}
	/>
{/if}

<style>
	.options-section {
		margin-bottom: 32px;
	}

	.section-title {
		margin: 0 0 4px;
		font-size: 16px;
		font-weight: 600;
		line-height: 22px;
		color: var(--ds-text);
	}

	.section-hint {
		margin: 0 0 12px;
		font-size: 12px;
		color: var(--ds-text-subtle);
	}

	.add-option-form {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		margin: 0 0 12px;
	}

	.options-table {
		width: 100%;
	}

	.reorder-column {
		width: 92px;
	}

	.state-column {
		width: 130px;
	}

	.actions-column {
		width: 100px;
	}
</style>
