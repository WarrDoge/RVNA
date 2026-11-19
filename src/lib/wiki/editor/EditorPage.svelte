<script lang="ts">
	import { goto, invalidate } from "$app/navigation";
	import { onMount, untrack } from "svelte";
	import type {
		EditorContext,
		EditorSpace,
		PageRestrictions,
		WikiDoc,
		WikiUserRef,
	} from "#lib/shared/wiki/index.ts";
	import Button from "#lib/components/Button.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
		import Banner from "./Banner.svelte";
	import BottomBar from "./BottomBar.svelte";
	import ChooseLocationDialog from "./ChooseLocationDialog.svelte";
	import ConflictBanner from "./ConflictBanner.svelte";
	import DraftBanner from "./DraftBanner.svelte";
	import {
		Autosave,
		EditLock,
		WikiApiError,
		discardDraft,
		errorMessage,
	} from "./edit-session.svelte.ts";
	import {
		clearLocalDraft,
		newPageLocationSpaces,
		readLocalDraft,
		restrictionMode,
	} from "./helpers.ts";
	import type { ChosenLocation } from "./helpers.ts";
	import LabelsDialog from "./LabelsDialog.svelte";
	import LockLostBanner from "./LockLostBanner.svelte";
	import LockNotice from "./LockNotice.svelte";
	import MovePageDialog from "./MovePageDialog.svelte";
	import RestrictionsDialog from "./RestrictionsDialog.svelte";
	import { type Content, type Mode, startingContent } from "./starting-content.ts";
	import { publishNewPage, publishPage, viewPageUrl, spaceHomeUrl } from "./wiki-api.ts";
	import WikiEditor from "./WikiEditor.svelte";
	import "./screens.css";

	interface Props {
		context: EditorContext;
		restrictions: PageRestrictions;
		spaces: EditorSpace[];
		tree: { id: string; title: string; parentId: string | null; position: number }[];
		me: WikiUserRef;
		mode: Mode;
	}

	let { context, restrictions, spaces, tree, me, mode }: Props = $props();

	const page = $derived(context.page);
	const pageId = $derived(page.id);
	const isNew = $derived(page.status === "draft");
	const canEdit = $derived(context.permissions.canEdit);

	const start = untrack(() => startingContent(context, mode, null));
	const content: Content = { ...start.content };

	let title = $state(start.content.title);
	let labels = $state(start.content.labels);
	let editorDoc = $state(start.content.doc);
	let editorKey = $state(0);
	let offer = $state(start.offer);
	let offerBusy = $state(false);
	let message = $state("");
	let notify = $state(true);
	let newLocation = $state<ChosenLocation | null>(null);
	let publishing = $state(false);
	let publishingRef = false;
	let titleError = $state<string | null>(null);
	let publishError = $state<string | null>(null);
	let conflict = $state<{ currentVersion: number | null } | null>(null);
	let dialog = $state<
		"move" | "restrictions" | "labels" | "confirm-close" | null
	>(null);
	let titleInput = $state<HTMLInputElement>();
	let mounted = $state(false);

	const lock = new EditLock(untrack(() => pageId));
	const autosave = new Autosave(untrack(() => pageId), () => ({
		title: content.title,
		bodyDoc: content.doc,
		labels: content.labels,
		baseVersion: content.baseVersion ?? undefined,
	}));

	const lockKind = $derived(lock.state.kind);
	const editable = $derived(lockKind === "held");

	const location = $derived(
		newLocation ?? {
			spaceKey: page.spaceKey,
			parentId: page.parentId,
		},
	);
	const crumbs = $derived(
		newLocation
			? [newLocation.spaceName, ...newLocation.path.map((crumb) => crumb.title)]
			: [page.spaceName, ...context.breadcrumb.map((crumb) => crumb.title)],
	);
	const restriction = $derived(restrictionMode(restrictions));

	$effect(() => {
		if (!canEdit) return;
		lock.start();
		return () => lock.stop();
	});

	$effect(() => {
		if (lockKind === "lost") void autosave.run();
	});

	function applyContent(next: Content) {
		content.title = next.title;
		content.doc = next.doc;
		content.labels = next.labels;
		content.baseVersion = next.baseVersion;
		title = next.title;
		labels = next.labels;
		editorDoc = next.doc;
		editorKey += 1;
	}

	onMount(() => {
		mounted = true;
		if (isNew) titleInput?.focus();

		const local = readLocalDraft(localStorage, page.id);
		if (page.status === "draft" || mode === "resume") {
			const fresh = startingContent(context, mode, local);
			if (fresh.source === "browser") applyContent(fresh.content);
		} else {
			offer = startingContent(context, mode, local).offer;
		}

		const warn = (event: BeforeUnloadEvent) => {
			if (autosave.isDirty()) {
				event.preventDefault();
				event.returnValue = "";
			}
		};
		const pageHide = () => {
			lock.releaseOnPageHide();
			autosave.keepLocalCopy();
		};
		const onKey = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
				event.preventDefault();
				void publish();
			}
		};
		window.addEventListener("beforeunload", warn);
		window.addEventListener("pagehide", pageHide);
		document.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("beforeunload", warn);
			window.removeEventListener("pagehide", pageHide);
			document.removeEventListener("keydown", onKey);
			autosave.dispose();
		};
	});

	function onDocChange(doc: WikiDoc) {
		content.doc = doc;
		autosave.touch();
	}

	function onTitle(value: string) {
		content.title = value;
		title = value;
		titleError = null;
		autosave.touch();
	}

	function applyLabels(next: string[]) {
		content.labels = next;
		labels = next;
		autosave.touch();
	}

	async function publish() {
		const current = content;
		if (publishingRef || current.title.trim() === "" || !editable) return;
		publishingRef = true;
		publishing = true;
		titleError = null;
		publishError = null;
		conflict = null;
		try {
			await autosave.settle();
			const comment = message.trim() === "" ? undefined : message.trim();
			const published = isNew
				? await publishNewPage({
						spaceKey: location.spaceKey,
						parentId: location.parentId,
						title: current.title.trim(),
						bodyDoc: current.doc,
						labels: current.labels,
						message: comment,
						draftPageId: pageId,
					})
				: await publishPage(pageId, {
						title: current.title.trim(),
						bodyDoc: current.doc,
						baseVersion: current.baseVersion ?? undefined,
						message: comment,
						labels: current.labels,
						notifyWatchers: notify,
					});
			autosave.reset();
			void goto(viewPageUrl(published.id));
		} catch (error) {
			if (
				error instanceof WikiApiError &&
				error.status === 409 &&
				error.body.currentVersion !== undefined
			) {
				conflict = { currentVersion: error.body.currentVersion };
				autosave.touch();
				void autosave.run();
			} else if (error instanceof WikiApiError && error.status === 409) {
				titleError = error.message;
			} else if (error instanceof WikiApiError && error.status === 423) {
				lock.markLost(error.body.lock ?? null);
			} else {
				publishError = errorMessage(error);
			}
		} finally {
			publishingRef = false;
			publishing = false;
		}
	}

	function leave() {
		if (!isNew) void goto(viewPageUrl(pageId));
		else if (page.parentId) void goto(viewPageUrl(page.parentId));
		else void goto(spaceHomeUrl(page.spaceKey));
	}

	async function close() {
		if (lockKind === "held" && !(await autosave.run())) {
			dialog = "confirm-close";
			return;
		}
		leave();
	}

	function resume() {
		if (!offer) return;
		content.title = offer.title;
		content.doc = offer.bodyDoc;
		content.labels = offer.labels;
		content.baseVersion = offer.baseVersion ?? page.version;
		title = offer.title;
		labels = offer.labels;
		editorDoc = offer.bodyDoc;
		editorKey += 1;
		offer = null;
		autosave.touch();
	}

	async function discard() {
		offerBusy = true;
		try {
			if (context.draft) await discardDraft(pageId);
			clearLocalDraft(localStorage, pageId);
			offer = null;
		} catch (error) {
			publishError = errorMessage(error);
		} finally {
			offerBusy = false;
		}
	}
</script>

{#if !canEdit}
	<div class="wed-body">
		<Banner tone="danger">You do not have permission to edit this page.</Banner>
		<Button href={viewPageUrl(pageId)}>View page</Button>
	</div>
{:else if lock.state.kind === "blocked"}
	<div class="wed-page">
		<div class="wed-body">
			<LockNotice
				pageTitle={page.title}
				lock={lock.state.lock}
				waiting={lock.waiting}
				onwait={() => lock.setWaiting(!lock.waiting)}
				ontakeover={() => void lock.takeOver()}
				viewHref={viewPageUrl(pageId)}
			/>
		</div>
	</div>
{:else}
	<div class="wed-page">
		<div class="wed-body">
			{#if lock.state.kind === "error"}
				<Banner tone="danger">{lock.state.message}</Banner>
			{/if}
			{#if lock.state.kind === "lost"}
				<LockLostBanner
					lock={lock.state.lock}
					ontakeover={() => void lock.takeOver()}
					viewHref={viewPageUrl(pageId)}
				/>
			{/if}
			{#if offer}
				<DraftBanner
					{offer}
					onresume={resume}
					ondiscard={() => void discard()}
					busy={offerBusy}
				/>
			{/if}
			{#if conflict}
				<ConflictBanner
					currentVersion={conflict.currentVersion}
					viewHref={viewPageUrl(pageId)}
				/>
			{/if}
			{#if publishError}
				<Banner tone="danger">{publishError}</Banner>
			{/if}
			<input
				bind:this={titleInput}
				class="wed-title"
				aria-label="Page title"
				placeholder="Page title"
				maxlength={255}
				readonly={!mounted || lockKind === "lost" || lockKind === "error"}
				aria-invalid={titleError !== null}
				bind:value={() => title, (value) => onTitle(value)}
			/>
			{#if titleError}
				<p class="wed-field-error" role="alert">{titleError}</p>
			{/if}
			{#if lockKind !== "acquiring"}
				{#key editorKey}
					<WikiEditor
						doc={editorDoc}
						onchange={onDocChange}
						spaceKey={location.spaceKey}
						{pageId}
						onpublishshortcut={() => void publish()}
						autoFocus={!isNew}
						{editable}
						attachments={context.attachments}
					/>
				{/key}
			{/if}
		</div>
		<BottomBar
			{crumbs}
			onlocation={() => (dialog = "move")}
			{restriction}
			onrestrictions={() => (dialog = "restrictions")}
			labelCount={labels.length}
			onlabels={() => (dialog = "labels")}
			{message}
			onmessage={(value) => (message = value)}
			{notify}
			onnotify={(value) => (notify = value)}
			status={autosave.status}
			canPublish={title.trim() !== "" && editable}
			{publishing}
			onpublish={() => void publish()}
			onclose={() => void close()}
		/>
		{#if dialog === "move"}
			{#if isNew}
				<ChooseLocationDialog
					initial={location}
					spaces={newPageLocationSpaces(spaces, page.spaceKey)}
					initialTree={tree}
					onclose={() => (dialog = null)}
					onchoose={(chosen) => {
						newLocation = chosen;
						dialog = null;
					}}
				/>
			{:else}
				<MovePageDialog
					page={page}
					currentPath={crumbs.join(" / ")}
					{spaces}
					initialTree={tree}
					onclose={() => (dialog = null)}
					onmoved={async () => {
						await invalidate("app:wiki-editor");
						dialog = null;
					}}
				/>
			{/if}
		{/if}
		{#if dialog === "restrictions"}
			<RestrictionsDialog
				{pageId}
				{restrictions}
				canRestrict={context.permissions.canRestrict}
				{me}
				onclose={() => (dialog = null)}
			/>
		{/if}
		{#if dialog === "labels"}
			<LabelsDialog
				{labels}
				onclose={() => (dialog = null)}
				onapply={applyLabels}
			/>
		{/if}
		{#if dialog === "confirm-close"}
			<ConfirmDialog
				title="Leave without saving?"
				message="Your latest changes could not be saved as a draft. A copy is kept in this browser, and you can resume from it the next time you edit this page."
				confirmLabel="Leave"
				onConfirm={leave}
				onClose={() => (dialog = null)}
			/>
		{/if}
	</div>
{/if}
