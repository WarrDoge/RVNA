<script lang="ts">
	import { invalidate } from "$app/navigation";
	import { page } from "$app/state";
	import { token } from "#lib/tokens.ts";
	import type {
		Comment,
		HistoryEntry,
		Me,
		UserRef,
		Worklog,
	} from "#lib/api-types.ts";
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";
	import Module from "#lib/components/Module.svelte";
	import { isEditorEmpty } from "#lib/editor/editor-html.ts";
	import RichTextEditor from "#lib/editor/RichTextEditor.svelte";
	import type {
		IssueActivityData,
		IssueActivityServiceDesk,
	} from "./activity-types.ts";
	import { errorMessage } from "./activity-utils.ts";
	import CommentItem from "./CommentItem.svelte";
	import HistoryItemRow from "./HistoryItemRow.svelte";
	import WorklogItem from "./WorklogItem.svelte";

	type ActivityIssue = {
		key: string;
		permissions: Record<string, boolean>;
	};

	interface Props {
		issue: ActivityIssue;
		data?: IssueActivityData;
		me?: Me | UserRef | null;
		serviceDesk?: IssueActivityServiceDesk | null;
		comments?: Comment[];
		worklogs?: Worklog[];
		history?: HistoryEntry[];
		focusSignal?: number;
		onChanged?: () => Promise<void> | void;
		onError?: (message: string) => void;
		uploadImage?: (file: File) => Promise<string>;
	}

	let {
		issue,
		data,
		me = null,
		serviceDesk = null,
		comments: commentsProp,
		worklogs: worklogsProp,
		history: historyProp,
		focusSignal = 0,
		onChanged,
		onError,
		uploadImage,
	}: Props = $props();

	let tab = $state<"all" | "comments" | "worklogs" | "history">("all");
	let draft = $state("");
	let editorKey = $state(0);
	let commentError = $state<string | null>(null);
	let visibility = $state<"public" | "internal">("public");
	let adding = $state(false);

	let comments = $derived(data?.comments ?? commentsProp ?? []);
	let worklogs = $derived(data?.worklogs ?? worklogsProp ?? []);
	let history = $derived(data?.history ?? historyProp ?? []);
	let desk = $derived(serviceDesk ?? null);
	let currentUser = $derived(me ?? page.data.user);

	let permissions = $derived(issue.permissions);
	let canCommentInternally = $derived(
		desk?.isAgent === true && desk.requestType !== null,
	);

	type TimelineEntry =
		| { kind: "comment"; at: string; comment: Comment }
		| { kind: "worklog"; at: string; worklog: Worklog }
		| { kind: "history"; at: string; history: HistoryEntry };

	let entries: TimelineEntry[] = $derived(
		[
			...comments.map((comment) => ({
				kind: "comment" as const,
				at: comment.created ?? "",
				comment,
			})),
			...worklogs.map((worklog) => ({
				kind: "worklog" as const,
				at: worklog.started ?? "",
				worklog,
			})),
			...history.map((entry) => ({
				kind: "history" as const,
				at: entry.created ?? "",
				history: entry,
			})),
		].sort((left, right) => left.at.localeCompare(right.at)),
	);

	let visible: TimelineEntry[] = $derived(
		entries.filter((entry) => {
			if (tab === "all") return true;
			if (tab === "comments") return entry.kind === "comment";
			if (tab === "worklogs") return entry.kind === "worklog";
			return entry.kind === "history";
		}),
	);

	let tabs = $derived([
		{ id: "all" as const, label: "All", count: entries.length },
		{ id: "comments" as const, label: "Comments", count: comments.length },
		{ id: "worklogs" as const, label: "Work Log", count: worklogs.length },
		{ id: "history" as const, label: "History", count: history.length },
	]);

	async function refresh() {
		if (onChanged) {
			await onChanged();
			return;
		}
		await invalidate(`app:issue:${issue.key}`);
	}

	function reportError(message: string) {
		onError?.(message);
	}

	async function addComment() {
		if (adding) return;
		commentError = null;
		adding = true;
		try {
			await api(`/api/issues/${issue.key}/comments`, {
				method: "POST",
				body: JSON.stringify({
					body: draft,
					internal: canCommentInternally && visibility === "internal",
				}),
			});
			draft = "";
			editorKey += 1;
			await refresh();
		} catch (cause) {
			commentError = errorMessage(cause);
		} finally {
			adding = false;
		}
	}

	function canEdit(comment: Comment) {
		return (
			(comment.author?.id === currentUser?.id && permissions.EDIT_OWN_COMMENTS) ||
			(comment.author?.id !== currentUser?.id && permissions.EDIT_ALL_COMMENTS)
		);
	}

	function canDelete(comment: Comment) {
		return (
			(comment.author?.id === currentUser?.id &&
				permissions.DELETE_OWN_COMMENTS) ||
			(comment.author?.id !== currentUser?.id &&
				permissions.DELETE_ALL_COMMENTS)
		);
	}

	function canDeleteWorklog(worklog: Worklog) {
		return (
			(worklog.author?.id === currentUser?.id &&
				permissions.WORKLOG_DELETE_OWN) ||
			(worklog.author?.id !== currentUser?.id && permissions.WORKLOG_DELETE_ALL)
		);
	}

	const tabStyle = `padding: 4px 0 8px; margin-bottom: -1px; background: transparent; border: 0; border-bottom: 2px solid transparent; color: ${token(
		"color.text.subtle",
	)}; font-weight: 400; cursor: pointer; font-size: 14px;`;
	const activeTabStyle = `padding: 4px 0 8px; margin-bottom: -1px; background: transparent; border: 0; border-bottom: 2px solid ${token(
		"color.border.selected",
	)}; color: ${token("color.text")}; font-weight: 600; cursor: pointer; font-size: 14px;`;
	const subtleStyle = `color: ${token("color.text.subtle")};`;
</script>

<Module title="Activity">
	<div class="tabs" role="tablist" aria-label="Issue activity">
		{#each tabs as item (item.id)}
			<button
				type="button"
				role="tab"
				aria-selected={tab === item.id}
				onclick={() => (tab = item.id)}
				style={tab === item.id ? activeTabStyle : tabStyle}
			>
				{item.label} ({item.count})
			</button>
		{/each}
	</div>

	{#if visible.length === 0}
		<p style={subtleStyle}>Nothing here yet.</p>
	{:else}
		<div>
			{#each visible as entry (entry.kind === "comment"
				? `comment-${entry.comment.id}`
				: entry.kind === "worklog"
					? `worklog-${entry.worklog.id}`
					: `history-${entry.history.id}`)}
				{#if entry.kind === "comment"}
					<CommentItem
						comment={entry.comment}
						issueKey={issue.key}
						canEdit={canEdit(entry.comment)}
						canDelete={canDelete(entry.comment)}
						onChanged={refresh}
						onError={reportError}
					/>
				{:else if entry.kind === "worklog"}
					<WorklogItem
						worklog={entry.worklog}
						issueKey={issue.key}
						canDelete={canDeleteWorklog(entry.worklog)}
						onChanged={refresh}
						onError={reportError}
					/>
				{:else}
					<HistoryItemRow entry={entry.history} />
				{/if}
			{/each}
		</div>
	{/if}

	{#if permissions.ADD_COMMENTS}
		<div class="comment-form">
			{#if commentError}
				<p class="error" role="alert">{commentError}</p>
			{/if}
			{#if canCommentInternally}
				<div class="visibility-tabs" role="tablist" aria-label="Comment visibility">
					{#each [{ id: "public" as const, label: "Share with customer" }, { id: "internal" as const, label: "Comment internally" }] as item (item.id)}
						<button
							type="button"
							role="tab"
							aria-selected={visibility === item.id}
							onclick={() => (visibility = item.id)}
							style={visibility === item.id ? activeTabStyle : tabStyle}
						>
							{item.label}
						</button>
					{/each}
				</div>
			{/if}
			{#key editorKey}
				<RichTextEditor
					value={draft}
					onChange={(next) => (draft = next)}
					placeholder={visibility === "internal"
						? "Add an internal note…"
						: "Add a comment…"}
					minHeight={90}
					{focusSignal}
					{uploadImage}
				/>
			{/key}
			<div class="submit-row">
				<Button
					appearance="primary"
					onclick={addComment}
					isDisabled={isEditorEmpty(draft)}
					isLoading={adding}
				>
					Add comment
				</Button>
			</div>
		</div>
	{/if}
</Module>

<style>
	.tabs {
		display: flex;
		gap: 18px;
		border-bottom: 1px solid var(--ds-border, #091e4224);
		margin-bottom: 4px;
	}
	.visibility-tabs {
		display: flex;
		gap: 16px;
		margin-bottom: 8px;
		border-bottom: 1px solid var(--ds-border, #091e4224);
	}
	.comment-form {
		margin-top: 16px;
		padding-top: 16px;
		border-top: 1px solid var(--ds-border, #091e4224);
	}
	.error {
		margin: 0 0 8px;
		color: #e5493a;
	}
	.submit-row {
		display: flex;
		justify-content: flex-end;
		margin-top: 8px;
	}
</style>
