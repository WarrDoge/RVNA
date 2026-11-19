<script module lang="ts">
	export {
		closeCreateIssue,
		openCreateIssue,
	} from "./create-issue-state.svelte.ts";
</script>

<script lang="ts">
	import { goto } from "$app/navigation";
	import { token } from "#lib/tokens.ts";
	import { onMount } from "svelte";
	import Icon from "#lib/components/Icon.svelte";
	import CreateIssueDialog from "#lib/issue-form/CreateIssueDialog.svelte";
	import { wikiCreateTarget } from "#lib/wiki/context.ts";
		import { installShortcut } from "./shortcuts.ts";
	import {
		closeCreateIssue,
		createIssueState,
		openCreateIssue,
	} from "./create-issue-state.svelte.ts";

	let created = $state<string | null>(null);
	let timer: number | undefined;

	// The shell's one `c` handler: no modifier, no typing target and no open dialog.
	onMount(() => {
		const stop = installShortcut((key, event) => {
			if (key !== "c" || createIssueState.defaults !== null) return;
			event.preventDefault();
			openCreateIssue();
		});
		return () => {
			stop();
			window.clearTimeout(timer);
		};
	});

	// On a wiki address the button creates a page; the `c` shortcut opens the dialog everywhere.
	function create() {
		const wikiTarget = wikiCreateTarget();
		if (wikiTarget) void goto(wikiTarget);
		else openCreateIssue();
	}

	function notifyCreated(key: string) {
		createIssueState.onCreated?.(key);
		created = key;
		window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			created = null;
		}, 10_000);
	}

	const toastStyle = `position: fixed; left: 20px; bottom: 20px; z-index: 300; display: flex; align-items: center; gap: 10px; min-width: 260px; padding: 10px 12px; background-color: ${token(
		"elevation.surface.overlay",
	)}; border: 1px solid ${token(
		"color.border",
	)}; border-radius: 3px; box-shadow: ${token(
		"elevation.shadow.overlay",
	)}; color: ${token("color.text")};`;
	const checkStyle =
		"display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background-color: #22a06b; color: #fff; font-size: 13px; font-weight: 700;";
	const linkStyle = `color: ${token("color.link")}; font-weight: 600;`;
	const dismissStyle = `margin-left: auto; display: inline-flex; padding: 2px; background: transparent; border: 0; color: ${token(
		"color.text.subtle",
	)}; cursor: pointer;`;
</script>

<button type="button" class="create" onclick={create}>
	Create
</button>

{#if createIssueState.defaults !== null}
	{#key createIssueState.defaults}
		<CreateIssueDialog
			defaults={createIssueState.defaults}
			onClose={closeCreateIssue}
			onCreated={notifyCreated}
		/>
	{/key}
{/if}

{#if created}
	<div role="status" style={toastStyle}>
		<span aria-hidden="true" style={checkStyle}>✓</span>
		<span>
			Created <a href={`/browse/${created}`} onclick={() => (created = null)} style={linkStyle}
				>{created}</a
			>
		</span>
		<button
			type="button"
			aria-label="Dismiss"
			onclick={() => (created = null)}
			style={dismissStyle}
		>
			<Icon name="close" size={12} />
		</button>
	</div>
{/if}

<style>
	.create {
		height: 30px;
		margin-left: 10px;
		padding: 4px 10px;
		background-color: var(--ds-background-brand-bold);
		color: var(--ds-text-inverse);
		border: 0;
		border-radius: 3px;
		font-size: 14px;
		font-weight: 600;
		line-height: 20px;
		cursor: pointer;
	}
</style>
