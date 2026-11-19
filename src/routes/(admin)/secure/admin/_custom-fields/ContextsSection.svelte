<script lang="ts">
	import { invalidate } from "$app/navigation";
	import { api } from "#lib/api.ts";
	import type {
		AdminFieldDetail,
		IssueTypeOption,
		ProjectOption,
	} from "#lib/admin/custom-fields.ts";
	import { errorMessage } from "#lib/admin/config.ts";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Banner from "#lib/admin/Banner.svelte";
	import Button from "#lib/components/Button.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import ConfigTable from "#lib/admin/ConfigTable.svelte";
	import EmptyRow from "#lib/admin/EmptyRow.svelte";
	import ErrorText from "#lib/admin/ErrorText.svelte";

	interface Props {
		field: AdminFieldDetail;
		projects: ProjectOption[];
		issueTypes: IssueTypeOption[];
	}

	let { field, projects, issueTypes }: Props = $props();

	type ContextRow = {
		id: string;
		projectId: string | null;
		issueTypeId: string | null;
		projectName: string;
		issueTypeName: string;
	};

	let projectId = $state("");
	let issueTypeId = $state("");
	let error = $state<string | null>(null);
	let pending = $state(false);
	let removing = $state<ContextRow | null>(null);
	let localRows = $state<ContextRow[] | null>(null);
	let requestSeq = 0;
	let replaceQueue: Promise<void> = Promise.resolve();

	let rows = $derived(
		localRows ??
			field.contexts.map((context) => ({
				id: context.id,
				projectId: context.project?.id ?? null,
				issueTypeId: context.issueType?.id ?? null,
				projectName: context.project?.name ?? "All projects",
				issueTypeName: context.issueType?.name ?? "All issue types",
			})),
	);

	function contextsOf(next: ContextRow[]) {
		return next.map((row) => ({
			projectId: row.projectId,
			issueTypeId: row.issueTypeId,
		}));
	}

	function replace(contexts: ReturnType<typeof contextsOf>, next: ContextRow[]) {
		const seq = ++requestSeq;
		localRows = next;
		pending = true;
		error = null;
		const run = replaceQueue.then(async () => {
			try {
				await api(
					`/api/admin/custom-fields/${encodeURIComponent(field.id)}/contexts`,
					{ method: "PUT", body: JSON.stringify({ contexts }) },
				);
				if (seq !== requestSeq) return;
				await Promise.all([
					invalidate("app:admin-field"),
					invalidate("app:admin-fields"),
				]);
				if (seq === requestSeq) localRows = null;
			} catch (cause) {
				if (seq !== requestSeq) return;
				localRows = null;
				error = errorMessage(cause);
				await Promise.all([
					invalidate("app:admin-field"),
					invalidate("app:admin-fields"),
				]);
			} finally {
				if (seq === requestSeq) pending = false;
			}
		});
		replaceQueue = run.catch(() => undefined);
		return run;
	}

	async function add() {
		if (pending) return;
		const candidate = {
			projectId: projectId === "" ? null : projectId,
			issueTypeId: issueTypeId === "" ? null : issueTypeId,
		};
		if (
			rows.some(
				(row) =>
					row.projectId === candidate.projectId &&
					row.issueTypeId === candidate.issueTypeId,
			)
		) {
			error = "That context is already listed.";
			return;
		}
		const added: ContextRow = {
			id: crypto.randomUUID(),
			...candidate,
			projectName:
				projects.find((project) => project.id === candidate.projectId)?.name ??
				"All projects",
			issueTypeName:
				issueTypes.find((issueType) => issueType.id === candidate.issueTypeId)
					?.name ?? "All issue types",
		};
		const next = [...rows, added];
		await replace(contextsOf(next), next);
		projectId = "";
		issueTypeId = "";
	}

	async function removeContext(row: ContextRow) {
		const next = rows.filter((item) => item.id !== row.id);
		await replace(contextsOf(next), next);
		removing = null;
	}
</script>

<section>
	<h2 class="section-title">Where this field is used</h2>
	<p class="section-hint">
		A field appears on an issue when one of these rows matches the issue's
		project and issue type. A field with no rows appears nowhere.
	</p>
	{#if rows.length === 0}
		<Banner tone="warning">
			This field is not shown on any issue. Add a context to use it.
		</Banner>
	{/if}
	<ConfigTable
		columns={[
			{ label: "Project" },
			{ label: "Issue type" },
			{ label: "Actions", width: 120 },
		]}
	>
		{#if rows.length === 0}
			<EmptyRow columns={3}>
				This field is not shown on any issue. Add a context to use it.
			</EmptyRow>
		{/if}
		{#each rows as row (row.id)}
			<tr>
				<td>{row.projectName}</td>
				<td>{row.issueTypeName}</td>
				<td>
					<button
						type="button"
						class="danger-link"
						onclick={() => (removing = row)}
					>
						Remove
					</button>
				</td>
			</tr>
		{/each}
	</ConfigTable>
	<div class="toolbar">
		<select
			aria-label="Project for the new context"
			bind:value={projectId}
			style="{inputStyle} width: 240px;"
		>
			<option value="">All projects</option>
			{#each projects as project (project.id)}
				<option value={project.id}>{project.name}</option>
			{/each}
		</select>
		<select
			aria-label="Issue type for the new context"
			bind:value={issueTypeId}
			style="{inputStyle} width: 220px;"
		>
			<option value="">All issue types</option>
			{#each issueTypes as issueType (issueType.id)}
				<option value={issueType.id}>{issueType.name}</option>
			{/each}
		</select>
		<Button onclick={() => void add()} isLoading={pending} isDisabled={pending}>
			Add context
		</Button>
		{#if error}
			<ErrorText>{error}</ErrorText>
		{/if}
	</div>
</section>

{#if removing}
	{@const target = removing}
	<ConfirmDialog
		title="Remove context"
		confirmLabel="Remove"
		message={`Remove the context ${target.projectName} / ${target.issueTypeName}? The field will no longer appear on issues it matched.`}
		pending={pending}
		onClose={() => (removing = null)}
		onConfirm={() => void removeContext(target)}
	/>
{/if}

<style>
	.section-title {
		margin: 0 0 4px;
		font-size: 16px;
		font-weight: 600;
		line-height: 22px;
		color: var(--ds-text);
	}

	.section-hint {
		margin: 0 0 12px;
		font-size: 12px;
		color: var(--ds-text-subtle);
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		margin: 12px 0 0;
	}

	.danger-link {
		padding: 0;
		background: transparent;
		border: 0;
		color: var(--ds-text-danger);
		cursor: pointer;
		font-size: 14px;
	}
</style>
