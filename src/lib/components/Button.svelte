<!--
	The CSS of this component is adapted from the package @atlaskit/button.
	Copyright 2019 Atlassian Pty Ltd. Licensed under the Apache License, Version 2.0; see LICENSE and NOTICE.
	Changed for RVNA.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	type Appearance = "default" | "primary" | "subtle" | "danger";
	type Spacing = "default" | "compact";

	interface Props {
		appearance?: Appearance;
		spacing?: Spacing;
		isLoading?: boolean;
		isDisabled?: boolean;
		isSelected?: boolean;
		href?: string;
		type?: "button" | "submit" | "reset";
		onclick?: (event: MouseEvent) => void;
		children: Snippet;
		"aria-label"?: string;
		"aria-labelledby"?: string;
		[key: string]: unknown;
	}

	let {
		appearance = "default",
		spacing = "default",
		isLoading = false,
		isDisabled = false,
		isSelected = false,
		href,
		type = "button",
		onclick,
		children,
		"aria-label": ariaLabel,
		"aria-labelledby": ariaLabelledBy,
		...rest
	}: Props = $props();

	const uid = $props.id();
	const loadingLabelId = `${uid}-loading`;
	const loadingLabel = ", Loading";

	let classes = $derived(
		[
			"button",
			appearance === "default" ? "" : appearance,
			spacing === "compact" ? "compact" : "",
			isSelected ? "selected" : "",
			isLoading ? "loading" : "",
		]
			.filter(Boolean)
			.join(" "),
	);
	let resolvedAriaLabel = $derived(
		isLoading && ariaLabel && !ariaLabelledBy
			? `${ariaLabel} ${loadingLabel}`
			: ariaLabel,
	);
	let resolvedAriaLabelledBy = $derived(
		isLoading && ariaLabelledBy
			? `${ariaLabelledBy} ${loadingLabelId}`
			: ariaLabelledBy,
	);
	let spinnerSize = $derived(spacing === "compact" ? 16 : 24);
	let spinnerStroke = $derived(
		appearance === "primary" || appearance === "danger"
			? "var(--ds-icon-inverse, #FFFFFF)"
			: "var(--ds-icon-subtle, #505258)",
	);
</script>

{#snippet content()}
	<span class="button-content">{@render children()}</span>
	{#if isLoading}
		<span class="button-loading-overlay">
			<span
				data-testid="spinner-wrapper"
				class="button-spinner"
				style="animation-delay: 0ms; width: {spinnerSize}px; height: {spinnerSize}px;"
			>
				<svg
					height={spinnerSize}
					width={spinnerSize}
					viewBox="0 0 16 16"
					xmlns="http://www.w3.org/2000/svg"
					role="none"
					style="animation-delay: 0ms;"
				>
					<circle
						cx="8"
						cy="8"
						r="7"
						class="button-spinner-circle"
						style="stroke: {spinnerStroke};"
					></circle>
				</svg>
			</span>
		</span>
		<span id={loadingLabelId} class="visually-hidden">{loadingLabel}</span>
	{/if}
{/snippet}

{#if href !== undefined}
	<a
		{href}
		class={classes}
		aria-label={resolvedAriaLabel}
		aria-labelledby={resolvedAriaLabelledBy}
		aria-disabled={isLoading || isDisabled ? "true" : undefined}
		tabindex={isLoading || isDisabled ? -1 : undefined}
		onclick={(event) => {
			if (isLoading || isDisabled) {
				event.preventDefault();
				return;
			}
			onclick?.(event);
		}}
		{...rest}
	>
		{@render content()}
	</a>
{:else}
	<button
		{type}
		class={classes}
		aria-live="polite"
		aria-label={resolvedAriaLabel}
		aria-labelledby={resolvedAriaLabelledBy}
		aria-disabled={isLoading || isDisabled ? "true" : undefined}
		disabled={isDisabled || isLoading}
		{onclick}
		{...rest}
	>
		{@render content()}
	</button>
{/if}

<style>
	.button {
		display: inline-flex;
		position: relative;
		box-sizing: border-box;
		width: auto;
		max-width: 100%;
		height: 2rem;
		padding-block: var(--ds-space-075, 6px);
		padding-inline: var(--ds-space-150, 9pt);
		border: 0;
		border-radius: var(--ds-radius-medium, 6px);
		background-color: var(--ds-background-neutral-subtle, #00000000);
		color: var(--ds-text-subtle, #505258);
		font: var(
			--ds-font-body,
			normal 400 14px/20px "Inter", ui-sans-serif, -apple-system,
			BlinkMacSystemFont, "Segoe UI", Ubuntu, "Helvetica Neue", sans-serif
		);
		text-align: center;
		text-decoration-line: none;
		text-decoration-color: currentColor;
		text-decoration-style: solid;
		vertical-align: middle;
		align-items: baseline;
		justify-content: center;
		column-gap: var(--ds-space-050, 4px);
		flex-shrink: 0;
		cursor: pointer;
		appearance: none;
		transition: var(
			--ds-button-hovered,
			background-color border-color 0.15s cubic-bezier(0.4, 1, 0.6, 1)
		);
	}

	.button:hover {
		background-color: var(--ds-background-neutral-subtle-hovered, #0515240f);
	}

	.button:active {
		background-color: var(--ds-background-neutral-subtle-pressed, #0b120e24);
		transition: var(
			--ds-button-pressed,
			background-color border-color 0.15s cubic-bezier(0.4, 1, 0.6, 1)
		);
	}

	.button.primary {
		background-color: var(--ds-background-brand-bold, #1868db);
		color: var(--ds-text-inverse, #fff);
	}

	.button.primary:hover {
		background-color: var(--ds-background-brand-bold-hovered, #1558bc);
	}

	.button.primary:active {
		background-color: var(--ds-background-brand-bold-pressed, #144794);
	}

	.button.subtle {
		background-color: var(--ds-background-neutral-subtle, #00000000);
		color: var(--ds-text-subtle, #505258);
	}

	.button.subtle:hover {
		background-color: var(--ds-background-neutral-subtle-hovered, #0515240f);
	}

	.button.subtle:active {
		background-color: var(--ds-background-neutral-subtle-pressed, #0b120e24);
	}

	.button.danger {
		background-color: var(--ds-background-danger-bold, #c9372c);
		color: var(--ds-text-inverse, #fff);
	}

	.button.danger:hover {
		background-color: var(--ds-background-danger-bold-hovered, #ae2e24);
	}

	.button.danger:active {
		background-color: var(--ds-background-danger-bold-pressed, #872821);
	}

	.button.selected {
		background-color: var(--ds-background-selected, #e9f2fe);
		color: var(--ds-text-selected, #1868db);
	}

	.button.selected:hover {
		background-color: var(--ds-background-selected-hovered, #cfe1fd);
	}

	.button.selected:active {
		background-color: var(--ds-background-selected-pressed, #8fb8f6);
	}

	.button:disabled {
		background-color: transparent;
		color: var(--ds-text-disabled, #080f214a);
		cursor: not-allowed;
		transition: background 0.1s ease-out;
	}

	.button.primary:disabled,
	.button.danger:disabled {
		background-color: var(--ds-background-disabled, #0515240f);
	}

	.button.loading {
		cursor: progress;
		transition: background 0.1s ease-out;
	}

	.button.compact {
		height: 1.5rem;
		padding-block: var(--ds-space-025, 2px);
		border-radius: var(--ds-radius-small, 4px);
	}

	.button:focus-visible {
		outline-color: var(--ds-border-focused, #2684ff);
		outline-offset: var(--ds-border-width-focused, 2px);
		outline-style: solid;
		outline-width: var(--ds-border-width-focused, 2px);
	}

	.button:focus:not(:focus-visible) {
		outline-color: currentColor;
		outline-style: none;
		outline-width: medium;
	}

	.button::after {
		content: "";
		position: absolute;
		inset: var(--ds-space-0, 0);
		border-radius: inherit;
		border-style: solid;
		border-width: var(--ds-border-width, 1px);
		border-color: var(--ds-border, #0b120e24);
		pointer-events: none;
	}

	.button.primary::after,
	.button.subtle::after,
	.button.danger::after {
		content: none;
		border-color: currentColor;
	}

	.button.selected::after {
		content: "";
		border-color: var(--ds-border-selected, #1868db);
	}

	.button:disabled::after {
		border-color: var(--ds-border-disabled, #0515240f);
	}

	.button.primary:disabled::after,
	.button.subtle:disabled::after,
	.button.danger:disabled::after {
		border-color: currentColor;
	}

	.button-content {
		flex-grow: 1;
		flex-shrink: 1;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		transition: opacity 0.3s;
	}

	.button.loading .button-content {
		opacity: 0;
	}

	.button-loading-overlay {
		position: absolute;
		inset: var(--ds-space-0, 0);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}

	.button-spinner {
		display: inline-flex;
		vertical-align: middle;
		animation: button-spinner-rotate 0.86s cubic-bezier(0.4, 0.15, 0.6, 0.85)
			infinite;
		transform-origin: center;
	}

	.button-spinner svg {
		display: block;
		animation: button-spinner-dash 1s ease-in-out;
		animation-fill-mode: both;
	}

	.button-spinner-circle {
		fill: none;
		stroke-width: 1.5;
		stroke-dasharray: 60;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		border: 0;
		overflow: hidden;
		clip: rect(1px, 1px, 1px, 1px);
		white-space: nowrap;
		user-select: none;
	}

	@media screen and (-ms-high-contrast: active), screen and (forced-colors: active) {
		.button:focus-visible {
			outline-style: solid;
			outline-width: 1px;
		}
	}

	@keyframes button-spinner-rotate {
		to {
			transform: rotate(1turn);
		}
	}

	@keyframes button-spinner-dash {
		0% {
			transform: rotate(50deg);
			stroke-dashoffset: 60;
		}
		to {
			transform: rotate(230deg);
			stroke-dashoffset: 50;
		}
	}
</style>
