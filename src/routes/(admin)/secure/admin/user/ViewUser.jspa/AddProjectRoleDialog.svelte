<script lang="ts">
	import { invalidate } from "$app/navigation";
	import { onMount } from "svelte";
	import Banner from "#lib/admin/Banner.svelte";
	import FormField from "#lib/components/FormField.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import { errorMessage } from "#lib/admin/users.ts";
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";

	type ProjectRef = { id: string; key: string; name: string };
	type RoleRef = { id: string; name: string };

	let {
		userId,
		onClose,
	}: { userId: string; onClose: () => void } = $props();

	let projects = $state<ProjectRef[]>([]);
	let projectKey = $state("");
	let roleId = $state("");
	let roles = $state<RoleRef[]>([]);
	let rolesLoaded = $state(false);
	let rolesLoading = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);

	let rolesController: AbortController | null = null;

	onMount(() => {
		const controller = new AbortController();
		(async () => {
			try {
				projects = await api<ProjectRef[]>(
					"/api/admin/projects?query=&archived=all",
					{ signal: controller.signal },
				);
			} catch (cause) {
				if (!controller.signal.aborted) error = errorMessage(cause);
			}
		})();
		return () => {
			controller.abort();
			rolesController?.abort();
		};
	});

	async function chooseProject(key: string) {
		projectKey = key;
		roleId = "";
		roles = [];
		rolesLoaded = false;
		error = null;
		rolesController?.abort();
		rolesController = null;
		if (key === "") {
			rolesLoading = false;
			return;
		}
		const controller = new AbortController();
		rolesController = controller;
		rolesLoading = true;
		try {
			const result = await api<{ roles: RoleRef[] }>(
				`/api/projects/${encodeURIComponent(key)}/roles`,
				{ signal: controller.signal },
			);
			if (controller.signal.aborted || key !== projectKey) return;
			roles = result.roles;
			rolesLoaded = true;
		} catch (cause) {
			if (!controller.signal.aborted && key === projectKey) {
				error = errorMessage(cause);
			}
		} finally {
			if (!controller.signal.aborted && key === projectKey) {
				rolesLoading = false;
			}
		}
	}

	async function add() {
		if (busy || projectKey === "" || roleId === "") return;
		busy = true;
		error = null;
		try {
			await api(
				`/api/projects/${encodeURIComponent(projectKey)}/roles/${encodeURIComponent(roleId)}/actors`,
				{
					method: "POST",
					body: JSON.stringify({ actorType: "user", actorId: userId }),
				},
			);
			await invalidate("app:admin-user");
			onClose();
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			busy = false;
		}
	}
</script>

{#snippet footer()}
	<Button
		appearance="primary"
		isLoading={busy}
		isDisabled={busy || projectKey === "" || roleId === ""}
		onclick={add}>Add</Button
	>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal title="Add to project role" {onClose} width={480} {footer}>
	{#if error}
		<Banner tone="danger">{error}</Banner>
	{/if}
	<FormField label="Project" htmlFor="project-role-project">
		<select
			id="project-role-project"
			value={projectKey}
			onchange={(event) => chooseProject(event.currentTarget.value)}
			style="{inputStyle} appearance: auto;"
		>
			<option value="">Choose a project</option>
			{#each projects as project (project.id)}
				<option value={project.key}>{project.key} — {project.name}</option>
			{/each}
		</select>
	</FormField>
	<FormField label="Role" htmlFor="project-role-role">
		<select
			id="project-role-role"
			value={roleId}
			onchange={(event) => (roleId = event.currentTarget.value)}
			style="{inputStyle} appearance: auto;"
			disabled={!rolesLoaded}
		>
			<option value="">Choose a role</option>
			{#each roles as role (role.id)}
				<option value={role.id}>{role.name}</option>
			{/each}
		</select>
	</FormField>
	{#if rolesLoading}
		<p class="subtle">Loading roles…</p>
	{/if}
</Modal>

<style>
	.subtle {
		color: var(--ds-text-subtle);
	}
</style>
