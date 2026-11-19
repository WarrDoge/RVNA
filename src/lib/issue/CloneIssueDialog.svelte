<script lang="ts">
	import { goto } from "$app/navigation";
	import { api } from "#lib/api.ts";
	import type { IssueDetail } from "#lib/api-types.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	
	interface Props {
		issue: IssueDetail;
		onClose: () => void;
	}

	let { issue, onClose }: Props = $props();

	// svelte-ignore state_referenced_locally
	let summary = $state(`CLONE - ${issue.summary}`);
	let pending = $state(false);
	let error = $state<string | null>(null);
	let input = $state<HTMLInputElement>();

	$effect(() => {
		input?.focus();
	});

	function errorMessage(cause: unknown) {
		return cause instanceof Error ? cause.message : "Something went wrong";
	}

	async function create() {
		const next = summary.trim();
		if (next === "" || pending) return;
		pending = true;
		error = null;
		try {
			const created = await api<IssueDetail>(
				`/api/issues/${encodeURIComponent(issue.key)}/clone`,
				{ method: "POST", body: JSON.stringify({ summary: next }) },
			);
			onClose();
			await goto(`/browse/${created.key}`);
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			pending = false;
		}
	}
</script>

{#snippet footer()}
	<Button
		appearance="primary"
		onclick={create}
		isLoading={pending}
		isDisabled={summary.trim() === ""}
	>
		Create
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal title="Clone issue" width={520} {onClose} {footer}>
	<label for="clone-summary" class="label">Summary</label>
	<input
		id="clone-summary"
		bind:this={input}
		value={summary}
		oninput={(event) => (summary = event.currentTarget.value)}
		onkeydown={(event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				void create();
			}
		}}
		class="input"
	/>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</Modal>

<style>
	.label {
		display: block;
		margin-bottom: 4px;
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.input {
		width: 100%;
		height: 32px;
		padding: 0 8px;
		background: var(--ds-background-input);
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text);
	}

	.error {
		margin: 8px 0 0;
		color: #e5493a;
	}
</style>
