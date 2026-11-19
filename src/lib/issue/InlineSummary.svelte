<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { IssueDetail } from "#lib/api-types.ts";
	import { untrack } from "svelte";
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";

	interface Props {
		issue: IssueDetail;
		canEdit: boolean;
		onChanged: () => Promise<void>;
		onError: (message: string) => void;
	}

	let { issue, canEdit, onChanged, onError }: Props = $props();

	let editing = $state(false);
	let value = $state(untrack(() => issue.summary));
	let saving = $state(false);
	let finished = false;

	function errorMessage(error: unknown) {
		return error instanceof Error ? error.message : "Something went wrong";
	}

	async function saveSummary(next: string) {
		saving = true;
		try {
			await api(`/api/issues/${encodeURIComponent(issue.key)}`, {
				method: "PATCH",
				body: JSON.stringify({ summary: next }),
			});
			await onChanged();
		} catch (error) {
			onError(errorMessage(error));
		} finally {
			saving = false;
		}
	}

	function finish(save: boolean) {
		if (finished) return;
		finished = true;
		editing = false;
		const next = value.trim();
		if (save && next !== "" && next !== issue.summary) {
			void saveSummary(next);
		}
	}

	function start() {
		if (!canEdit) return;
		finished = false;
		value = issue.summary;
		editing = true;
	}

	function focusInput(node: HTMLInputElement) {
		node.focus();
	}

	let headingStyle = $derived(`margin: 4px 0 12px; font-size: 24px; font-weight: 500; line-height: 30px; color: ${token(
		"color.text",
	)};`);
	let headingButtonStyle = $derived(`display: block; width: 100%; padding: 0; background: transparent; border: 0; color: inherit; font: inherit; text-align: left; cursor: ${canEdit ? "text" : "default"};`);
	const editRowStyle =
		"display: flex; align-items: center; gap: 8px; margin: 4px 0 12px;";
	const inputStyle = `flex: 1; height: 36px; padding: 0 10px; background-color: ${token(
		"color.background.input",
	)}; border: 1px solid ${token(
		"color.border.input",
	)}; border-radius: 3px; color: ${token(
		"color.text",
	)}; font-size: 20px; font-weight: 500;`;
</script>

{#if !editing}
	<h1 style={headingStyle}>
		<button
			type="button"
			disabled={!canEdit}
			title={canEdit ? "Click to edit the summary" : undefined}
			onclick={start}
			style={headingButtonStyle}
		>
			{issue.summary}
		</button>
	</h1>
{:else}
	<div style={editRowStyle}>
		<input
			{@attach focusInput}
			aria-label="Summary"
			value={value}
			oninput={(event) => (value = event.currentTarget.value)}
			onkeydown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					finish(true);
				}
				if (event.key === "Escape") {
					event.preventDefault();
					finish(false);
				}
			}}
			onblur={(event) => {
				if (
					event.relatedTarget instanceof HTMLElement &&
					event.relatedTarget.dataset.action === "cancel"
				) {
					return;
				}
				finish(true);
			}}
			style={inputStyle}
		/>
		<Button appearance="primary" onclick={() => finish(true)} isLoading={saving}>
			Save
		</Button>
		<Button
			appearance="subtle"
			data-action="cancel"
			onclick={() => finish(false)}>Cancel</Button
		>
	</div>
{/if}
