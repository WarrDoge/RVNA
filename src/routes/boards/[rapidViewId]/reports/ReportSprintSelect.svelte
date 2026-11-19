<script lang="ts">
	interface Props {
		sprints: { id: string; name: string; state: string }[];
		value: string | undefined;
		onChange: (value: string | undefined) => void;
	}

	let { sprints, value, onChange }: Props = $props();
</script>

<label class="control">
	<span class="label">Sprint</span>
	<select
		aria-label="Sprint"
		bind:value={() => value ?? "", (next) => onChange(next || undefined)}
	>
		<option value="">Latest sprint</option>
		{#each sprints as sprint (sprint.id)}
			<option value={sprint.id}>{sprint.name} ({sprint.state})</option>
		{/each}
	</select>
</label>

<style>
	.control {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.label {
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 12px;
	}

	select {
		height: 32px;
		padding: 0 8px;
		background-color: var(--ds-background-input, #1d2125);
		border: 1px solid var(--ds-border-input, #738496);
		border-radius: 3px;
		color: var(--ds-text, #cecfd2);
		font-size: 14px;
	}
</style>
