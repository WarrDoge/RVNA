<script lang="ts">
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";
	import AuthCard from "./AuthCard.svelte";
	import ChangePasswordForm from "./ChangePasswordForm.svelte";

	interface Props {
		form?: {
			error?: string;
			intent?: string;
			changed?: boolean;
		} | null;
	}

	let { form }: Props = $props();

	async function logout() {
		try {
			const result = await api<{ redirect: string }>("/auth/logout", {
				method: "POST",
			});
			window.location.assign(result.redirect);
		} catch {
			// The card stays; the user can retry.
		}
	}
</script>

<AuthCard title="Change your password">
	<p class="intro">An administrator requires you to choose a new password.</p>
	<ChangePasswordForm width={320} {form} />
	<div class="logout">
		<Button appearance="subtle" onclick={() => void logout()}>Log out</Button>
	</div>
</AuthCard>

<style>
	.intro {
		margin: 0 0 24px;
		color: var(--ds-text-subtle);
	}

	.logout {
		margin-top: 24px;
		text-align: center;
	}
</style>
