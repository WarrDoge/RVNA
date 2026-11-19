<script lang="ts">
	import { enhance } from "$app/forms";
	import type { Filter } from "#lib/api-types.ts";

	interface Props {
		filter: Filter;
		jql: string;
		columns: string[];
		disabled?: boolean;
	}

	let { filter, jql, columns, disabled = false }: Props = $props();

	let saved = $state(false);
	let pending = $state(false);
	let error = $state<string | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;

	function flashSaved() {
		saved = true;
		clearTimeout(timer);
		timer = setTimeout(() => (saved = false), 2000);
	}
</script>

<form
	method="POST"
	action="/issues/?/save"
	use:enhance={() => {
		pending = true;
		error = null;
		return async ({ result, update }) => {
			pending = false;
			if (result.type === "success") {
				flashSaved();
				await update();
				return;
			}
			if (result.type === "failure") {
				const failure = result.data as { error?: unknown } | null;
				error =
					typeof failure?.error === "string"
						? failure.error
						: "Could not save the filter";
				return;
			}
			if (result.type === "error") error = "Could not save the filter";
		};
	}}
>
	<input type="hidden" name="id" value={filter.id} />
	<input type="hidden" name="jql" value={jql} />
	<input type="hidden" name="columns" value={columns.join(",")} />
	<button type="submit" class="header-button" disabled={pending || disabled}>
		{saved ? "Saved" : "Save"}
	</button>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</form>

<style>
	form {
		display: inline;
		margin: 0;
		position: relative;
	}

	.header-button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 10px;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 14px;
		cursor: pointer;
	}

	.header-button:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.error {
		position: absolute;
		margin-top: 32px;
		padding: 4px 8px;
		background: var(--ds-surface-overlay, #22272b);
		color: #e5493a;
		font-size: 12px;
		white-space: nowrap;
	}
</style>
