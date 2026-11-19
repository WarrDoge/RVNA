<script lang="ts">
	import type { EmojiChoice } from "./insert-items.ts";
	import { emojiChoices, filterEmoji } from "./insert-items.ts";
	import Floating from "./Floating.svelte";
	import type { Anchor } from "./Floating.svelte";

	interface Props {
		anchor: Anchor;
		onpick: (choice: EmojiChoice) => void;
		onclose: () => void;
	}

	let { anchor, onpick, onclose }: Props = $props();

	let query = $state("");
	let box = $state<HTMLDivElement>();

	let choices = $derived(query === "" ? emojiChoices : filterEmoji(query, 60));

	$effect(() => {
		function onMouseDown(event: MouseEvent) {
			if (box && !box.contains(event.target as Node)) onclose();
		}
		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			event.preventDefault();
			onclose();
		}
		document.addEventListener("mousedown", onMouseDown);
		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("mousedown", onMouseDown);
			document.removeEventListener("keydown", onKeyDown, true);
		};
	});
</script>

<Floating {anchor} className="wke-picker">
	<div bind:this={box}>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			autofocus
			class="wke-input"
			aria-label="Search emoji"
			placeholder="Search emoji"
			value={query}
			oninput={(event) => (query = event.currentTarget.value)}
			onkeydown={(event) => {
				if (event.key === "Enter" && choices[0]) {
					event.preventDefault();
					onpick(choices[0]);
				}
			}}
		/>
		<div class="wke-emoji-grid">
			{#each choices as choice (`${choice.name} ${choice.char}`)}
				<button
					type="button"
					title={choice.name}
					aria-label={choice.name}
					onclick={() => onpick(choice)}
				>
					{choice.char}
				</button>
			{/each}
			{#if choices.length === 0}
				<div class="wke-muted">No emoji found.</div>
			{/if}
		</div>
	</div>
</Floating>
