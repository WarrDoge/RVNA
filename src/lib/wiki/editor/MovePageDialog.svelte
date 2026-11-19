<script lang="ts">
	import { untrack } from "svelte";
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import type {
		EditorSpace,
		PageRef,
	} from "#lib/shared/wiki/index.ts";
	import { errorMessage } from "./edit-session.svelte.ts";
	import {
		childrenIndex,
		insertionIndex,
		type Location,
		pathTo,
		type PositionChoice,
		type TreeNode,
	} from "./helpers.ts";
	import LocationPicker from "./LocationPicker.svelte";

	interface Props {
		page: PageRef;
		currentPath: string;
		spaces: EditorSpace[];
		initialTree: TreeNode[];
		cancelHref?: string;
		onclose: () => void;
		onmoved: (page: PageRef) => void;
	}

	let {
		page,
		currentPath,
		spaces,
		initialTree,
		cancelHref,
		onclose,
		onmoved,
	}: Props = $props();

	let location = $state<Location>(
		untrack(() => ({ spaceKey: page.spaceKey, parentId: page.parentId })),
	);
	let choice = $state<PositionChoice>("last");
	let afterId = $state<string | null>(null);
	let tree = $state<TreeNode[]>(untrack(() => initialTree));
	let moving = $state(false);
	let moveError = $state<string | null>(null);

	let siblings = $derived(
		(childrenIndex(tree).get(location.parentId) ?? []).filter(
			(node) => node.id !== page.id,
		),
	);

	async function move() {
		moving = true;
		moveError = null;
		try {
			const moved = await api<PageRef>(
				`/api/wiki/pages/${encodeURIComponent(page.id)}/move`,
				{
					method: "POST",
					body: JSON.stringify({
						spaceKey:
							location.spaceKey === page.spaceKey
								? undefined
								: location.spaceKey,
						parentId: location.parentId,
						position: insertionIndex(siblings, page.id, choice, afterId),
					}),
				},
			);
			onmoved(moved);
		} catch (error) {
			moveError = errorMessage(error);
		} finally {
			moving = false;
		}
	}

	function radio(value: PositionChoice, label: string) {
		return { value, label };
	}
	const radios = [
		radio("first", "First"),
		radio("last", "Last"),
		radio("after", "After"),
	];
</script>

{#snippet footer()}
	<Button
		appearance="primary"
		onclick={move}
		isLoading={moving}
		isDisabled={tree === null}
	>
		Move
	</Button>
	{#if cancelHref}
		<Button href={cancelHref}>Cancel</Button>
	{:else}
		<Button appearance="subtle" onclick={onclose}>Cancel</Button>
	{/if}
{/snippet}

<Modal
	title={`Move page "${page.title || "Untitled"}"`}
	width={560}
	onClose={onclose}
	{footer}
>
	<p class="wed-hint current-location">Current location: {currentPath}</p>
	<LocationPicker
		value={location}
		spaces={spaces}
		initialTree={initialTree}
		excludeId={page.id}
		ontree={(nodes) => (tree = nodes)}
		onchange={(next) => {
			location = next;
			choice = "last";
			afterId = null;
		}}
	/>
	<div class="wed-field position-field">
		<span class="wed-label">Position among its siblings</span>
		<div class="position-row">
			{#each radios as option (option.value)}
				<label class="wed-check position-check">
					<input
						type="radio"
						name="move-position"
						value={option.value}
						bind:group={choice}
						onchange={() => {
							afterId = siblings[0]?.id ?? null;
						}}
					/>
					{option.label}
				</label>
			{/each}
			{#if choice === "after" && siblings.length > 0}
				<select
					class="wed-input after-select"
					aria-label="After page"
					value={afterId ?? ""}
					onchange={(event) => {
						choice = "after";
						afterId = event.currentTarget.value;
					}}
				>
					{#each siblings as sibling (sibling.id)}
						<option value={sibling.id}>{sibling.title}</option>
					{/each}
				</select>
			{/if}
		</div>
	</div>
	{#if moveError}
		<p class="wed-error" role="alert">{moveError}</p>
	{/if}
</Modal>

<style>
	.current-location {
		margin: 0 0 12px;
	}
	.position-field {
		margin-top: 12px;
	}
	.position-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
	}
	.position-check {
		margin-right: 16px;
	}
	.after-select {
		width: 200px;
	}
</style>
