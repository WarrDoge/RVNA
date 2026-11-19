<script lang="ts">
	import { invalidate } from "$app/navigation";
	import { api } from "#lib/api.ts";

	interface Props {
		projectKey: string;
		openAccess: boolean;
	}

	let { projectKey, openAccess }: Props = $props();

	let override = $state<boolean | null>(null);
	let checked = $derived(override ?? openAccess);
	let pending = $state(false);
	let error = $state<string | null>(null);

	async function toggle(next: boolean) {
		override = next;
		pending = true;
		error = null;
		try {
			await api(`/api/servicedesk/projects/${encodeURIComponent(projectKey)}/settings`, {
				method: "PATCH",
				body: JSON.stringify({ openAccess: next }),
			});
			await invalidate("app:project");
			override = null;
		} catch (cause) {
			override = null;
			error = cause instanceof Error ? cause.message : "Something went wrong";
		} finally {
			pending = false;
			override = null;
		}
	}
</script>

<section class="section">
	<h2>Customer access</h2>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	<label class="access">
		<input
			type="checkbox"
			bind:checked={() => checked, (value) => void toggle(value)}
			disabled={pending}
		/>
		<span>
			Anyone with an account can raise requests in this service desk and follow
			their own. Without it, only people the project permissions allow to create
			issues, or its customers, can.
		</span>
	</label>
</section>

<style>
	.section {
		margin-bottom: 32px;
	}

	h2 {
		margin: 0 0 12px;
		font-size: 20px;
		font-weight: 500;
	}

	.error {
		margin: 0 0 12px;
		color: #e5493a;
	}

	.access {
		display: flex;
		gap: 8px;
		align-items: flex-start;
	}
</style>
