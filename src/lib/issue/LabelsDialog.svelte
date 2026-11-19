<script lang="ts">
	import { api } from "#lib/api.ts";
	import type { IssueDetail } from "#lib/api-types.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";

	interface Props {
		issue: IssueDetail;
		onClose: () => void;
		onChanged: () => Promise<void>;
		onError: (message: string) => void;
	}

	let { issue, onClose, onChanged, onError }: Props = $props();

	// svelte-ignore state_referenced_locally
	let value = $state(issue.labels.join(" "));
	let pending = $state(false);
	let error = $state<string | null>(null);
	let input = $state<HTMLInputElement>();

	$effect(() => {
		input?.focus();
	});

	function errorMessage(cause: unknown) {
		return cause instanceof Error ? cause.message : "Something went wrong";
	}

	async function save() {
		if (pending) return;
		error = null;
		pending = true;
		try {
			await api(`/api/issues/${encodeURIComponent(issue.key)}`, {
				method: "PATCH",
				body: JSON.stringify({
					labels: value
						.split(/[\s,]+/)
						.map((label) => label.trim())
						.filter(Boolean),
				}),
			});
			await onChanged();
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
	<Button appearance="primary" onclick={save} isLoading={pending}>Save</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal title="Labels" width={420} {onClose} {footer}>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	<label for="labels-input" class="label">Labels, separated by spaces</label>
	<input
		id="labels-input"
		bind:this={input}
		value={value}
		oninput={(event) => (value = event.currentTarget.value)}
		onkeydown={(event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				void save();
			}
		}}
		class="input"
	/>
</Modal>

<style>
	.error {
		margin: 0 0 12px;
		color: #e5493a;
	}

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
</style>
