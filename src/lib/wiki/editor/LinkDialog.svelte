<script lang="ts">
	import { untrack } from "svelte";
	import { type Editor, getMarkRange } from "@tiptap/core";
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import type { RiRef } from "#lib/shared/wiki/index.ts";
	import { normalizeUrl, pageLinkAttrs } from "./link-attrs.ts";

	interface PageHit {
		id: string;
		spaceKey: string;
		spaceName: string;
		title: string;
	}
	type Picked = { id: string | null; spaceKey: string; title: string };

	interface Props {
		editor: Editor;
		spaceKey: string;
		onclose: () => void;
	}

	let { editor, spaceKey, onclose }: Props = $props();

	const initial = (() => {
		const { selection, doc, schema } = editor.state;
		let { from, to } = selection;
		const range = getMarkRange(selection.$from, schema.marks.link);
		if (range && selection.empty) ({ from, to } = range);
		const attrs = editor.getAttributes("link") as {
			href: string | null;
			title: string | null;
			ref: RiRef | null;
			anchor: string | null;
		};
		return {
			from,
			to,
			text: doc.textBetween(from, to, " "),
			attrs,
			editing: !!range,
		};
	})();

	const existingRef =
		initial.attrs.ref?.tag === "ri:page" ? initial.attrs.ref : null;
	let tab = $state<"page" | "web">(
		initial.editing && !existingRef ? "web" : "page",
	);
	let query = $state("");
	let allSpaces = $state(false);
	let picked = $state<Picked | null>(
		untrack(() =>
			existingRef
				? {
						id: null,
						spaceKey: existingRef.attrs["ri:space-key"] ?? spaceKey,
						title: existingRef.attrs["ri:content-title"] ?? "",
					}
				: null,
		),
	);
	let url = $state(existingRef ? "" : (initial.attrs.href ?? ""));
	let text = $state(initial.text);
	let hits = $state<PageHit[]>([]);
	let hitsError = $state(false);

	const tabs: [("page" | "web"), string][] = [
		["page", "Search"],
		["web", "Web link"],
	];

	$effect(() => {
		if (tab !== "page") return;
		const search = query.trim();
		const timer = setTimeout(async () => {
			try {
				const result = await api<PageHit[]>(
					`/api/wiki/edit/page-search?q=${encodeURIComponent(search)}${
						allSpaces ? "" : `&spaceKey=${encodeURIComponent(spaceKey)}`
					}`,
				);
				hits = result;
				hitsError = false;
			} catch {
				hits = [];
				hitsError = true;
			}
		}, 200);
		return () => clearTimeout(timer);
	});

	let valid = $derived(tab === "page" ? picked !== null : normalizeUrl(url) !== "");

	function focusEditor() {
		editor.commands.focus();
	}

	function close() {
		focusEditor();
		onclose();
	}

	function apply() {
		if (!valid) return;
		const base = {
			title: initial.attrs.title ?? null,
			anchor: initial.attrs.anchor ?? null,
		};
		let attrs: Record<string, unknown>;
		let fallbackText: string;
		if (tab === "page" && picked) {
			const keepHref = picked.id === null ? initial.attrs.href : null;
			attrs = {
				...base,
				...(picked.id
					? pageLinkAttrs({
							id: picked.id,
							spaceKey: picked.spaceKey,
							title: picked.title,
						})
					: { href: keepHref, ref: initial.attrs.ref }),
			};
			fallbackText = picked.title;
		} else {
			const href = normalizeUrl(url);
			attrs = { ...base, anchor: null, href, ref: null };
			fallbackText = href;
		}
		const chain = editor.chain().focus();
		if (initial.from !== initial.to && text === initial.text) {
			chain
				.setTextSelection({ from: initial.from, to: initial.to })
				.setMark("link", attrs)
				.setTextSelection(initial.to)
				.unsetMark("link");
		} else {
			const label = text.trim() === "" ? fallbackText : text;
			chain
				.insertContentAt(
					{ from: initial.from, to: initial.to },
					{ type: "text", text: label, marks: [{ type: "link", attrs }] },
				)
				.unsetMark("link");
		}
		chain.run();
		onclose();
	}

	function removeLink() {
		editor
			.chain()
			.focus()
			.setTextSelection({ from: initial.from, to: initial.to })
			.unsetMark("link")
			.run();
		onclose();
	}
</script>

{#snippet footer()}
	{#if initial.editing}
		<Button appearance="subtle" onclick={removeLink}>Remove link</Button>
	{/if}
	<Button appearance="primary" isDisabled={!valid} onclick={apply}>
		{initial.editing ? "Save" : "Insert"}
	</Button>
	<Button appearance="subtle" onclick={close}>Cancel</Button>
{/snippet}

<Modal
	title={initial.editing ? "Edit link" : "Insert link"}
	width={520}
	onClose={close}
	{footer}
>
	<div class="wke-tabs" role="tablist">
		{#each tabs as [id, label] (id)}
			<button
				type="button"
				role="tab"
				aria-selected={tab === id}
				class={tab === id ? "is-active" : undefined}
				onclick={() => (tab = id)}
			>{label}</button
			>
		{/each}
	</div>
	{#if tab === "page"}
		<div class="wke-field">
			<input
				class="wke-input"
				aria-label="Search for a page"
				placeholder="Search for a page by title"
				bind:value={query}
				onkeydown={(event) => {
					if (event.key !== "Enter") return;
					event.preventDefault();
					if (picked) apply();
					else if (hits[0]) {
						picked = {
							id: hits[0].id,
							spaceKey: hits[0].spaceKey,
							title: hits[0].title,
						};
					}
				}}
			/>
			<label class="wke-field-check wke-inline-check">
				<input type="checkbox" bind:checked={allSpaces} />
				Search all spaces
			</label>
			<div class="wke-results" role="listbox" aria-label="Pages">
				{#if hitsError}
					<div class="wke-muted">Search failed.</div>
				{/if}
				{#if hits.length === 0 && !hitsError}
					<div class="wke-muted">No pages found.</div>
				{/if}
				{#each hits as hit (hit.id)}
					{@const active = picked?.id === hit.id}
					<button
						type="button"
						role="option"
						aria-selected={active}
						class="wke-result{active ? ' is-active' : ''}"
						onclick={() =>
							(picked = {
								id: hit.id,
								spaceKey: hit.spaceKey,
								title: hit.title,
							})}
						ondblclick={apply}
					>
						<span>{hit.title}</span>
						<span class="wke-muted">{hit.spaceName}</span>
					</button>
				{/each}
			</div>
			{#if picked}
				<div class="wke-field-help">
					Linking to <strong>{picked.title}</strong> ({picked.spaceKey})
				</div>
			{/if}
		</div>
	{:else}
		<div class="wke-field">
			<label class="wke-field-label" for="wke-link-url">Web address</label>
			<input
				id="wke-link-url"
				class="wke-input"
				placeholder="https://example.com"
				bind:value={url}
				onkeydown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						apply();
					}
				}}
			/>
		</div>
	{/if}
	<div class="wke-field">
		<label class="wke-field-label" for="wke-link-text">Link text (optional)</label>
		<input
			id="wke-link-text"
			class="wke-input"
			placeholder={tab === "page" ? (picked?.title ?? "") : url}
			bind:value={text}
			onkeydown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					apply();
				}
			}}
		/>
	</div>
</Modal>
