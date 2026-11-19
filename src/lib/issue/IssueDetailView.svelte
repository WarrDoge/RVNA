<script lang="ts">
	import { goto, invalidate } from "$app/navigation";
	import { onMount } from "svelte";
	import { api } from "#lib/api.ts";
	import type { Attachment, Transition, UserRef } from "#lib/api-types.ts";
	import { rememberProject } from "#lib/recent-projects.ts";
	import Banner from "#lib/admin/Banner.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import Icon from "#lib/components/Icon.svelte";
	import ProjectAvatar from "#lib/components/ProjectAvatar.svelte";
	import EditIssueDialog from "#lib/issue-form/EditIssueDialog.svelte";
	import ResolutionDialog from "#lib/issue-form/ResolutionDialog.svelte";
	import type { IssueView } from "#lib/server/issues/view.ts";
	import { openCreateIssue } from "#lib/shell/CreateIssue.svelte";
	import ShortcutHelp from "#lib/shell/ShortcutHelp.svelte";
	import { installShortcut } from "#lib/shell/shortcuts.ts";
	import ActionsDialog from "./ActionsDialog.svelte";
	import ActivityModule from "./ActivityModule.svelte";
	import AttachmentsModule from "./AttachmentsModule.svelte";
	import CloneIssueDialog from "./CloneIssueDialog.svelte";
	import DatesModule from "./DatesModule.svelte";
	import DescriptionModule from "./DescriptionModule.svelte";
	import DetailsModule from "./DetailsModule.svelte";
	import DevelopmentModule from "./DevelopmentModule.svelte";
	import EpicIssuesModule from "./EpicIssuesModule.svelte";
	import InlineSummary from "./InlineSummary.svelte";
	import IssueToolbar from "./IssueToolbar.svelte";
	import LabelsDialog from "./LabelsDialog.svelte";
	import LinkDialog from "./LinkDialog.svelte";
	import LinksModule from "./LinksModule.svelte";
	import LogWorkDialog from "./LogWorkDialog.svelte";
	import PeopleModule from "./PeopleModule.svelte";
	import ServiceDeskPanel from "./ServiceDeskPanel.svelte";
	import SlaPanel from "./SlaPanel.svelte";
	import SubtasksModule from "./SubtasksModule.svelte";
	import TimeTrackingModule from "./TimeTrackingModule.svelte";
	import type { IssueNavigation, ShortcutAction } from "./types.ts";

	interface Props {
		view: IssueView;
		embedded?: boolean;
		navigation?: IssueNavigation;
		narrow?: boolean;
		onClose?: () => void;
	}

	let {
		view,
		embedded = false,
		navigation,
		narrow = false,
		onClose,
	}: Props = $props();

	let issue = $derived(view.issue);
	let me = $derived(view.me);

	let editOpen = $state(false);
	let logWorkOpen = $state(false);
	let linkOpen = $state(false);
	let deleteOpen = $state(false);
	let cloneOpen = $state(false);
	let labelsOpen = $state(false);
	let actionsOpen = $state(false);
	let helpOpen = $state(false);
	let assignOpen = $state(false);
	let actionError = $state<string | null>(null);
	let uploadError = $state<string | null>(null);
	let uploadPending = $state(false);
	let deleting = $state(false);
	let commentFocus = $state(0);
	let fileInput = $state<HTMLInputElement>();

	let resolutionFor = $state<Transition | null>(null);
	let transitionPending = $state(false);
	let transitionInFlight = false;

	const may = (key: string) =>
		(issue.permissions as Record<string, boolean> | undefined)?.[key] === true;

	function errorMessage(cause: unknown) {
		return cause instanceof Error ? cause.message : "Something went wrong";
	}

	async function invalidateIssue(key = issue.key) {
		await invalidate(`app:issue:${key}`);
	}

	async function runTransition(next: Transition, resolutionId?: string) {
		if (next.asksResolution && resolutionId === undefined) {
			resolutionFor = next;
			return;
		}
		if (transitionInFlight) return;
		const key = issue.key;
		transitionInFlight = true;
		transitionPending = true;
		try {
			await api(`/api/issues/${encodeURIComponent(key)}/transitions`, {
				method: "POST",
				body: JSON.stringify({ transitionId: next.id, resolutionId }),
			});
			actionError = null;
			resolutionFor = null;
			await invalidateIssue(key);
		} catch (cause) {
			resolutionFor = null;
			actionError = errorMessage(cause);
		} finally {
			transitionInFlight = false;
			transitionPending = false;
		}
	}

	async function assign(user: UserRef | null) {
		const key = issue.key;
		try {
			await api(`/api/issues/${encodeURIComponent(key)}`, {
				method: "PATCH",
				body: JSON.stringify({ assignee: user?.id ?? null }),
			});
			actionError = null;
			await invalidateIssue(key);
		} catch (cause) {
			actionError = errorMessage(cause);
		}
	}

	function assignToMe() {
		if (me) void assign(me);
	}

	async function uploadImage(file: File) {
		const key = issue.key;
		const form = new FormData();
		form.append("file", file, file.name);
		const [attachment] = await api<Attachment[]>(
			`/api/issues/${encodeURIComponent(key)}/attachments`,
			{ method: "POST", body: form },
		);
		return `/api/attachments/${attachment.id}`;
	}

	async function uploadFiles(files: File[]) {
		if (files.length === 0) return;
		const key = issue.key;
		uploadError = null;
		uploadPending = true;
		try {
			const form = new FormData();
			for (const file of files) form.append("file", file, file.name);
			await api<Attachment[]>(
				`/api/issues/${encodeURIComponent(key)}/attachments`,
				{ method: "POST", body: form },
			);
			await invalidateIssue(key);
		} catch (cause) {
			uploadError = errorMessage(cause);
		} finally {
			uploadPending = false;
		}
	}

	async function deleteIssue() {
		if (deleting) return;
		const key = issue.key;
		const projectKey = issue.project.key;
		deleting = true;
		try {
			await api(`/api/issues/${encodeURIComponent(key)}`, {
				method: "DELETE",
			});
			deleteOpen = false;
			if (narrow) {
				await invalidateIssue(key);
				onClose?.();
				return;
			}
			await goto(`/projects/${projectKey}/issues`);
		} catch (cause) {
			actionError = errorMessage(cause);
		} finally {
			deleting = false;
		}
	}

	function focusComment() {
		commentFocus += 1;
		document
			.getElementById("activity-comment")
			?.scrollIntoView({ behavior: "smooth", block: "center" });
	}

	function createSubtask() {
		openCreateIssue({ projectKey: issue.project.key, parent: issue.key });
	}

	let actions = $derived.by<ShortcutAction[]>(() => {
		const list: ShortcutAction[] = [];
		if (may("EDIT_ISSUES")) {
			list.push({
				id: "edit",
				label: "Edit issue",
				keys: "e",
				run: () => (editOpen = true),
			});
		}
		if (may("ASSIGN_ISSUES")) {
			list.push(
				{
					id: "assign",
					label: "Assign",
					keys: "a",
					run: () => (assignOpen = true),
				},
				{
					id: "assign-me",
					label: "Assign to me",
					keys: "i",
					run: assignToMe,
				},
			);
		}
		if (may("ADD_COMMENTS")) {
			list.push({
				id: "comment",
				label: "Comment",
				keys: "m",
				run: focusComment,
			});
		}
		if (may("EDIT_ISSUES")) {
			list.push({
				id: "labels",
				label: "Labels",
				keys: "l",
				run: () => (labelsOpen = true),
			});
		}
		if (may("WORK_ON_ISSUES")) {
			list.push({
				id: "log-work",
				label: "Log work",
				run: () => (logWorkOpen = true),
			});
		}
		if (may("CREATE_ATTACHMENTS")) {
			list.push({
				id: "attach",
				label: "Attach files",
				run: () => fileInput?.click(),
			});
		}
		if (may("LINK_ISSUES")) {
			list.push({ id: "link", label: "Link", run: () => (linkOpen = true) });
		}
		if (may("CREATE_ISSUES") && !issue.type.subtask) {
			list.push({
				id: "subtask",
				label: "Create sub-task",
				run: createSubtask,
			});
		}
		if (may("TRANSITION_ISSUES")) {
			for (const transition of issue.transitions) {
				list.push({
					id: `transition-${transition.id}`,
					label: transition.name,
					run: () => void runTransition(transition),
				});
			}
		}
		if (may("DELETE_ISSUES")) {
			list.push({
				id: "delete",
				label: "Delete",
				run: () => (deleteOpen = true),
			});
		}
		list.push({
			id: "help",
			label: "Keyboard shortcuts",
			keys: "?",
			run: () => (helpOpen = true),
		});
		return list;
	});

	$effect(() => {
		const project = view.issue.project;
		if (!project.key || !project.name) return;
		rememberProject(view.me.id, {
			key: project.key,
			name: project.name,
			avatarUrl: project.avatarUrl ?? null,
		});
	});

	onMount(() => {
		void api(`/api/issues/${encodeURIComponent(issue.key)}/view`, {
			method: "POST",
		}).catch(() => {});
	});

	onMount(() =>
		installShortcut((key, event) => {
			const permissions = issue.permissions;
			let handled = true;
			if (key === "e" && permissions.EDIT_ISSUES) editOpen = true;
			else if (key === "a" && permissions.ASSIGN_ISSUES) assignOpen = true;
			else if (key === "i" && permissions.ASSIGN_ISSUES) assignToMe();
			else if (key === "m" && permissions.ADD_COMMENTS) focusComment();
			else if (key === "l" && permissions.EDIT_ISSUES) labelsOpen = true;
			else if (key === ".") actionsOpen = true;
			else if (key === "?") helpOpen = true;
			else handled = false;
			// The dialog mounts synchronously; stop the key from landing in its input.
			if (handled) event.preventDefault();
		}),
	);
</script>

<div
	class="issue"
	class:narrow
	class:embedded
	data-testid={narrow ? "issue-detail-panel" : undefined}
>
	<div class="content" class:narrow class:embedded>
		{#if narrow}
			<div class="close-row">
				<button type="button" aria-label="Close issue" onclick={onClose}>
					<Icon name="close" />
				</button>
			</div>
		{/if}

		<div class="header">
			<ProjectAvatar
				name={issue.project.name}
				avatarUrl={issue.project.avatarUrl}
				size={48}
			/>
			<div class="header-main">
				<div class="breadcrumb">
					<a href={`/projects/${issue.project.key}/issues`}>{issue.project.name}</a>
					<span>/</span>
					<a href={`/browse/${issue.key}`}>{issue.key}</a>
					{#if navigation}
						<div class="navigation">
							<span class="position">
								{navigation.position} of {navigation.total}
							</span>
							<button
								type="button"
								aria-label="Previous issue"
								disabled={navigation.position <= 1}
								onclick={navigation.onPrevious}
								class="arrow"
							>
								<Icon name="chevron-left" />
							</button>
							<button
								type="button"
								aria-label="Next issue"
								disabled={navigation.position >= navigation.total}
								onclick={navigation.onNext}
								class="arrow"
							>
								<Icon name="chevron-right" />
							</button>
						</div>
					{/if}
				</div>
				<InlineSummary
					{issue}
					canEdit={may("EDIT_ISSUES")}
					onChanged={invalidateIssue}
					onError={(message) => (actionError = message)}
				/>
			</div>
		</div>

		{#if view.project.archived}
			<Banner tone="warning">This project is archived. It is read-only.</Banner>
		{/if}

		<IssueToolbar
			{issue}
			me={me}
			permissions={issue.permissions}
			{assignOpen}
			onAssignOpenChange={(open) => (assignOpen = open)}
			onEdit={() => (editOpen = true)}
			onComment={focusComment}
			onAssign={(user) => void assign(user)}
			onLogWork={() => (logWorkOpen = true)}
			onAttach={() => fileInput?.click()}
			onLink={() => (linkOpen = true)}
			onClone={() => (cloneOpen = true)}
			onCreateSubtask={createSubtask}
			onDelete={() => {
				if (!may("DELETE_ISSUES")) {
					actionError = "You do not have permission to DELETE_ISSUES";
					return;
				}
				deleteOpen = true;
			}}
			onTransition={(transition) => void runTransition(transition)}
			{transitionPending}
		/>

		{#if resolutionFor}
			<ResolutionDialog
				transition={resolutionFor}
				resolutions={view.resolutions}
				pending={transitionPending}
				onClose={() => (resolutionFor = null)}
				onConfirm={(resolutionId) => {
					if (resolutionFor) void runTransition(resolutionFor, resolutionId);
				}}
			/>
		{/if}

		{#if actionError}
			<p class="action-error" role="alert">{actionError}</p>
		{/if}

		<input
			bind:this={fileInput}
			type="file"
			multiple
			aria-label="Attach files"
			class="file-input"
			onchange={(event) => {
				void uploadFiles(Array.from(event.currentTarget.files ?? []));
				event.currentTarget.value = "";
			}}
		/>

		<div class="columns" class:narrow>
			<div class="main-column">
				<DetailsModule
					{issue}
					me={me}
					onChanged={invalidateIssue}
				/>
				<DescriptionModule
					{issue}
					canEdit={may("EDIT_ISSUES")}
					onChanged={invalidateIssue}
					onError={(message) => (actionError = message)}
					uploadImage={uploadImage}
				/>
				<AttachmentsModule
					{issue}
					me={me}
					canAttach={may("CREATE_ATTACHMENTS")}
					canDeleteAll={may("DELETE_ALL_ATTACHMENTS")}
					canDeleteOwn={may("DELETE_OWN_ATTACHMENTS")}
					onBrowse={() => fileInput?.click()}
					onFiles={(files) => void uploadFiles(files)}
					onChanged={invalidateIssue}
					onError={(message) => (actionError = message)}
					uploading={uploadPending}
					{uploadError}
				/>
				<LinksModule
					{issue}
					canLink={may("LINK_ISSUES")}
					onAdd={() => (linkOpen = true)}
					onChanged={invalidateIssue}
					onError={(message) => (actionError = message)}
				/>
				<SubtasksModule
					{issue}
					canCreate={may("CREATE_ISSUES")}
					onCreateSubtask={createSubtask}
				/>
				<EpicIssuesModule {issue} />
				<div id="activity-comment">
					<ActivityModule
						{issue}
						me={me}
						serviceDesk={view.panels.request}
						focusSignal={commentFocus}
						onChanged={invalidateIssue}
						onError={(message) => (actionError = message)}
						uploadImage={uploadImage}
						data={view.activity}
					/>
				</div>
			</div>

			<div class="side-column" class:narrow>
				<ServiceDeskPanel data={view.panels.request} />
				{#if issue.project.type === "service_desk"}
					<SlaPanel data={view.panels.sla} />
				{/if}
				<PeopleModule
					{issue}
					me={me}
					onChanged={invalidateIssue}
					onError={(message) => (actionError = message)}
				/>
				<DatesModule {issue} />
				<DevelopmentModule data={view.panels.development} />
				<TimeTrackingModule {issue} />
			</div>
		</div>
	</div>

	{#if editOpen}
		<EditIssueDialog
			{issue}
			onClose={() => (editOpen = false)}
			onSaved={() => (editOpen = false)}
		/>
	{/if}
	{#if logWorkOpen}
		<LogWorkDialog
			issueKey={issue.key}
			onClose={() => (logWorkOpen = false)}
			onSaved={invalidateIssue}
			onError={(message) => (actionError = message)}
			data={view.activity}
		/>
	{/if}
	{#if linkOpen}
		<LinkDialog
			issueKey={issue.key}
			onClose={() => (linkOpen = false)}
			onSaved={invalidateIssue}
			onError={(message) => (actionError = message)}
		/>
	{/if}
	{#if cloneOpen}
		<CloneIssueDialog {issue} onClose={() => (cloneOpen = false)} />
	{/if}
	{#if deleteOpen}
		<ConfirmDialog
			title="Delete issue"
			message={`Delete ${issue.key}? This cannot be undone.`}
			onClose={() => (deleteOpen = false)}
			onConfirm={() => void deleteIssue()}
			pending={deleting}
		/>
	{/if}
	{#if labelsOpen}
		<LabelsDialog
			{issue}
			onClose={() => (labelsOpen = false)}
			onChanged={invalidateIssue}
			onError={(message) => (actionError = message)}
		/>
	{/if}
	{#if actionsOpen}
		<ActionsDialog {actions} onClose={() => (actionsOpen = false)} />
	{/if}
	{#if helpOpen}
		<ShortcutHelp onClose={() => (helpOpen = false)} />
	{/if}
</div>

<style>
	.issue {
		display: flex;
		min-height: calc(100vh - 56px);
	}

	.issue.embedded {
		min-height: 100%;
	}

	.issue.narrow {
		height: 100%;
		min-height: 0;
		overflow: auto;
		background-color: var(--ds-surface);
	}

	.content {
		flex: 1;
		min-width: 0;
		padding: 20px 24px 40px;
	}

	.content.embedded {
		padding: 12px 20px 40px;
	}

	.content.narrow {
		padding: 12px 16px 32px;
	}

	.close-row {
		display: flex;
		justify-content: flex-end;
		margin-bottom: 4px;
	}

	.close-row button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		background: transparent;
		border: 0;
		border-radius: 3px;
		color: var(--ds-text-subtle);
		cursor: pointer;
	}

	.header {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}

	.header-main {
		flex: 1;
		min-width: 0;
	}

	.breadcrumb {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 14px;
		line-height: 20px;
		color: var(--ds-text-subtle);
	}

	.breadcrumb a {
		color: var(--ds-text-subtle);
		text-decoration: none;
	}

	.navigation {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.position {
		margin-right: 4px;
	}

	.arrow {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		background: transparent;
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		color: var(--ds-text-subtle);
		cursor: pointer;
	}

	.arrow:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.action-error {
		margin: 0 0 12px;
		color: #e5493a;
	}

	.file-input {
		display: none;
	}

	.columns {
		display: flex;
		align-items: flex-start;
		gap: 32px;
		margin-top: 12px;
	}

	.columns.narrow {
		flex-direction: column;
		gap: 0;
	}

	.main-column {
		flex: 1;
		min-width: 0;
		width: 100%;
	}

	.side-column {
		width: 330px;
		flex: none;
	}

	.side-column.narrow {
		width: 100%;
	}
</style>
