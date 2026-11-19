<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { Snippet } from "svelte";
	import Icon from "./Icon.svelte";

	interface Props {
		title: string;
		actions?: Snippet;
		children: Snippet;
		defaultOpen?: boolean;
	}

	let { title, actions, children, defaultOpen = true }: Props = $props();

	// svelte-ignore state_referenced_locally
	let open = $state(defaultOpen);

	const sectionStyle = "margin-bottom: 20px;";
	const headerStyle = `display: flex; align-items: center; gap: 4px; padding-bottom: 4px; border-bottom: 1px solid ${token(
		"color.border",
	)};`;
	let toggleStyle = $derived(`display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; padding: 0; background: transparent; border: 0; border-radius: 3px; color: ${token(
		"color.text.subtle",
	)}; cursor: pointer; transform: ${open ? "none" : "rotate(-90deg)"};`);
	const titleStyle = `margin: 0; font-size: 14px; font-weight: 600; line-height: 20px; color: ${token(
		"color.text",
	)};`;
	const actionsStyle =
		"margin-left: auto; display: flex; align-items: center; gap: 8px;";
</script>

<section style={sectionStyle}>
	<div style={headerStyle}>
		<button
			type="button"
			aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
			aria-expanded={open}
			onclick={() => (open = !open)}
			style={toggleStyle}
		>
			<Icon name="chevron-down" size={12} />
		</button>
		<h3 style={titleStyle}>{title}</h3>
		{#if actions}
			<div style={actionsStyle}>
				{@render actions()}
			</div>
		{/if}
	</div>
	{#if open}
		<div style="padding-top: 12px;">
			{@render children()}
		</div>
	{/if}
</section>
