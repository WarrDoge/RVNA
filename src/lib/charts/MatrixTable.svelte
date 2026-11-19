<script lang="ts">
	import { token } from "#lib/tokens.ts";

	interface Props {
		matrix: {
			columns: string[];
			rows: { label: string; cells: number[]; total: number }[];
			totals: number[];
			total: number;
		};
	}

	let { matrix }: Props = $props();
</script>

{#if matrix.total === 0}
	<p class="muted">No issues.</p>
{:else}
	<div class="scroll">
		<table class="fat-table matrix">
			<thead>
				<tr>
					<th class="blank"></th>
					{#each matrix.columns as column (column)}
						<th class="right nowrap">{column}</th>
					{/each}
					<th class="right">Total</th>
				</tr>
			</thead>
			<tbody>
				{#each matrix.rows as row (row.label)}
					<tr>
						<td class="nowrap">{row.label}</td>
						{#each row.cells as value, index (`${row.label}-${matrix.columns[index]}`)}
							<td
								class="right"
								style="color: {value === 0
									? token('color.text.disabled')
									: token('color.text')};"
							>
								{value}
							</td>
						{/each}
						<td class="right bold">{row.total}</td>
					</tr>
				{/each}
				<tr>
					<td class="bold">Total</td>
					{#each matrix.totals as value, index (`total-${matrix.columns[index]}`)}
						<td class="right bold">{value}</td>
					{/each}
					<td class="right bold">{matrix.total}</td>
				</tr>
			</tbody>
		</table>
	</div>
{/if}

<style>
	.muted {
		margin: 0;
		color: var(--ds-text-subtle);
	}
	.scroll {
		overflow-x: auto;
	}
	.matrix {
		border-collapse: collapse;
		font-size: 12px;
	}
	th,
	td {
		padding: 4px 6px;
	}
	th {
		text-align: left;
	}
	.blank {
		padding: 4px 6px;
	}
	.right {
		text-align: right;
	}
	.nowrap {
		white-space: nowrap;
	}
	.bold {
		font-weight: 600;
	}
</style>
