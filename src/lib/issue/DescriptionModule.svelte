<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { IssueDetail } from "#lib/api-types.ts";
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";
	import Module from "#lib/components/Module.svelte";
	import RichTextEditor from "#lib/editor/RichTextEditor.svelte";
	import { isEditorEmpty } from "#lib/editor/editor-html.ts";
	import { untrack } from "svelte";

	interface Props {
		issue: IssueDetail;
		canEdit: boolean;
		onChanged: () => Promise<void>;
		onError: (message: string) => void;
		uploadImage?: (file: File) => Promise<string>;
	}

	let { issue, canEdit, onChanged, onError, uploadImage }: Props = $props();

	let editing = $state(false);
	let draft = $state(untrack(() => issue.descriptionHtml ?? ""));
	let saving = $state(false);

	function errorMessage(error: unknown) {
		return error instanceof Error ? error.message : "Something went wrong";
	}

	async function save() {
		if (saving) return;
		saving = true;
		try {
			await api(`/api/issues/${encodeURIComponent(issue.key)}`, {
				method: "PATCH",
				body: JSON.stringify({
					description: isEditorEmpty(draft) ? null : draft,
				}),
			});
			editing = false;
			await onChanged();
		} catch (error) {
			onError(errorMessage(error));
		} finally {
			saving = false;
		}
	}

	function startEditing() {
		if (!canEdit) return;
		draft = issue.descriptionHtml ?? "";
		editing = true;
	}

	const actionsStyle = "display: flex; gap: 8px; margin-top: 8px;";
	const linkButtonStyle = `padding: 0; background: transparent; border: 0; color: ${token(
		"color.link",
	)}; cursor: pointer; font-size: inherit;`;
	let descriptionStyle = $derived(`cursor: ${canEdit ? "text" : "default"};`);
</script>

<Module title="Description">
	{#if editing}
		<div>
			<RichTextEditor
				value={draft}
				onChange={(next) => (draft = next)}
				placeholder="Add a description…"
				minHeight={140}
				autoFocus
				{uploadImage}
			/>
			<div style={actionsStyle}>
				<Button appearance="primary" onclick={save} isLoading={saving}>
					Save
				</Button>
				<Button
					appearance="subtle"
					onclick={() => {
						draft = issue.descriptionHtml ?? "";
						editing = false;
					}}
				>
					Cancel
				</Button>
			</div>
		</div>
	{:else if issue.descriptionHtml}
		<!-- The server sanitizes every body before it is stored. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div
			class="fat-rich-text"
			style={descriptionStyle}
			role={canEdit ? "button" : undefined}
			tabindex={canEdit ? 0 : undefined}
			onclick={(event) => {
				if (!canEdit) return;
				if ((event.target as HTMLElement).closest("a")) return;
				startEditing();
			}}
			onkeydown={(event) => {
				if (canEdit && event.key === "Enter") startEditing();
			}}
		>
			{@html issue.descriptionHtml}
		</div>
	{:else if canEdit}
		<button type="button" onclick={startEditing} style={linkButtonStyle}>
			Add a description
		</button>
	{/if}
</Module>
