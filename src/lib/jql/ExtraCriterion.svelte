<script lang="ts">
	import Icon from "#lib/components/Icon.svelte";
	import {
		BASIC_NONE,
		type BasicCriterionId,
		type BasicQuery,
	} from "#lib/shared/jql/index.ts";
	import Picker from "./Picker.svelte";
	import RangePicker from "./RangePicker.svelte";
	import { suggestJqlValues } from "./suggest.ts";

	interface Props {
		id: BasicCriterionId;
		name: string;
		suggestField?: string;
		query: BasicQuery;
		patch: (next: Partial<BasicQuery>, run?: boolean) => void;
		onRemove: () => void;
	}

	let { id, name, suggestField, query, patch, onRemove }: Props = $props();

	let values = $state<string[]>([]);
	$effect(() => {
		if (!suggestField) {
			values = [];
			return;
		}
		let cancelled = false;
		suggestJqlValues(suggestField, "", 50)
			.then((result) => {
				if (!cancelled) values = result.values;
			})
			.catch(() => {
				if (!cancelled) values = [];
			});
		return () => {
			cancelled = true;
		};
	});

	let field = $derived(
		id as Exclude<BasicCriterionId, "text" | "created" | "updated">,
	);
	let extra = $derived(
		field === "resolution"
			? [
					{ label: "Unresolved", value: "Unresolved" },
					{ label: "None", value: BASIC_NONE },
				]
			: field === "assignee" || field === "reporter"
				? [
						{ label: "Current user", value: "currentUser()" },
						{ label: "None", value: BASIC_NONE },
					]
				: [{ label: "None", value: BASIC_NONE }],
	);
</script>

{#if id === "created" || id === "updated"}
	<div class="criterion">
		<RangePicker
			label={name}
			value={query[id]}
			onChange={(value) => patch({ [id]: value })}
		/>
		<button type="button" aria-label={`Remove ${name}`} onclick={onRemove} class="remove">
			<Icon name="close" size={12} />
		</button>
	</div>
{:else}
	<div class="criterion">
		<Picker
			label={name}
			value={query[field]}
			options={values}
			onChange={(value) => patch({ [field]: value })}
			none="Any"
			{extra}
		/>
		<button type="button" aria-label={`Remove ${name}`} onclick={onRemove} class="remove">
			<Icon name="close" size={12} />
		</button>
	</div>
{/if}

<style>
	.criterion {
		display: flex;
		align-items: flex-end;
		gap: 4px;
	}

	.remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		background: transparent;
		border: 0;
		color: var(--ds-text-subtle, #a9abaf);
		cursor: pointer;
	}
</style>
