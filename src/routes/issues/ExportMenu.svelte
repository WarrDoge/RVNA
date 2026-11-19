<script lang="ts">
	import type { CustomFieldColumn } from "#lib/api-types.ts";
	import Icon from "#lib/components/Icon.svelte";
	import { dismiss } from "#lib/components/dismiss.ts";
	import { SYSTEM_FIELDS } from "#lib/shared/fields.ts";

	interface Props {
		jql: string;
		columns: string[];
		customFields: CustomFieldColumn[];
		name: string;
	}

	let { jql, columns, customFields, name }: Props = $props();

	let open = $state(false);
	let pending = $state(false);
	let error = $state<string | null>(null);

	let allColumns = $derived([
		...SYSTEM_FIELDS.map((field) => field.id),
		...customFields.map((field) => field.id),
	]);

	async function errorText(response: Response) {
		const text = await response.text();
		try {
			const body = JSON.parse(text) as { error?: unknown; message?: unknown };
			if (typeof body.error === "string") return body.error;
			if (typeof body.message === "string") return body.message;
		} catch {
			// Not JSON; show the server text if it is short enough to be a message.
		}
		const trimmed = text.trim();
		return trimmed === "" ? "Export failed" : trimmed.slice(0, 300);
	}

	async function download(selected: string[]) {
		pending = true;
		error = null;
		try {
			const url = `/api/search/export?jql=${encodeURIComponent(jql)}&columns=${encodeURIComponent(selected.join(","))}&name=${encodeURIComponent(name)}`;
			const response = await fetch(url);
			if (!response.ok) {
				error = await errorText(response);
				return;
			}
			const objectUrl = URL.createObjectURL(await response.blob());
			const anchor = document.createElement("a");
			anchor.href = objectUrl;
			anchor.download = `${name}.csv`;
			document.body.append(anchor);
			anchor.click();
			anchor.remove();
			window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
			open = false;
		} catch {
			error = "Export failed";
		} finally {
			pending = false;
		}
	}
</script>

<div class="root" {@attach dismiss(() => open, () => (open = false))}>
	<button
		type="button"
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={() => (open = !open)}
		class="header-button"
	>
		<Icon name="export" size={14} /> Export <Icon name="chevron-down" />
	</button>
	{#if open}
		<div role="menu" aria-label="Export" class="menu">
			<button
				type="button"
				role="menuitem"
				class="fat-menu-item"
				disabled={pending}
				onclick={() => void download(columns)}
			>
				CSV (current columns)
			</button>
			<button
				type="button"
				role="menuitem"
				class="fat-menu-item"
				disabled={pending}
				onclick={() => void download(allColumns)}
			>
				CSV (all fields)
			</button>
		</div>
	{/if}
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</div>

<style>
	.root {
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

	.menu {
		position: absolute;
		right: 0;
		top: 34px;
		z-index: 100;
		min-width: 220px;
		padding-block: 4px;
		background-color: var(--ds-surface-overlay, #22272b);
		border: 1px solid var(--ds-border, #3b3d42);
		border-radius: 3px;
		box-shadow: var(--ds-shadow-overlay, 0 8px 12px #1e1f2126);
	}

	.error {
		position: absolute;
		right: 0;
		top: 34px;
		z-index: 110;
		max-width: 320px;
		margin: 0;
		padding: 6px 8px;
		background: var(--ds-surface-overlay, #22272b);
		border: 1px solid #e5493a;
		border-radius: 3px;
		color: #e5493a;
		font-size: 12px;
	}
</style>
