<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { Snippet } from "svelte";

	interface Props {
		title: string;
		active?: boolean;
		disabled?: boolean;
		onclick: () => void;
		children: Snippet;
	}

	let {
		title,
		active = false,
		disabled = false,
		onclick,
		children,
	}: Props = $props();

	const base = `height: 26px; min-width: 26px; padding: 0 6px; border: 0; background: transparent; border-radius: 3px; cursor: pointer; font-size: 13px; font-weight: 600; line-height: 26px;`;
	const buttonStyle = $derived(
		active
			? `${base} background-color: ${token(
					"color.background.selected",
				)}; color: ${token("color.text.selected")};`
			: `${base} color: ${token("color.text.subtle")};`,
	);
</script>

<button
	type="button"
	title={title}
	aria-label={title}
	aria-pressed={active}
	disabled={disabled}
	style={buttonStyle}
	onmousedown={(event) => event.preventDefault()}
	onclick={onclick}
>
	{@render children()}
</button>
