<script lang="ts">
	import { invalidate } from "$app/navigation";
	import { onMount } from "svelte";
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import type {
		ConfigCandidate,
		ConfigEntity,
		EntityReferences,
	} from "./config.ts";
	import { errorMessage } from "./config.ts";
	import ErrorText from "./ErrorText.svelte";

	interface Props {
		entity: ConfigEntity;
		itemId: string;
		itemName: string;
		noun: string;
		candidates: ConfigCandidate[];
		referenceLabel: (count: number) => string;
		migrationHint?: string;
		onClose: () => void;
	}

	let {
		entity,
		itemId,
		itemName,
		noun,
		candidates,
		referenceLabel,
		migrationHint = "Each issue keeps a history entry for the change.",
		onClose,
	}: Props = $props();

	let migrateTo = $state("");
	let error = $state<string | null>(null);
	let references = $state<EntityReferences | null>(null);
	let referencesError = $state<string | null>(null);
	let pending = $state(true);
	let removing = $state(false);

	onMount(() => {
		const controller = new AbortController();
		(async () => {
			try {
				references = await api<EntityReferences>(
					`/api/admin/${entity}/${itemId}/references`,
					{ signal: controller.signal },
				);
			} catch (cause) {
				if (!controller.signal.aborted) referencesError = errorMessage(cause);
			} finally {
				if (!controller.signal.aborted) pending = false;
			}
		})();
		return () => controller.abort();
	});

	let count = $derived(references?.count ?? 0);
	let workflows = $derived(references?.workflows ?? []);
	let blocked = $derived(references?.canMigrate === false);
	let needsMigration = $derived(references !== null && count > 0 && !blocked);
	let ready = $derived(
		references !== null &&
			!blocked &&
			(!needsMigration || migrateTo !== ""),
	);
	let headline = $derived.by(() => {
		if (blocked) {
			const names = workflows
				.map((workflow) => `"${workflow.name}"`)
				.join(", ");
			return `The ${noun} "${itemName}" is used by the ${workflows.length === 1 ? "workflow" : "workflows"} ${names}. Remove it from ${workflows.length === 1 ? "that workflow" : "those workflows"} before deleting it.`;
		}
		if (needsMigration) {
			return `${referenceLabel(count)}. Choose another ${noun} to move ${count === 1 ? "it" : "them"} to. ${migrationHint}`;
		}
		return `Delete the ${noun} "${itemName}"? This cannot be undone.`;
	});

	async function remove() {
		if (removing) return;
		removing = true;
		error = null;
		try {
			await api<void>(
				`/api/admin/${entity}/${itemId}${migrateTo ? `?migrateTo=${encodeURIComponent(migrateTo)}` : ""}`,
				{ method: "DELETE" },
			);
			onClose();
			await invalidate("app:admin-config");
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			removing = false;
		}
	}
</script>

{#snippet footer()}
	<Button
		appearance="danger"
		isLoading={removing}
		isDisabled={!ready}
		onclick={remove}
	>
		{needsMigration ? "Delete and migrate" : "Delete"}
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal title={`Delete ${noun}: ${itemName}`} {onClose} {footer}>
	{#if pending}
		<p class="delete-loading">Checking what still uses this {noun}…</p>
	{/if}
	{#if referencesError}
		<ErrorText>{referencesError}</ErrorText>
	{/if}
	{#if references}
		<p class="delete-headline">{headline}</p>
		{#if needsMigration}
			<label class="migrate-label" for="migrate-target">Migrate to</label>
			<select
				id="migrate-target"
				class="migrate-select"
				value={migrateTo}
				onchange={(event) => (migrateTo = event.currentTarget.value)}
			>
				<option value="">Choose another {noun}</option>
				{#each candidates as candidate (candidate.id)}
					<option value={candidate.id}>{candidate.name}</option>
				{/each}
			</select>
			{#if candidates.length === 0}
				<ErrorText>
					There is no other {noun} to move them to. Create one first.
				</ErrorText>
			{/if}
		{/if}
	{/if}
	{#if error}
		<ErrorText>{error}</ErrorText>
	{/if}
</Modal>

<style>
	.delete-loading {
		margin: 0;
		color: var(--ds-text-subtle);
	}

	.delete-headline {
		margin: 0 0 12px;
	}

	.migrate-label {
		display: block;
		margin-bottom: 4px;
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle);
	}

	.migrate-select {
		width: 100%;
		height: 32px;
		padding: 0 8px;
		background-color: var(--ds-background-input);
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text);
		font-size: 14px;
	}
</style>
