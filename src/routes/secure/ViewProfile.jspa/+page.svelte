<script lang="ts">
	import { invalidate } from "$app/navigation";
	import Avatar from "#lib/components/Avatar.svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import ChangePasswordForm from "#lib/shell/ChangePasswordForm.svelte";
	import { getShellContext } from "#lib/shell/context.ts";
	import ForcedPasswordChange from "#lib/shell/ForcedPasswordChange.svelte";
	import AvatarUpload from "./AvatarUpload.svelte";
	import MessengerSection from "./MessengerSection.svelte";
	import NotificationSettingsSection from "./NotificationSettingsSection.svelte";
	import ProfileDetails from "./ProfileDetails.svelte";
	import TokensSection from "./TokensSection.svelte";
	import type { ActionData, PageData } from "./$types";

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const shell = getShellContext();

	let notice = $state<{ username: string; text: string } | null>(null);
	let uploadOpen = $state(false);
	let avatarOverride = $state<{ username: string; url: string } | null>(null);
	let avatarUrl = $derived(
		avatarOverride?.username === data.profile.username
			? avatarOverride.url
			: data.profile.avatarUrl,
	);
	let displayProfile = $derived({ ...data.profile, avatarUrl });
	let displayNotice = $derived(
		notice?.username === data.profile.username ? notice.text : null,
	);
	let unhandledError = $derived(
		form &&
			"error" in form &&
			typeof form.error === "string" &&
			!("intent" in form)
			? form.error
			: null,
	);

	let tokensTab = $derived(data.profile.isSelf && data.tab === "tokens");
	let notificationsTab = $derived(
		data.profile.isSelf && data.tab === "notifications",
	);
	let passwordTab = $derived(
		data.profile.isSelf &&
			Boolean(data.me.hasPassword) &&
			data.tab === "password",
	);
	let detailsTab = $derived(!tokensTab && !notificationsTab && !passwordTab);

	function onUploaded(url: string) {
		uploadOpen = false;
		notice = {
			username: data.profile.username,
			text: data.profile.isSelf
				? "Your avatar was updated."
				: "The avatar was updated.",
		};
		avatarOverride = { username: data.profile.username, url };
		if (data.profile.isSelf) shell?.setAvatarUrl(url);
		void invalidate("app:profile");
	}
</script>

<PageTitle title="Profile" />

{#if unhandledError}
	<p role="alert" class="error-banner">{unhandledError}</p>
{/if}

{#if data.me.mustChangePassword}
	<ForcedPasswordChange {form} />
{:else}
	<section class="profile">
		<div class="columns">
			<div>
				{#if data.profile.canEditAvatar}
					<button
						type="button"
						aria-label="Change avatar"
						title="Change avatar"
						class="avatar-button"
						onclick={() => {
							notice = null;
							uploadOpen = true;
						}}
					>
						<Avatar user={displayProfile} size={96} />
					</button>
				{:else}
					<Avatar user={displayProfile} size={96} />
				{/if}
				<h1>{data.profile.displayName}</h1>
				<div class="username">{data.profile.username}</div>

				<dl class="details">
					<div>
						<dt>Email</dt>
						<dd>
							{#if data.profile.email}
								<a href={`mailto:${data.profile.email}`}>{data.profile.email}</a>
							{:else}
								None
							{/if}
						</dd>
					</div>
					{#if data.profile.isSelf || data.me.isAdmin}
						<div>
							<dt>Groups</dt>
							<dd>
								{data.profile.groups.length > 0
									? data.profile.groups.join(", ")
									: "None"}
							</dd>
						</div>
					{/if}
					<div>
						<dt>Time zone</dt>
						<dd>{data.profile.timeZone ?? "Not set"}</dd>
					</div>
					{#if data.profile.isSelf}
						<div>
							<dt>Personal access tokens</dt>
							<dd>
								<a href="/secure/ViewProfile.jspa?selectedTab=tokens">
									Manage tokens
								</a>
							</dd>
						</div>
					{/if}
				</dl>
				{#if data.profile.isSelf && data.messenger}
					<MessengerSection info={data.messenger} />
				{/if}
			</div>

			<div class="content">
				{#if data.profile.isSelf}
					<nav class="tabs">
						<a
							href="/secure/ViewProfile.jspa"
							class="tab"
							class:active={detailsTab}
							aria-current={detailsTab ? "page" : undefined}
						>
							Profile
						</a>
						<a
							href="/secure/ViewProfile.jspa?selectedTab=notifications"
							class="tab"
							class:active={notificationsTab}
							aria-current={notificationsTab ? "page" : undefined}
						>
							Notifications
						</a>
						<a
							href="/secure/ViewProfile.jspa?selectedTab=tokens"
							class="tab"
							class:active={tokensTab}
							aria-current={tokensTab ? "page" : undefined}
						>
							Personal access tokens
						</a>
						{#if data.me.hasPassword}
							<a
								href="/secure/ViewProfile.jspa?selectedTab=password"
								class="tab"
								class:active={passwordTab}
								aria-current={passwordTab ? "page" : undefined}
							>
								Change password
							</a>
						{/if}
					</nav>
				{/if}

				{#if tokensTab}
					{#key data.create}
						<TokensSection
							tokens={data.tokens}
							create={data.create}
							hasPassword={data.me.hasPassword}
							{form}
						/>
					{/key}
				{:else if notificationsTab}
					{#if data.settings}
						<NotificationSettingsSection
							settings={data.settings}
							{form}
						/>
					{/if}
				{:else if passwordTab}
					<ChangePasswordForm {form} />
				{:else}
					<ProfileDetails
						profile={data.profile}
						notice={displayNotice}
						selfHasPassword={data.me.hasPassword}
					/>
				{/if}
			</div>
		</div>

		{#if uploadOpen}
			<AvatarUpload
				user={data.profile}
				onClose={() => (uploadOpen = false)}
				onUploaded={onUploaded}
			/>
		{/if}
	</section>
{/if}

<style>
	.profile {
		padding: 24px 32px;
		max-width: 1120px;
	}

	.error-banner {
		margin: 0 0 16px;
		color: var(--ds-text-danger);
	}

	.columns {
		display: grid;
		grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
		gap: 40px;
		align-items: start;
	}

	.avatar-button {
		display: block;
		padding: 0;
		background: transparent;
		border: 0;
		border-radius: 50%;
		cursor: pointer;
	}

	h1 {
		margin: 20px 0 4px;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text);
	}

	.username {
		color: var(--ds-text-subtle);
		font-size: 14px;
	}

	.details {
		display: grid;
		grid-template-columns: 1fr;
		row-gap: 14px;
		margin: 24px 0 0;
	}

	dt {
		color: var(--ds-text-subtle);
		font-size: 12px;
		margin-bottom: 3px;
	}

	dd {
		margin: 0;
		color: var(--ds-text);
		overflow-wrap: anywhere;
	}

	dd a {
		color: var(--ds-link);
	}

	.content {
		min-width: 0;
	}

	.tabs {
		display: flex;
		gap: 24px;
		border-bottom: 1px solid var(--ds-border);
		margin-bottom: 24px;
	}

	.tab {
		display: inline-block;
		padding: 8px 0;
		margin-bottom: -1px;
		border-bottom: 2px solid transparent;
		color: var(--ds-text-subtle);
		font-weight: 400;
		text-decoration: none;
	}

	.tab.active {
		border-bottom-color: var(--ds-border-selected);
		color: var(--ds-text);
		font-weight: 500;
	}
</style>
