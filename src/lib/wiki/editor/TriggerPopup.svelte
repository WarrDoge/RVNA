<script lang="ts">
	import type { Editor } from "@tiptap/core";
	import { api } from "#lib/api.ts";
	import type { UserRef } from "#lib/api-types.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import type { EmojiChoice } from "./insert-items.ts";
	import { filterEmoji, filterInsertItems } from "./insert-items.ts";
	import type { InsertActions } from "./insert-actions.ts";
	import { runInsert } from "./insert-actions.ts";
	import Floating from "./Floating.svelte";
	import type { KeyHandler, TriggerMatch } from "./triggers.ts";

	interface Props {
		editor: Editor;
		match: TriggerMatch;
		actions: InsertActions;
		onKeyChange: (handler: KeyHandler | null) => void;
	}

	let { editor, match, actions, onKeyChange }: Props = $props();

	type Item = { key: string; label: string; detail?: string; run: () => void };

	let users = $state<UserRef[]>([]);
	let fetching = $state(false);
	let index = $state(0);

	let range = $derived({ from: match.from, to: match.to });
	let anchorPosition = $derived.by(() => {
		const anchor = editor.view.coordsAtPos(match.from);
		return { left: anchor.left, top: anchor.top, bottom: anchor.bottom };
	});

	function emoticonContent(choice: EmojiChoice) {
		return { type: "emoticon", attrs: choice.attrs };
	}

	let items = $derived.by<Item[]>(() => {
		if (match.kind === "mention") {
			return users.slice(0, 8).map((user) => ({
				key: user.id,
				label: user.displayName,
				detail: user.username,
				run: () => {
					editor
						.chain()
						.focus()
						.insertContentAt(range, [
							{
								type: "mention",
								attrs: {
									userKey: user.id,
									userId: user.id,
									name: user.displayName,
								},
							},
							{ type: "text", text: " " },
						])
						.run();
				},
			}));
		}
		if (match.kind === "emoji") {
			return filterEmoji(match.query).map((choice) => ({
				key: `${choice.name} ${choice.char}`,
				label: `${choice.char} :${choice.name.replace(/ /g, "_")}:`,
				run: () => {
					editor
						.chain()
						.focus()
						.insertContentAt(range, [
							emoticonContent(choice),
							{ type: "text", text: " " },
						])
						.run();
				},
			}));
		}
		return filterInsertItems(match.query)
			.slice(0, 10)
			.map((item) => ({
				key: item.id,
				label: item.label,
				detail: item.group === "Macros" && item.id !== "macros" ? "macro" : "",
				run: () => {
					editor.chain().focus().deleteRange(range).run();
					runInsert(editor, item.id, actions);
				},
			}));
	});

	let active = $derived(Math.min(index, items.length - 1));

	$effect(() => {
		if (match.kind !== "mention") {
			users = [];
			return;
		}
		const query = match.query;
		let cancelled = false;
		fetching = true;
		api<UserRef[]>(`/api/users?query=${encodeURIComponent(query)}`).then(
			(list) => {
				if (cancelled) return;
				users = list;
				fetching = false;
			},
			() => {
				if (cancelled) return;
				users = [];
				fetching = false;
			},
		);
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const handler: KeyHandler = (event) => {
			if (items.length === 0) return false;
			if (event.key === "ArrowDown") index = (active + 1) % items.length;
			else if (event.key === "ArrowUp") {
				index = (active - 1 + items.length) % items.length;
			} else if (event.key === "Enter" || event.key === "Tab") {
				items[active].run();
			} else return false;
			event.preventDefault();
			return true;
		};
		onKeyChange(handler);
		return () => onKeyChange(null);
	});
</script>

{#if items.length > 0 || (match.kind === "mention" && fetching)}
	<Floating anchor={anchorPosition} className="wke-suggest">
		<div role="listbox">
			{#if items.length === 0}
				<div class="wke-muted wke-suggest-empty">
					{fetching ? "Searching..." : "No users found."}
				</div>
			{/if}
			{#each items as item, itemIndex (item.key)}
				<button
					type="button"
					role="option"
					aria-selected={itemIndex === active}
					class="wke-menu-item{itemIndex === active ? ' is-active' : ''}"
					onmousemove={() => (index = itemIndex)}
					onclick={item.run}
				>
					{#if match.kind === "mention"}
						<span class="wke-person">
							<Avatar user={users[itemIndex]} size={20} />
							<span>{item.label}</span>
							{#if item.detail}
								<span class="wke-muted">{item.detail}</span>
							{/if}
						</span>
					{:else}
						<span>
							{item.label}
							{#if item.detail}<span class="wke-muted"> {item.detail}</span>{/if}
						</span>
					{/if}
				</button>
			{/each}
		</div>
	</Floating>
{/if}
