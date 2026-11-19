<script lang="ts">
	import type { IssueDetail } from "#lib/api-types.ts";
	import { api } from "#lib/api.ts";
	import Icon from "#lib/components/Icon.svelte";
	import Module from "#lib/components/Module.svelte";
	import StatusLozenge from "#lib/issue-form/StatusLozenge.svelte";
	import { errorMessage } from "./panels-format.ts";

	interface Props {
		issue: IssueDetail;
		canLink: boolean;
		onAdd: () => void;
		onChanged: () => Promise<void>;
		onError: (message: string) => void;
	}

	let { issue, canLink, onAdd, onChanged, onError }: Props = $props();

	async function remove(id: string) {
		try {
			await api(`/api/issue-links/${id}`, { method: "DELETE" });
			await onChanged();
		} catch (cause) {
			onError(errorMessage(cause));
		}
	}
</script>

{#snippet actions()}
	<button type="button" class="link-button" onclick={onAdd}>Link</button>
{/snippet}

<Module title="Issue Links" actions={canLink ? actions : undefined}>
	{#if issue.links.length === 0}
		<p class="empty">No issue links.</p>
	{:else}
		<div class="links">
			{#each issue.links as group (group.type.id + group.direction)}
				{#each group.links as link (link.id)}
					<div class="row">
						<span class="icon">
							<Icon name="link" size={14} />
						</span>
						<span class="direction">
							{group.direction === "outward" ? group.type.outward : group.type.inward}
						</span>
						<a href={`/browse/${link.issue.key}`} class="link">
							{link.issue.key}
						</a>
						<span>{link.issue.summary}</span>
						<StatusLozenge status={link.issue.status} />
						{#if canLink}
							<button
								type="button"
								aria-label={`Delete link to ${link.issue.key}`}
								onclick={() => remove(link.id)}
								class="delete"
							>
								<Icon name="trash" size={12} />
							</button>
						{/if}
					</div>
				{/each}
			{/each}
		</div>
	{/if}
</Module>

<style>
	.empty {
		margin: 0;
		color: var(--ds-text-subtle, #596773);
	}

	.links {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.icon {
		display: inline-flex;
		color: var(--ds-icon-subtle, #596773);
	}

	.direction {
		color: var(--ds-text-subtle, #596773);
	}

	.link {
		color: var(--ds-link, #0c66e4);
		text-decoration: none;
	}

	.link-button {
		padding: 0;
		background: transparent;
		border: 0;
		color: var(--ds-link, #0c66e4);
		text-decoration: none;
		cursor: pointer;
		font-size: inherit;
	}

	.delete {
		margin-left: auto;
		display: inline-flex;
		padding: 2px;
		background: transparent;
		border: 0;
		color: var(--ds-text-subtle, #596773);
		cursor: pointer;
	}
</style>
