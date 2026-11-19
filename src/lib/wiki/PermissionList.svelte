<script lang="ts">
	interface Props {
		title: string;
		rows: { label: string; detail: string }[];
		empty: string;
	}

	let { title, rows, empty }: Props = $props();
</script>

<div class="permissions">
	<h3>{title}</h3>
	{#if rows.length === 0}
		<p class="empty">{empty}</p>
	{:else}
		<ul>
			{#each rows as row (`${row.label}-${row.detail}`)}
				<li>
					{row.label}{#if row.detail}<span class="detail">{" "}— {row.detail}</span>{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.permissions {
		margin-bottom: 16px;
	}

	h3 {
		margin: 0 0 6px;
		font-size: 14px;
		font-weight: 600;
	}

	ul {
		margin: 0;
		padding-left: 18px;
	}

	li {
		margin-bottom: 2px;
	}

	.empty {
		margin: 0;
		color: var(--ds-text-subtle);
	}

	.detail {
		color: var(--ds-text-subtle);
	}
</style>
