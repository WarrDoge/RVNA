<script lang="ts">
	import type { Snippet } from "svelte";
	import { hintStyle, labelCellStyle } from "./styles.ts";

	interface Props {
		label: string;
		required?: boolean;
		hint?: string;
		anchorId?: string;
		children: Snippet<[{ id: string; describedBy: string | undefined }]>;
	}

	let {
		label,
		required = false,
		hint,
		anchorId,
		children,
	}: Props = $props();

	const id = $props.id();
	const hintId = `${id}-hint`;
	const describedBy = $derived(hint ? hintId : undefined);
	let valueCell: HTMLDivElement;
	let labelFor = $state(id);

	$effect(() => {
		const control =
			valueCell?.querySelector<HTMLElement>(
				'input:not([type="hidden"]), select, textarea, [contenteditable="true"]',
			) ?? valueCell?.querySelector<HTMLElement>("button");
		if (!control) return;
		if (control.id === "") control.id = id;
		labelFor = control.id;
		if (describedBy && !control.hasAttribute("aria-describedby")) {
			control.setAttribute("aria-describedby", describedBy);
		}
	});
</script>

<label for={labelFor} style={labelCellStyle}>
	{label}
	{#if required}<span style="color: #e5493a;"> *</span>{/if}
</label>
<div bind:this={valueCell} id={anchorId} style="min-width: 0;">
	{@render children({ id, describedBy })}
	{#if hint}<div id={hintId} style={hintStyle}>{hint}</div>{/if}
</div>
