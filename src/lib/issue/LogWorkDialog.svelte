<script lang="ts">
	import { invalidate } from "$app/navigation";
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import { parseDuration } from "#lib/dates.ts";
	import { errorMessage } from "./activity-utils.ts";

	interface Props {
		issueKey: string;
		onClose: () => void;
		onSaved?: () => Promise<void> | void;
		onError?: (message: string) => void;
		data?: unknown;
	}

	let { issueKey, onClose, onSaved, onError }: Props = $props();

	let timeSpent = $state("");
	let started = $state(defaultStarted());
	let comment = $state("");
	let remaining = $state("");
	let error = $state<string | null>(null);
	let pending = $state(false);

	function defaultStarted() {
		const now = new Date();
		const offset = now.getTimezoneOffset() * 60_000;
		return new Date(now.getTime() - offset).toISOString().slice(0, 16);
	}

	async function save() {
		if (pending) return;
		error = null;
		const seconds = parseDuration(timeSpent);
		if (!seconds || seconds <= 0) {
			error = "Enter a time such as 1h 30m.";
			onError?.(error);
			return;
		}
		const remainingSeconds =
			remaining.trim() === "" ? undefined : parseDuration(remaining);
		if (remaining.trim() !== "" && remainingSeconds === null) {
			error = "Enter the remaining estimate such as 1h.";
			onError?.(error);
			return;
		}

		const startedDate = new Date(started);
		if (!started || Number.isNaN(startedDate.getTime())) {
			error = "Enter a start time.";
			onError?.(error);
			return;
		}

		pending = true;
		try {
			await api(`/api/issues/${issueKey}/worklogs`, {
				method: "POST",
				body: JSON.stringify({
					seconds,
					started: startedDate.toISOString(),
					comment: comment.trim() === "" ? undefined : comment.trim(),
					remainingEstimate: remainingSeconds ?? undefined,
				}),
			});
			if (onSaved) await onSaved();
			else await invalidate(`app:issue:${issueKey}`);
			onClose();
		} catch (cause) {
			const message = errorMessage(cause);
			error = message;
			onError?.(message);
		} finally {
			pending = false;
		}
	}
</script>

{#snippet footer()}
	<Button
		appearance="primary"
		onclick={save}
		isLoading={pending}
		isDisabled={timeSpent.trim() === ""}
	>
		Save
	</Button>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal title="Log work" width={480} {onClose} {footer}>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	<div class="field">
		<label for="log-time" class="label">Time spent</label>
		<input
			id="log-time"
			placeholder="1h 30m"
			value={timeSpent}
			oninput={(event) => (timeSpent = event.currentTarget.value)}
			class="input"
		/>
	</div>
	<div class="field">
		<label for="log-started" class="label">Started</label>
		<input
			id="log-started"
			type="datetime-local"
			value={started}
			oninput={(event) => (started = event.currentTarget.value)}
			class="input"
		/>
	</div>
	<div class="field">
		<label for="log-remaining" class="label">
			Remaining estimate (optional)
		</label>
		<input
			id="log-remaining"
			placeholder="Leave empty to reduce the current estimate"
			value={remaining}
			oninput={(event) => (remaining = event.currentTarget.value)}
			class="input"
		/>
	</div>
	<div>
		<label for="log-comment" class="label">
			Work description (optional)
		</label>
		<textarea
			id="log-comment"
			value={comment}
			oninput={(event) => (comment = event.currentTarget.value)}
			class="textarea"
		></textarea>
	</div>
</Modal>

<style>
	.error {
		margin: 0 0 12px;
		color: #e5493a;
	}
	.field {
		margin-bottom: 12px;
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

	.textarea {
		width: 100%;
		height: 70px;
		padding: 8px;
		background: var(--ds-background-input);
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text);
		resize: vertical;
	}
</style>
