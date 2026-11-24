<script lang="ts">
	import { enhance } from "$app/forms";
	import type { Profile } from "#lib/api-types.ts";
	import Button from "#lib/components/Button.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import { profileJql } from "./profile-jql.ts";

	interface Props {
		profile: Profile;
		notice: string | null;
		selfHasPassword: boolean | undefined;
	}

	let { profile, notice, selfHasPassword }: Props = $props();

	let confirming = $state(false);
	let pending = $state(false);
	let signOutForm = $state<HTMLFormElement>();

	let summary = $derived(
		!profile.isSelf
			? `This is ${profile.displayName}'s profile.`
			: selfHasPassword === true
				? "This is your profile. An administrator manages your account."
				: selfHasPassword === false
					? "This is your profile. Your name, username and groups come from the identity provider."
					: "This is your profile.",
	);
</script>

<div>
	{#if notice}
		<p role="status" class="notice">{notice}</p>
	{/if}

	<h2 class="summary-heading">Summary</h2>
	<p class="summary">{summary}</p>

	<div class="cards">
		<section class="card">
			<h3>Assigned open issues</h3>
			<a
				href={`/issues/?jql=${encodeURIComponent(profileJql(profile))}`}
				class="count"
			>
				{profile.assignedOpenIssues}
			</a>
			<div class="card-note">
				Open issues assigned to {profile.isSelf ? "you" : profile.displayName}
			</div>
		</section>

		{#if profile.isSelf}
			<section class="card">
				<h3>Personal access tokens</h3>
				<p>Tokens authenticate scripts against the RVNA API.</p>
				<a href="/secure/ViewProfile.jspa?selectedTab=tokens">
					Manage personal access tokens
				</a>
			</section>
			<section class="card">
				<h3>Sessions</h3>
				<p>
					Sign out of every browser where you are signed in, this one too. API
					tokens keep working.
				</p>
				<Button onclick={() => (confirming = true)}>Sign out everywhere</Button>
			</section>
		{/if}
	</div>
</div>

{#if confirming}
	<form
		method="POST"
		bind:this={signOutForm}
		use:enhance={() => {
			pending = true;
			return async ({ update }) => {
				pending = false;
				await update();
			};
		}}
	>
		<input type="hidden" name="intent" value="signOutEverywhere" />
	</form>
	<ConfirmDialog
		title="Sign out everywhere"
		message="This ends every session of your account, including this one. You will need to sign in again."
		confirmLabel="Sign out everywhere"
		{pending}
		onConfirm={() => signOutForm?.requestSubmit()}
		onClose={() => (confirming = false)}
	/>
{/if}

<style>
	.notice {
		margin: 0 0 16px;
		padding: 8px 12px;
		border: 1px solid var(--ds-border-success);
		border-radius: 3px;
		color: var(--ds-text-success);
	}

	.summary-heading {
		margin: 0 0 12px;
		font-size: 20px;
		font-weight: 500;
	}

	.summary {
		margin: 0 0 24px;
		color: var(--ds-text-subtle);
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 16px;
	}

	.card {
		padding: 16px;
		background-color: var(--ds-surface-raised);
		border: 1px solid var(--ds-border);
		border-radius: 3px;
	}

	.card h3 {
		margin: 0 0 4px;
		font-size: 16px;
		font-weight: 500;
	}

	.count {
		font-size: 28px;
		font-weight: 600;
		line-height: 32px;
		color: var(--ds-link);
		text-decoration: none;
	}

	.card-note {
		margin-top: 4px;
		color: var(--ds-text-subtle);
	}

	.card p {
		margin: 0 0 8px;
		color: var(--ds-text-subtle);
	}

	.card a {
		color: var(--ds-link);
	}
</style>
