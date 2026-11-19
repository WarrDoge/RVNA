<script lang="ts">
	import type { FieldOptionChild } from "#lib/admin/custom-fields.ts";

	interface Props {
		option: FieldOptionChild;
		onToggle: (disabled: boolean) => Promise<void>;
	}

	let { option, onToggle }: Props = $props();

	let override = $state<boolean | null>(null);

	$effect(() => {
		option.disabled;
		override = null;
	});

	let disabled = $derived(override ?? option.disabled);
</script>

<label class="enabled-toggle">
	<input
		type="checkbox"
		aria-label={`Enable ${option.value}`}
		bind:checked={() => !disabled, (value) => {
			const next = !value;
			override = next;
			void onToggle(next).catch(() => {
				override = null;
			});
		}}
	/>
	{disabled ? "Disabled" : "Enabled"}
</label>

<style>
	.enabled-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}
</style>
