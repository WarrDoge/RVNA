<script lang="ts">
	import { browser } from "$app/env";
	import { onMount, untrack } from "svelte";
	import { enhance } from "$app/forms";
	import type { NotificationSettings } from "#lib/api-types.ts";
	import Button from "#lib/components/Button.svelte";

	type FormData = {
		error?: string;
		intent?: string;
		saved?: NotificationSettings;
	} | null;

	interface Props {
		settings: NotificationSettings;
		form?: FormData;
	}

	let { settings, form }: Props = $props();

	let draft = $state<NotificationSettings | null>(null);
	let current = $derived(draft ?? settings);
	let dirty = $state(false);
	let notice = $state<string | null>(null);
	let busy = $state(false);
	let serverNotice = $derived(
		form && "intent" in form && form.intent === "saveNotifications"
			? "error" in form && form.error
				? form.error
				: "Your notification settings were saved."
			: null,
	);
	let shownNotice = $derived(notice ?? serverNotice);
	let emailFormat = $state(untrack(() => current.emailFormat));

	// A format picked before hydration is in the bound group but not in the draft yet.
	onMount(() => {
		if (emailFormat !== current.emailFormat) update({ emailFormat });
	});

	function update(values: Partial<NotificationSettings>) {
		draft = { ...current, ...values };
		dirty = true;
		notice = null;
	}
</script>

<section class="settings">
	<h2>Notifications</h2>
	<p class="intro">Choose which issue changes reach you and how they arrive.</p>

	<form
		method="POST"
		use:enhance={() => {
			busy = true;
			notice = null;
			return async ({ result, update: apply }) => {
				busy = false;
				if (result.type === "failure") {
					const failure = result.data as { error?: unknown } | null;
					notice =
						typeof failure?.error === "string"
							? failure.error
							: "Could not save";
					return;
				}
				if (result.type === "error") {
					notice = "Could not save";
					return;
				}
				notice = "Your notification settings were saved.";
				dirty = false;
				draft = null;
				await apply({ reset: false });
			};
		}}
	>
		<input type="hidden" name="intent" value="saveNotifications" />
		<div class="row">
			<div>
				<span class="label">Email notifications</span>
				<p class="help">
					Send me email about changes to issues I watch, report or am
					assigned to.
				</p>
			</div>
			<label class="check">
				<input
					type="checkbox"
					name="emailNotifications"
					aria-label="Email notifications"
					bind:checked={() => current.emailNotifications, (value) =>
						update({ emailNotifications: value })}
				/>
				<span>{current.emailNotifications ? "Enabled" : "Disabled"}</span>
			</label>
		</div>

		<div class="row">
			<div>
				<span class="label">Notify me of my own changes</span>
				<p class="help">Include changes I make myself in my notifications.</p>
			</div>
			<label class="check">
				<input
					type="checkbox"
					name="notifyOwnChanges"
					aria-label="Notify me of my own changes"
					bind:checked={() => current.notifyOwnChanges, (value) =>
						update({ notifyOwnChanges: value })}
				/>
				<span>{current.notifyOwnChanges ? "Enabled" : "Disabled"}</span>
			</label>
		</div>

		<div class="row">
			<div>
				<span class="label">Autowatch</span>
				<p class="help">Watch issues I create, comment on or am assigned to.</p>
			</div>
			<label class="check">
				<input
					type="checkbox"
					name="autoWatch"
					aria-label="Autowatch"
					bind:checked={() => current.autoWatch, (value) =>
						update({ autoWatch: value })}
				/>
				<span>{current.autoWatch ? "Enabled" : "Disabled"}</span>
			</label>
		</div>

		<div class="row">
			<span class="label">Email format</span>
			<div role="radiogroup" aria-label="Email format" class="formats">
				<label class="check">
					<input
						type="radio"
						name="emailFormat"
						value="html"
						bind:group={emailFormat}
						onchange={() => update({ emailFormat: "html" })}
					/>
					<span>HTML</span>
				</label>
				<label class="check">
					<input
						type="radio"
						name="emailFormat"
						value="text"
						bind:group={emailFormat}
						onchange={() => update({ emailFormat: "text" })}
					/>
					<span>Plain text</span>
				</label>
			</div>
		</div>

		<div class="save">
			<Button
				type="submit"
				appearance="primary"
				isDisabled={browser && !dirty}
				isLoading={busy}
			>
				Save
			</Button>
			{#if shownNotice}
				<span role="status" class="notice">{shownNotice}</span>
			{/if}
		</div>
	</form>
</section>

<style>
	form {
		margin: 0;
	}

	.settings {
		max-width: 760px;
	}

	h2 {
		margin: 0 0 8px;
		font-size: 20px;
		font-weight: 500;
		line-height: 24px;
	}

	.intro {
		margin: 0 0 8px;
		color: var(--ds-text-subtle);
	}

	.row {
		display: grid;
		grid-template-columns: 280px 1fr;
		gap: 16px;
		align-items: start;
		padding: 12px 0;
		border-bottom: 1px solid var(--ds-border);
	}

	.label {
		font-size: 14px;
		font-weight: 500;
		color: var(--ds-text);
	}

	.help {
		margin: 2px 0 0;
		font-size: 12px;
		color: var(--ds-text-subtle);
	}

	.check {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
	}

	.formats {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.save {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 16px;
	}

	.notice {
		color: var(--ds-text-subtle);
		font-size: 13px;
	}
</style>
