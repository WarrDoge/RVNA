<script lang="ts">
	import { untrack } from "svelte";
	import { localDateValue } from "./helpers.ts";
	import Floating from "./Floating.svelte";
	import type { Anchor } from "./Floating.svelte";

	interface Props {
		anchor: Anchor;
		initial?: string;
		onpick: (date: string) => void;
		onclose: () => void;
	}

	let { anchor, initial, onpick, onclose }: Props = $props();

	let value = $state(
		untrack(() =>
			initial && /^\d{4}-\d{2}-\d{2}/.test(initial)
				? initial.slice(0, 10)
				: localDateValue(new Date()),
		),
	);
	let box = $state<HTMLDivElement>();

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

<Floating {anchor} className="wke-picker wke-date-picker">
	<div bind:this={box}>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			autofocus
			type="date"
			class="wke-input"
			aria-label="Date"
			bind:value
			onkeydown={(event) => {
				if (event.key === "Enter" && value) {
					event.preventDefault();
					onpick(value);
				}
			}}
		/>
		<button
			type="button"
			class="wke-primary-button"
			disabled={!value}
			onclick={() => onpick(value)}
		>
			{initial ? "Change date" : "Insert date"}
		</button>
	</div>
</Floating>
