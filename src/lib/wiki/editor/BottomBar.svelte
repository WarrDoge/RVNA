<script lang="ts">
	import Icon from "#lib/components/Icon.svelte";
	import Button from "#lib/components/Button.svelte";
	import type { SaveStatus } from "./edit-session.svelte.ts";
	import { formatClock, type RestrictionMode } from "./helpers.ts";

	interface Props {
		crumbs: string[];
		onlocation: () => void;
		restriction: RestrictionMode;
		onrestrictions: () => void;
		labelCount: number;
		onlabels: () => void;
		message: string;
		onmessage: (value: string) => void;
		notify: boolean;
		onnotify: (value: boolean) => void;
		status: SaveStatus;
		canPublish: boolean;
		publishing: boolean;
		onpublish: () => void;
		onclose: () => void;
	}

	let {
		crumbs,
		onlocation,
		restriction,
		onrestrictions,
		labelCount,
		onlabels,
		message,
		onmessage,
		notify,
		onnotify,
		status,
		canPublish,
		publishing,
		onpublish,
		onclose,
	}: Props = $props();

	const restrictionLabel: Record<RestrictionMode, string> = {
		none: "No restrictions",
		edit: "Editing restricted",
		view: "Viewing and editing restricted",
	};

	let restricted = $derived(restriction !== "none");
	let statusText = $derived(
		status.kind === "saving"
			? "Saving..."
			: status.kind === "saved"
				? `Draft saved at ${formatClock(status.at)}`
				: status.kind === "error"
					? "Draft not saved"
					: "",
	);
</script>

{#snippet pagesIcon()}
	<svg
		width="16"
		height="16"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></svg
	>
{/snippet}

{#snippet lockIcon(open: boolean)}
	<svg
		width="16"
		height="16"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<rect x="5" y="11" width="14" height="10" rx="2" />
		<path d={open ? "M8 11V7a4 4 0 0 1 7.5-2" : "M8 11V7a4 4 0 0 1 8 0v4"} />
	</svg>
{/snippet}

<div class="wed-bar">
	<div class="wed-bar-group">
		<button
			type="button"
			class="wed-chip-button"
			onclick={onlocation}
			aria-label="Change location"
			title="Change location"
		>
			{@render pagesIcon()}
			<span>{crumbs.join(" / ")}</span>
			<Icon name="chevron-down" size={16} />
		</button>
		<button
			type="button"
			class="wed-chip-button"
			data-active={restricted}
			onclick={onrestrictions}
			aria-label={`Restrictions: ${restrictionLabel[restriction]}`}
			title={restrictionLabel[restriction]}
		>
			{@render lockIcon(!restricted)}
		</button>
		<button
			type="button"
			class="wed-chip-button"
			onclick={onlabels}
			aria-label={`Labels (${labelCount})`}
			title="Labels"
		>
			<Icon name="tag" size={16} />
			{#if labelCount > 0}<span>{labelCount}</span>{/if}
		</button>
	</div>
	<input
		class="wed-input wed-bar-grow"
		aria-label="Version comment"
		placeholder="What did you change?"
		bind:value={() => message, (value) => onmessage(value)}
		maxlength={500}
	/>
	<label class="wed-check">
		<input
			type="checkbox"
			bind:checked={() => notify, (value) => onnotify(value)}
		/>
		Notify watchers
	</label>
	<span class="wed-bar-spacer"></span>
	<span
		class="wed-status"
		data-error={status.kind === "error"}
		role="status"
		aria-live="polite"
	>{statusText}</span
	>
	<Button
		appearance="primary"
		onclick={onpublish}
		isDisabled={!canPublish}
		isLoading={publishing}
	>
		Publish
	</Button>
	<Button onclick={onclose}>Close</Button>
</div>
