<script lang="ts">
	import { dismiss } from "#lib/components/dismiss.ts";
	import { isRasterImageType } from "#lib/shared/served-type.ts";
	import { attachmentUrl, formatSize } from "#lib/wiki/format.ts";
	import type { Attachment } from "#lib/wiki/types.ts";

	interface Props {
		attachment: Attachment;
		pageSourceId: string;
		onClose: () => void;
	}

	let { attachment, pageSourceId, onClose }: Props = $props();

	let panel = $state<HTMLDivElement>();

	$effect(() => {
		const previous = document.activeElement as HTMLElement | null;
		panel?.focus();
		return () => previous?.focus();
	});

	let url = $derived(
		attachmentUrl(
			pageSourceId,
			attachment.fileName,
			attachment.version,
			true,
		),
	);
	let mime = $derived((attachment.mimeType ?? "").toLowerCase());
</script>

<div class="wiki-preview-backdrop">
	<div
		bind:this={panel}
		class="wiki-preview-panel"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		aria-label={`Preview ${attachment.fileName}`}
		{@attach dismiss(() => true, onClose)}
	>
		<div class="wiki-preview-head">
			<strong>{attachment.fileName}</strong>
			<span class="size">{formatSize(attachment.size)}</span>
			<button type="button" aria-label="Close preview" onclick={onClose}>×</button>
		</div>
		{#if isRasterImageType(mime)}
			<img src={url} alt={attachment.fileName} />
		{:else}
			<iframe src={url} title={attachment.fileName}></iframe>
		{/if}
	</div>
</div>

<style>
	.size {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}
</style>
