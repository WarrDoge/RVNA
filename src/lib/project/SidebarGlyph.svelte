<script lang="ts">
	export type SidebarGlyphName =
		| "backlog"
		| "board"
		| "board-reports"
		| "reports"
		| "releases";

	interface Props {
		name: SidebarGlyphName;
	}

	let { name }: Props = $props();
</script>

{#if name === "backlog"}
	<svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
		<path
			d="M2 4h12M2 8h12M2 12h8"
			stroke="currentColor"
			stroke-width={1.4}
			stroke-linecap="round"
		/>
	</svg>
{:else if name === "board"}
	<svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
		<rect
			x={2}
			y={2}
			width={3}
			height={12}
			rx={0.5}
			fill="none"
			stroke="currentColor"
			stroke-width={1.3}
		/>
		<rect
			x={6.5}
			y={2}
			width={3}
			height={8}
			rx={0.5}
			fill="none"
			stroke="currentColor"
			stroke-width={1.3}
		/>
		<rect
			x={11}
			y={2}
			width={3}
			height={5}
			rx={0.5}
			fill="none"
			stroke="currentColor"
			stroke-width={1.3}
		/>
	</svg>
{:else if name === "board-reports"}
	<svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
		<path
			d="M3 13V7M8 13V3M13 13v-4"
			stroke="currentColor"
			stroke-width={1.6}
			stroke-linecap="round"
		/>
	</svg>
{:else if name === "reports"}
	<svg
		width={16}
		height={16}
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		stroke-width={1.4}
		aria-hidden="true"
	>
		<path d="M2 13.5h12M3.5 11V7M7 11V3.5M10.5 11V5.5M14 11V2" />
	</svg>
{:else if name === "releases"}
	<svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
		<path
			d="M8 2v8m0 0 3-3m-3 3L5 7M3 13h10"
			fill="none"
			stroke="currentColor"
			stroke-width={1.4}
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>
{/if}
