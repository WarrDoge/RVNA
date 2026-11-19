<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { token } from "#lib/tokens.ts";
	import Icon from "#lib/components/Icon.svelte";
	import { suggestPages } from "./api.ts";
	import { isWikiPath } from "./context.ts";
	import { pageTitleHref } from "./format.ts";
	import type { Suggestion } from "./types.ts";

	let value = $state("");
	let focused = $state(false);
	let selected = $state(0);
	let suggestions = $state<Suggestion[]>([]);
	let container = $state<HTMLDivElement>();

	let onWiki = $derived(isWikiPath(page.url.pathname));
	let visible = $derived(
		focused && value.trim().length > 1 ? suggestions : [],
	);

	$effect(() => {
		if (!onWiki || !focused) return;
		const query = value.trim();
		if (query.length <= 1) {
			suggestions = [];
			return;
		}
		const controller = new AbortController();
		const timer = setTimeout(() => {
			suggestPages(query, controller.signal)
				.then((rows) => {
					if (!controller.signal.aborted) suggestions = rows;
				})
				.catch(() => {
					if (!controller.signal.aborted) suggestions = [];
				});
		}, 175);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});

	$effect(() => {
		if (!focused) return;
		function close(event: MouseEvent) {
			if (!container?.contains(event.target as Node)) {
				focused = false;
			}
		}
		document.addEventListener("mousedown", close);
		return () => document.removeEventListener("mousedown", close);
	});

	function submit() {
		const query = value.trim();
		if (query === "") return;
		void goto(
			`/dosearchsite.action?queryString=${encodeURIComponent(query)}`,
		);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === "Enter") {
			const row = visible[selected];
			if (row) {
				focused = false;
				void goto(pageTitleHref(row.spaceKey, row.title));
			} else {
				submit();
			}
		} else if (event.key === "ArrowDown") {
			event.preventDefault();
			selected = Math.min(selected + 1, visible.length - 1);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			selected = Math.max(selected - 1, 0);
		} else if (event.key === "Escape") {
			focused = false;
		}
	}
</script>

<div bind:this={container} class="search">
	<span class="icon"><Icon name="search" size={14} /></span>
	<input
		type="text"
		placeholder="Search"
		aria-label="Search"
		bind:value={() => value, (next) => {
			value = next;
			selected = 0;
		}}
		onfocus={() => (focused = true)}
		onkeydown={onKeydown}
	/>
	{#if visible.length > 0}
		<div class="wiki-suggestions" role="listbox" aria-label="Pages">
			{#each visible as row, index (row.id)}
				<a
					role="option"
					aria-selected={index === selected}
					class="wiki-suggestion"
					href={pageTitleHref(row.spaceKey, row.title)}
					onmousedown={(event) => event.preventDefault()}
					onclick={() => {
						focused = false;
					}}
					style={index === selected
						? `background: ${token(
								"color.background.neutral.subtle.hovered",
							)};`
						: undefined}
				>
					{row.title}
					<span>{row.spaceName}</span>
				</a>
			{/each}
		</div>
	{/if}
</div>

<style>
	.search {
		position: relative;
		display: inline-flex;
		align-items: center;
		width: 160px;
		height: 28px;
	}

	.icon {
		position: absolute;
		left: 7px;
		display: inline-flex;
		color: var(--ds-text-subtle);
		z-index: 1;
	}

	input {
		width: 100%;
		height: 28px;
		padding: 0 8px 0 26px;
		background: transparent;
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text);
		outline: none;
		font-size: 14px;
	}
</style>
