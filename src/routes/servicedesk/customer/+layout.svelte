<script lang="ts">
	import { page } from "$app/state";
	import { api } from "#lib/api.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import { dismiss } from "#lib/components/dismiss.ts";
		import type { Snippet } from "svelte";
	import type { LayoutData } from "./$types";

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	let open = $state(false);

	async function logout() {
		open = false;
		const result = await api<{ redirect: string }>("/auth/logout", {
			method: "POST",
		});
		// A new session needs fresh layout data, so load the page again.
		window.location.assign(result.redirect);
	}
</script>

<div class="portal">
	<header class="bar">
		<a class="bar-link" href="/servicedesk/customer/portals">Help Center</a>
		<div class="right">
			<a class="pill" href="/servicedesk/customer/user/requests">
				Requests
				<span class="count">{data.openRequests}</span>
			</a>
			{#if data.user}
				<div
					class="menu-root"
					{@attach dismiss(() => open, () => (open = false))}
				>
					<button
						type="button"
						aria-label="Profile menu"
						aria-haspopup="menu"
						aria-expanded={open}
						class="avatar-button"
						onclick={() => (open = !open)}
					>
						<Avatar user={data.user} size={28} />
					</button>
					{#if open}
						<div role="menu" aria-label="Profile" class="menu">
							<div role="presentation" class="menu-name">
								{data.user.displayName}
							</div>
							<a
								class="fat-menu-item"
								role="menuitem"
								href="/secure/Dashboard.jspa"
								onclick={() => (open = false)}
							>
								RVNA
							</a>
							<a
								class="fat-menu-item"
								role="menuitem"
								href="/servicedesk/customer/user/requests"
								onclick={() => (open = false)}
							>
								My requests
							</a>
							<button
								class="fat-menu-item"
								role="menuitem"
								type="button"
								onclick={() => void logout()}
							>
								Log out
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</header>
	<main class="main">
		<div class="content">
			{@render children()}
		</div>
	</main>
</div>

<style>
	.portal {
		min-height: 100vh;
		background-image: linear-gradient(
			var(--ds-background-brand-subtlest-pressed) 0 280px,
			var(--ds-surface) 280px
		);
		color: var(--ds-text);
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 48px;
		padding: 0 24px;
	}

	.bar-link {
		color: var(--ds-text);
		text-decoration: none;
		font-size: 14px;
		font-weight: 600;
	}

	.right {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		padding: 0 12px;
		background-color: var(--ds-background-neutral);
		border: 1px solid var(--ds-border);
		border-radius: 14px;
		color: var(--ds-text);
		text-decoration: none;
		font-size: 13px;
	}

	.count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 9px;
		background-color: var(--ds-background-neutral-bold);
		color: var(--ds-text-inverse);
		font-size: 11px;
		font-weight: 600;
	}

	.menu-root {
		position: relative;
	}

	.avatar-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		padding: 0;
		background: transparent;
		border: 0;
		border-radius: 50%;
		cursor: pointer;
	}

	.menu {
		position: absolute;
		top: 36px;
		right: 0;
		z-index: 100;
		min-width: 220px;
		padding-block: 4px;
		background-color: var(--ds-surface-overlay);
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		box-shadow: var(--ds-shadow-overlay);
	}

	.menu-name {
		padding: 6px 12px;
		font-weight: 600;
		color: var(--ds-text);
	}

	.main {
		padding: 40px 24px 64px;
	}

	.content {
		max-width: 880px;
		margin: 0 auto;
	}
</style>
