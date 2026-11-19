<script lang="ts">
	import { invalidate } from "$app/navigation";
	import { api } from "#lib/api.ts";
	import Button from "#lib/components/Button.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import CreateBoardDialog from "./CreateBoardDialog.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let createOpen = $state(false);
	let deleting = $state<{ rapidViewId: number; name: string } | null>(null);
	let deletingPending = $state(false);
	let error = $state<string | null>(null);

	function message(cause: unknown) {
		return cause instanceof Error ? cause.message : "Something went wrong";
	}

	async function remove() {
		if (!deleting || deletingPending) return;
		deletingPending = true;
		try {
			await api(`/api/boards/${deleting.rapidViewId}`, { method: "DELETE" });
			deleting = null;
			await invalidate("app:boards");
		} catch (cause) {
			deleting = null;
			error = message(cause);
		} finally {
			deletingPending = false;
		}
	}
</script>

<PageTitle title="Boards" />

<section class="boards">
	<div class="header">
		<h1>Boards</h1>
		<div class="create">
			<Button appearance="primary" onclick={() => (createOpen = true)}>
				Create board
			</Button>
		</div>
	</div>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	<table class="fat-table">
		<thead>
			<tr>
				<th>Name</th>
				<th>Project</th>
				<th>Type</th>
				<th>Owner</th>
				<th>Configuration</th>
				<th class="actions-column"></th>
			</tr>
		</thead>
		<tbody>
			{#each data.boards as board (board.id)}
				<tr>
					<td>
						<a href={`/secure/RapidBoard.jspa?rapidView=${board.rapidViewId}`}>
							{board.name}
						</a>
					</td>
					<td>{board.project?.name ?? "—"}</td>
					<td>{board.type === "scrum" ? "Scrum" : "Kanban"}</td>
					<td>{board.owner?.displayName ?? "—"}</td>
					<td>
						{#if board.configImported}
							<Lozenge appearance="moved">Configured</Lozenge>
						{:else}
							<Lozenge appearance="default">Derived</Lozenge>
						{/if}
					</td>
					<td class="actions"><a class="open" href={`/secure/RapidBoard.jspa?rapidView=${board.rapidViewId}`}>Open</a>{#if board.canAdminister}<a class="configure" href={`/secure/RapidView.jspa?rapidView=${board.rapidViewId}&tab=general`}>Configure</a><Button spacing="compact" appearance="danger" onclick={() => (deleting = { rapidViewId: board.rapidViewId, name: board.name })}>Delete</Button>{/if}</td>
				</tr>
			{:else}
				<tr>
					<td colspan="6" class="empty">No boards yet.</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

{#if createOpen}
	<CreateBoardDialog
		projects={data.projects}
		defaultProject={data.defaultProject}
		onClose={() => (createOpen = false)}
	/>
{/if}
{#if deleting}
	<ConfirmDialog
		title="Delete board"
		message={`Delete "${deleting.name}"? Its sprints and configuration are removed.`}
		onClose={() => (deleting = null)}
		onConfirm={remove}
		pending={deletingPending}
	/>
{/if}

<style>
	.boards {
		padding: 24px 32px;
	}

	.header {
		display: flex;
		align-items: center;
		margin-bottom: 16px;
	}

	h1 {
		margin: 0;
		font-size: 24px;
		font-weight: 500;
		line-height: 28px;
		color: var(--ds-text, #cecfd2);
	}

	.create {
		margin-left: auto;
	}

	.error {
		margin: 0 0 16px;
		color: #e5493a;
	}

	table {
		width: 100%;
	}

	.actions-column {
		width: 220px;
	}

	.actions {
		text-align: right;
	}

	.actions a {
		margin-right: 10px;
	}

	.empty {
		color: var(--ds-text-subtle, #a9abaf);
	}
</style>
