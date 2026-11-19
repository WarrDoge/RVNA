<script lang="ts">
	import { enhance } from "$app/forms";
	import { invalidate } from "$app/navigation";
	import { tick } from "svelte";
	import type { FieldOptionChild } from "#lib/admin/custom-fields.ts";
	import { errorMessage } from "#lib/admin/config.ts";
	import { createSortable } from "#lib/admin/sortable.svelte.ts";
	import { inputStyle } from "#lib/admin/styles.ts";
	import MoveButtons from "#lib/admin/MoveButtons.svelte";
	import Button from "#lib/components/Button.svelte";
	import { api } from "#lib/api.ts";
	import EnabledToggle from "./EnabledToggle.svelte";
	import InlineEditable from "./InlineEditable.svelte";

	interface Props {
		fieldId: string;
		parent: FieldOptionChild;
		options: FieldOptionChild[];
		onDelete: (option: FieldOptionChild, parentId: string) => void;
		onError: (message: string | null) => void;
	}

	let { fieldId, parent, options, onDelete, onError }: Props = $props();

	let adding = $state(false);
	let childDraft = $state("");
	let pending = $state(false);
	let form: HTMLFormElement | undefined = $state();
	let order = $state<FieldOptionChild[] | null>(null);
	let orderSeq = 0;
	let saveQueue: Promise<void> = Promise.resolve();

	let rows = $derived(order ?? options);

	function saveOrder(next: FieldOptionChild[]) {
		const seq = ++orderSeq;
		order = next;
		const run = saveQueue.then(async () => {
			try {
				await api(
					`/api/admin/custom-fields/${encodeURIComponent(fieldId)}/options/order`,
					{
						method: "PUT",
						body: JSON.stringify({
							parentOptionId: parent.id,
							ids: next.map((option) => option.id),
						}),
					},
				);
				if (seq !== orderSeq) return;
				onError(null);
				await Promise.all([
					invalidate("app:admin-field"),
					invalidate("app:admin-fields"),
				]);
				if (seq === orderSeq) order = null;
			} catch (cause) {
				if (seq !== orderSeq) return;
				order = null;
				onError(errorMessage(cause));
			}
		});
		saveQueue = run.catch(() => undefined);
		return run;
	}

	const sortable = createSortable(
		() => rows,
		(next) => void saveOrder(next),
	);

	async function rename(option: FieldOptionChild, value: string) {
		await api(
			`/api/admin/custom-fields/${encodeURIComponent(fieldId)}/options/${encodeURIComponent(option.id)}`,
			{ method: "PATCH", body: JSON.stringify({ value }) },
		);
		await Promise.all([
			invalidate("app:admin-field"),
			invalidate("app:admin-fields"),
		]);
	}

	async function setDisabled(option: FieldOptionChild, disabled: boolean) {
		try {
			await api(
				`/api/admin/custom-fields/${encodeURIComponent(fieldId)}/options/${encodeURIComponent(option.id)}`,
				{ method: "PATCH", body: JSON.stringify({ disabled }) },
			);
			onError(null);
			await Promise.all([
				invalidate("app:admin-field"),
				invalidate("app:admin-fields"),
			]);
		} catch (cause) {
			onError(errorMessage(cause));
			throw cause;
		}
	}

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
		childDraft = text;
		await tick();
		form?.requestSubmit();
	}
</script>

{#each rows as option, index (option.id)}
	<tr {@attach sortable.row(index)}>
		<td class="reorder-cell">
			<MoveButtons
				index={index}
				count={rows.length}
				onMove={(delta) => sortable.moveBy(index, delta)}
				label={option.value}
			/>
		</td>
		<td class="child-value-cell">
			<InlineEditable
				value={option.value}
				ariaLabel={`option ${option.value}`}
				onSave={(value) => rename(option, value)}
			>
				{#snippet display()}
					<span class:disabled={option.disabled}>{option.value}</span>
				{/snippet}
			</InlineEditable>
		</td>
		<td class="state-cell">
			<EnabledToggle
				{option}
				onToggle={(next) => setDisabled(option, next)}
			/>
		</td>
		<td class="actions-cell">
			<button
				type="button"
				class="danger-link"
				onclick={() => onDelete(option, parent.id)}
			>
				Delete
			</button>
		</td>
	</tr>
{/each}
<tr>
	<td colspan={4} class="add-child-cell">
		{#if adding}
			<form
				bind:this={form}
				method="POST"
				use:enhance={() => {
					pending = true;
					onError(null);
					return async ({ result, update }) => {
						pending = false;
						if (result.type === "failure") {
							onError(failureMessage(result.data));
							return;
						}
						if (result.type === "error") {
							onError("Could not add the option");
							return;
						}
						adding = false;
						childDraft = "";
						await update({ reset: false });
						await invalidate("app:admin-fields");
					};
				}}
			>
				<input type="hidden" name="intent" value="addOption" />
				<input type="hidden" name="id" value={fieldId} />
				<input type="hidden" name="parentOptionId" value={parent.id} />
				<div class="add-child-row">
					<input
						aria-label={`Add child of ${parent.value}`}
						placeholder="Add child option"
						name="value"
						bind:value={childDraft}
						onpaste={(event) => void submitPasted(event)}
						style="{inputStyle} width: 240px;"
					/>
					<Button
						type="submit"
						isLoading={pending}
						isDisabled={childDraft.trim() === ""}
					>
						Add child
					</Button>
					<Button appearance="subtle" onclick={() => (adding = false)}>
						Cancel
					</Button>
				</div>
			</form>
		{:else}
			<button
				type="button"
				class="link-button"
				onclick={() => {
					adding = true;
					childDraft = "";
				}}
			>
				Add child
			</button>
		{/if}
	</td>
</tr>
<style>
	.reorder-cell {
		width: 92px;
	}

	.child-value-cell {
		padding-left: 48px;
		border-left: 2px solid var(--ds-border);
	}

	.state-cell {
		width: 130px;
	}

	.actions-cell {
		width: 100px;
	}

	.add-child-cell {
		padding-left: 104px;
	}

	.add-child-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.link-button {
		padding: 0;
		background: transparent;
		border: 0;
		color: var(--ds-link);
		cursor: pointer;
		font-size: 14px;
	}

	.danger-link {
		padding: 0;
		background: transparent;
		border: 0;
		color: var(--ds-text-danger);
		cursor: pointer;
		font-size: 14px;
	}

	.disabled {
		color: var(--ds-text-subtle);
	}
</style>
