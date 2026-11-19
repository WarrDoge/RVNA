<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { IssueDetail, Me, UserRef } from "#lib/api-types.ts";
	import { api } from "#lib/api.ts";
	import Module from "#lib/components/Module.svelte";
	import PersonLine from "./PersonLine.svelte";
	import WatchersPopover from "./WatchersPopover.svelte";

	interface Props {
		issue: IssueDetail;
		me: Me | null;
		onChanged: () => Promise<void>;
		onError: (message: string) => void;
	}

	let { issue, me, onChanged, onError }: Props = $props();

	let meRef = $derived<UserRef | null>(
		me
			? {
					id: me.id,
					username: me.username,
					displayName: me.displayName,
					avatarUrl: me.avatarUrl,
				}
			: null,
	);
	let permissions = $derived(issue.permissions);

	function errorMessage(error: unknown) {
		return error instanceof Error ? error.message : "Something went wrong";
	}

	async function assignTo(user: UserRef | null) {
		try {
			await api(`/api/issues/${issue.key}`, {
				method: "PATCH",
				body: JSON.stringify({ assignee: user?.id ?? null }),
			});
			await onChanged();
		} catch (error) {
			onError(errorMessage(error));
		}
	}

	const stackStyle = "display: flex; flex-direction: column; gap: 10px;";
	const linkButtonStyle = `padding: 0; background: transparent; border: 0; color: ${token(
		"color.link",
	)}; cursor: pointer; font-size: 12px; margin-top: 2px;`;
</script>

<Module title="People">
	<div style={stackStyle}>
		<PersonLine label="Assignee" user={issue.assignee} empty="Unassigned">
			{#snippet action()}
				{#if permissions.ASSIGN_ISSUES && meRef && issue.assignee?.id !== meRef.id}
					<button type="button" onclick={() => assignTo(meRef)} style={linkButtonStyle}>
						Assign to me
					</button>
				{/if}
			{/snippet}
		</PersonLine>
		<PersonLine label="Reporter" user={issue.reporter} empty="—" />
		<WatchersPopover
			{issue}
			{me}
			canManage={permissions.MANAGE_WATCHERS}
			canView={permissions.VIEW_VOTERS_AND_WATCHERS}
			{onChanged}
			{onError}
		/>
	</div>
</Module>
