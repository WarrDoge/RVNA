<script lang="ts">
	import { onMount } from "svelte";
	import type { LinkType } from "#lib/api-types.ts";
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import { errorMessage } from "./panels-format.ts";

	interface Props {
		issueKey: string;
		onClose: () => void;
		onSaved: () => void | Promise<void>;
		onError: (message: string) => void;
	}

	let { issueKey, onClose, onSaved, onError }: Props = $props();

	let types = $state<LinkType[]>([]);
	let typeId = $state("");
	let direction = $state<"outward" | "inward">("outward");
	let targetKey = $state("");
	let error = $state<string | null>(null);
	let pending = $state(false);

	let selected = $derived(types.find((type) => type.id === typeId));

	onMount(async () => {
		try {
			types = await api<LinkType[]>("/api/link-types");
			if (typeId === "" && types.length > 0) typeId = types[0].id;
		} catch {
			// The dialog stays open with empty selects when the link types fail to load.
		}
	});

	async function submit() {
		if (pending) return;
		pending = true;
		error = null;
		try {
			await api(`/api/issues/${issueKey}/links`, {
				method: "POST",
				body: JSON.stringify({
					typeId,
					targetKey: targetKey.trim(),
					direction,
				}),
			});
			await onSaved();
			onClose();
		} catch (cause) {
			const message = errorMessage(cause);
			error = message;
			onError(message);
		} finally {
			pending = false;
		}
	}
</script>

{#snippet footer()}
	<Button
		appearance="primary"
		isLoading={pending}
		isDisabled={targetKey.trim() === "" || typeId === ""}
		onclick={submit}
	>
		Link
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal title="Link issue" width={480} {onClose} {footer}>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	<div class="field">
		<span class="label">Link type</span>
		<select
			aria-label="Link type"
			value={typeId}
			onchange={(event) => (typeId = event.currentTarget.value)}
		>
			{#each types as type (type.id)}
				<option value={type.id}>{type.name}</option>
			{/each}
		</select>
	</div>
	<div class="field">
		<span class="label">Direction</span>
		<select
			aria-label="Direction"
			value={direction}
			onchange={(event) =>
				(direction = event.currentTarget.value as "outward" | "inward")}
		>
			<option value="outward">
				This issue {selected?.outward ?? "links to"}
			</option>
			<option value="inward">
				This issue {selected?.inward ?? "is linked from"}
			</option>
		</select>
	</div>
	<div>
		<label for="link-target" class="label">Issue key</label>
		<input
			id="link-target"
			placeholder="DEMO-123"
			value={targetKey}
			onchange={(event) => (targetKey = event.currentTarget.value)}
			oninput={(event) => (targetKey = event.currentTarget.value)}
		/>
	</div>
</Modal>

<style>
	.error {
		color: #e5493a;
	}

	.field {
		margin-bottom: 12px;
	}

	.label {
		display: block;
		margin-bottom: 4px;
		color: var(--ds-text-subtle, #596773);
		font-size: 12px;
	}

	select,
	input {
		width: 100%;
		height: 32px;
		background: var(--ds-background-input, #f7f8f9);
		border: 1px solid var(--ds-border-input, #7d818a);
		border-radius: 3px;
		color: var(--ds-text, #172b4d);
	}

	input {
		padding: 0 8px;
	}
</style>
