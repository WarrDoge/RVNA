<script lang="ts">
	import { absoluteDate } from "#lib/dates.ts";
	import Button from "#lib/components/Button.svelte";
	import Banner from "./Banner.svelte";
	import type { ResumeOffer } from "./helpers.ts";

	interface Props {
		offer: ResumeOffer;
		onresume: () => void;
		ondiscard: () => void;
		busy: boolean;
	}

	let { offer, onresume, ondiscard, busy }: Props = $props();
</script>

{#snippet actions()}
	<Button appearance="primary" onclick={onresume} isDisabled={busy}>
		Resume editing
	</Button>
	<Button onclick={ondiscard} isDisabled={busy}>Discard</Button>
{/snippet}

<Banner tone="info" title="You have an unpublished draft of this page" {actions}>
	Last saved {absoluteDate(offer.savedAt)}{offer.source === "browser"
		? " in this browser; it never reached the server."
		: "."}
</Banner>
