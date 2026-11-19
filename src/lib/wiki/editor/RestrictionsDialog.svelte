<script lang="ts">
	import { invalidate } from "$app/navigation";
	import { api } from "#lib/api.ts";
	import type { UserRef } from "#lib/api-types.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import Button from "#lib/components/Button.svelte";
	import Icon from "#lib/components/Icon.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import type {
		PageRestrictions,
		WikiUserRef,
	} from "#lib/shared/wiki/index.ts";
	import { errorMessage } from "./edit-session.svelte.ts";
	import {
		type RestrictionEntry,
		type RestrictionMode,
		restrictionEntries,
		restrictionInput,
		restrictionMode,
	} from "./helpers.ts";

	interface Props {
		pageId: string;
		restrictions: PageRestrictions;
		canRestrict: boolean;
		me: WikiUserRef;
		onclose: () => void;
	}

	let { pageId, restrictions, canRestrict, me, onclose }: Props = $props();

	const options: { mode: RestrictionMode; title: string; text: string }[] = [
		{ mode: "none", title: "No restrictions", text: "Anyone can view and edit." },
		{
			mode: "edit",
			title: "Editing restricted",
			text: "Anyone can view, only specific people can edit.",
		},
		{
			mode: "view",
			title: "Viewing and editing restricted",
			text: "Only specific people can view or edit.",
		},
	];

	let saveError = $state<string | null>(null);
	let saving = $state(false);
	let mode = $state<RestrictionMode | null>(null);
	let entries = $state<RestrictionEntry[] | null>(null);

	let shownMode = $derived(mode ?? restrictionMode(restrictions));
	let shownEntries = $derived(
		entries ?? restrictionEntries(restrictions),
	);

	function choose(next: RestrictionMode) {
		mode = next;
		// Confluence adds the person who restricts, so they cannot lock themselves out
		if (next !== "none" && shownEntries.length === 0) {
			entries = [{ kind: "user", user: me, canEdit: true }];
		}
	}

	const entryKey = (entry: RestrictionEntry) =>
		entry.kind === "user" ? `u:${entry.user.id}` : `g:${entry.name}`;

	function add(entry: RestrictionEntry) {
		if (shownEntries.some((existing) => entryKey(existing) === entryKey(entry)))
			return;
		entries = [...shownEntries, entry];
	}

	function change(entry: RestrictionEntry, next: RestrictionEntry | null) {
		entries = shownEntries.flatMap((existing) =>
			existing === entry ? (next ? [next] : []) : [existing],
		);
	}

	async function save() {
		saving = true;
		saveError = null;
		try {
			await api(
				`/api/wiki/pages/${encodeURIComponent(pageId)}/restrictions`,
				{
					method: "PUT",
					body: JSON.stringify(restrictionInput(shownMode, shownEntries)),
				},
			);
			await invalidate("app:wiki-editor");
			onclose();
		} catch (error) {
			saveError = errorMessage(error);
		} finally {
			saving = false;
		}
	}

	// ---- user and group type-ahead
	let pickerText = $state("");
	let pickerOpen = $state(false);
	let picker = $state<HTMLDivElement>();
	let userHits = $state<UserRef[]>([]);
	let groupHits = $state<string[]>([]);
	let hitsPending = $state(false);

	$effect(() => {
		if (!pickerOpen) return;
		const query = pickerText.trim();
		if (query === "") {
			userHits = [];
			groupHits = [];
			return;
		}
		let cancelled = false;
		hitsPending = true;
		const timer = setTimeout(async () => {
			try {
				const [users, groups] = await Promise.all([
					api<UserRef[]>(`/api/users?query=${encodeURIComponent(query)}`),
					api<string[]>(
						`/api/wiki/edit/groups?q=${encodeURIComponent(query)}`,
					),
				]);
				if (cancelled) return;
				userHits = users.slice(0, 8);
				groupHits = groups.slice(0, 6);
			} catch {
				if (!cancelled) {
					userHits = [];
					groupHits = [];
				}
			} finally {
				if (!cancelled) hitsPending = false;
			}
		}, 200);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	});

	$effect(() => {
		if (!pickerOpen) return;
		function onMouseDown(event: MouseEvent) {
			if (picker && !picker.contains(event.target as Node)) pickerOpen = false;
		}
		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			event.preventDefault();
			pickerOpen = false;
		}
		document.addEventListener("mousedown", onMouseDown);
		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("mousedown", onMouseDown);
			document.removeEventListener("keydown", onKeyDown, true);
		};
	});

	function pick(action: () => void) {
		action();
		pickerText = "";
		pickerOpen = false;
	}

	let inherited = $derived(
		restrictions.inherited.filter(
			(item) => item.read.users.length + item.read.groups.length > 0,
		),
	);
</script>

{#snippet footer()}
	<Button
		appearance="primary"
		onclick={save}
		isLoading={saving}
		isDisabled={!canRestrict}
	>
		Apply
	</Button>
	<Button appearance="subtle" onclick={onclose}>Cancel</Button>
{/snippet}

<Modal title="Restrictions" width={520} onClose={onclose} {footer}>
	<fieldset class="restriction-set" disabled={!canRestrict}>
			<legend class="wed-label">Who can access this page</legend>
			{#each options as option (option.mode)}
				<label
					class="wed-radio-card"
					data-checked={shownMode === option.mode}
				>
					<input
						type="radio"
						name="restriction-mode"
						checked={shownMode === option.mode}
						onchange={() => choose(option.mode)}
					/>
					<span>
						<span class="wed-radio-title">{option.title}</span>
						<br />
						<span class="wed-hint">{option.text}</span>
					</span>
				</label>
			{/each}
			{#if shownMode !== "none"}
				<div class="picker-wrap" bind:this={picker}>
					<input
						class="wed-input"
						aria-label="Add a user or group"
						placeholder="Add a user or group"
						bind:value={pickerText}
						oninput={() => (pickerOpen = true)}
						onfocus={() => (pickerOpen = true)}
					/>
					{#if pickerOpen && pickerText.trim() !== ""}
						<div
							class="wed-popup"
							role="listbox"
							aria-label="Matching users and groups"
						>
							{#if userHits.length > 0}
								<div class="wed-popup-heading">Users</div>
							{/if}
							{#each userHits as user (user.id)}
								<button
									type="button"
									role="option"
									aria-selected={false}
									class="wed-popup-item"
									onclick={() =>
										pick(() => add({ kind: "user", user, canEdit: true }))}
								>
									<Avatar {user} size={20} />
									<span>{user.displayName}</span>
								</button>
							{/each}
							{#if groupHits.length > 0}
								<div class="wed-popup-heading">Groups</div>
							{/if}
							{#each groupHits as name (name)}
								<button
									type="button"
									role="option"
									aria-selected={false}
									class="wed-popup-item"
									onclick={() => pick(() => add({ kind: "group", name, canEdit: true }))}
								>
									{name}
								</button>
							{/each}
							{#if userHits.length + groupHits.length === 0 && !hitsPending}
								<div class="wed-popup-heading">No users or groups found</div>
							{/if}
						</div>
					{/if}
				</div>
				<ul class="wed-subjects">
					{#each shownEntries as entry (entryKey(entry))}
						<li class="wed-subject">
							{#if entry.kind === "user"}
								<Avatar user={entry.user} size={24} />
							{/if}
							<span class="wed-subject-name">
								{entry.kind === "user"
									? entry.user.displayName
									: `${entry.name} (group)`}
							</span>
							{#if shownMode === "view"}
								<select
									aria-label="Permission"
									class="wed-input permission-select"
									value={entry.canEdit ? "edit" : "view"}
									onchange={(event) =>
										change(entry, {
											...entry,
											canEdit: event.currentTarget.value === "edit",
										})}
								>
									<option value="edit">Can edit</option>
									<option value="view">Can view</option>
								</select>
							{:else}
								<span class="wed-hint no-margin">Can edit</span>
							{/if}
							<button
								type="button"
								class="wed-icon-button"
								aria-label={`Remove ${entry.kind === "user" ? entry.user.displayName : entry.name}`}
								onclick={() => change(entry, null)}
							>
								<Icon name="close" size={14} />
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			{#if inherited.length > 0}
				<p class="wed-hint">
					Also view-restricted by {inherited.map((line) => line.title).join(", ")}
					higher up the page tree.
				</p>
			{/if}
		</fieldset>
	{#if !canRestrict}
		<p class="wed-hint">
			You do not have permission to change the restrictions of this page.
		</p>
	{/if}
	{#if saveError}
		<p class="wed-error" role="alert">{saveError}</p>
	{/if}
</Modal>

<style>
	.restriction-set {
		border: 0;
		margin: 0;
		padding: 0;
	}
	.picker-wrap {
		position: relative;
	}
	.permission-select {
		width: 110px;
	}
	.no-margin {
		margin: 0;
	}
</style>
