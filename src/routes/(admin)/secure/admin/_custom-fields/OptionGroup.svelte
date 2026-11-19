<script lang="ts">
	import { invalidate } from "$app/navigation";
	import { api } from "#lib/api.ts";
	import type {
		FieldOption,
		FieldOptionChild,
	} from "#lib/admin/custom-fields.ts";
	import { errorMessage } from "#lib/admin/config.ts";
	import { createSortable } from "#lib/admin/sortable.svelte.ts";
	import ErrorText from "#lib/admin/ErrorText.svelte";
	import MoveButtons from "#lib/admin/MoveButtons.svelte";
	import ChildOptions from "./ChildOptions.svelte";
	import EnabledToggle from "./EnabledToggle.svelte";
	import InlineEditable from "./InlineEditable.svelte";

	interface Props {
		fieldId: string;
		options: FieldOption[];
		cascading: boolean;
		onDelete: (option: FieldOptionChild, parentId: string | null) => void;
	}

	let { fieldId, options, cascading, onDelete }: Props = $props();

	let error = $state<string | null>(null);
	let collapsed = $state<string[]>([]);
	let order = $state<FieldOption[] | null>(null);
	let orderSeq = 0;
	let saveQueue: Promise<void> = Promise.resolve();

	let rows = $derived(order ?? options);

	function saveOrder(next: FieldOption[]) {
		const seq = ++orderSeq;
		order = next;
		const run = saveQueue.then(async () => {
			try {
				await api(
					`/api/admin/custom-fields/${encodeURIComponent(fieldId)}/options/order`,
					{
						method: "PUT",
						body: JSON.stringify({
							parentOptionId: null,
							ids: next.map((option) => option.id),
						}),
					},
				);
				if (seq !== orderSeq) return;
				error = null;
				await Promise.all([
					invalidate("app:admin-field"),
					invalidate("app:admin-fields"),
				]);
				if (seq === orderSeq) order = null;
			} catch (cause) {
				if (seq !== orderSeq) return;
				order = null;
				error = errorMessage(cause);
			}
		});
		saveQueue = run.catch(() => undefined);
		return run;
	}

	const sortable = createSortable(
		() => rows,
		(next) => void saveOrder(next),
	);

	async function rename(option: FieldOption, value: string) {
		await api(
			`/api/admin/custom-fields/${encodeURIComponent(fieldId)}/options/${encodeURIComponent(option.id)}`,
			{ method: "PATCH", body: JSON.stringify({ value }) },
		);
		await Promise.all([
			invalidate("app:admin-field"),
			invalidate("app:admin-fields"),
		]);
	}

	async function setDisabled(option: FieldOption, disabled: boolean) {
		try {
			await api(
				`/api/admin/custom-fields/${encodeURIComponent(fieldId)}/options/${encodeURIComponent(option.id)}`,
				{ method: "PATCH", body: JSON.stringify({ disabled }) },
			);
			error = null;
			await Promise.all([
				invalidate("app:admin-field"),
				invalidate("app:admin-fields"),
			]);
		} catch (cause) {
			error = errorMessage(cause);
			throw cause;
		}
	}

	function toggleCollapsed(option: FieldOption) {
		collapsed = collapsed.includes(option.id)
			? collapsed.filter((id) => id !== option.id)
			: [...collapsed, option.id];
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
		<td class="value-cell">
			<InlineEditable
				value={option.value}
				ariaLabel={`option ${option.value}`}
				onSave={(value) => rename(option, value)}
			>
				{#snippet display()}
					<span class:disabled={option.disabled}>{option.value}</span>
				{/snippet}
			</InlineEditable>
			{#if cascading && option.children.length > 0}
				<div class="collapse-row">
					<button
						type="button"
						class="link-button small"
						onclick={() => toggleCollapsed(option)}
					>
						{collapsed.includes(option.id)
							? `Show ${option.children.length} child option${option.children.length === 1 ? "" : "s"}`
							: "Hide children"}
					</button>
				</div>
			{/if}
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
				onclick={() => onDelete(option, null)}
			>
				Delete
			</button>
		</td>
	</tr>
	{#if cascading && !collapsed.includes(option.id)}
		<ChildOptions
			{fieldId}
			parent={option}
			options={option.children}
			onDelete={(child, parentId) => onDelete(child, parentId)}
			onError={(message) => (error = message)}
		/>
	{/if}
{/each}
{#if error}
	<tr>
		<td colspan={4}>
			<ErrorText>{error}</ErrorText>
		</td>
	</tr>
{/if}

<style>
	.reorder-cell {
		width: 92px;
	}

	.value-cell {
		padding-left: 12px;
	}

	.state-cell {
		width: 130px;
	}

	.actions-cell {
		width: 100px;
	}

	.collapse-row {
		margin-top: 2px;
	}

	.link-button {
		padding: 0;
		background: transparent;
		border: 0;
		color: var(--ds-link);
		cursor: pointer;
		font-size: 14px;
	}

	.link-button.small {
		font-size: 12px;
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
