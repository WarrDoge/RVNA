<script lang="ts">
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	async function logout() {
		try {
			const result = await api<{ redirect: string }>("/auth/logout", {
				method: "POST",
			});
			window.location.assign(result.redirect);
		} catch {
			// The page stays; the user can retry.
		}
	}
</script>

<PageTitle title="Log out" />

<section class="logout">
	<h1>Log out</h1>
	<p>You are signed in as {data.username}.</p>
	<Button appearance="primary" onclick={() => void logout()}>Log out</Button>
</section>

<style>
	.logout {
		padding: 24px 32px;
		max-width: 480px;
	}

	h1 {
		margin: 0 0 16px;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text);
	}

	p {
		margin: 0 0 16px;
		color: var(--ds-text-subtle);
	}
</style>
