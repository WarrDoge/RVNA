<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { Snippet } from "svelte";
	import { profileHref } from "../profile-link.ts";

	interface Props {
		username: string;
		children: Snippet;
		style?: string;
		[key: string]: unknown;
	}

	let { username, children, style, ...rest }: Props = $props();

	let linkStyle = $derived(
		`color: ${token("color.link")}; text-decoration: none;${style ? ` ${style}` : ""}`,
	);
</script>

<a {...rest} href={profileHref(username)} style={linkStyle}>{@render children()}</a>
