<script lang="ts">
	interface Props {
		size?: number;
	}

	let { size = 22 }: Props = $props();
</script>

<!-- The rune raido, the first letter of the name; the same drawing as static/favicon.svg. -->
<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
	<rect x="1" y="1" width="22" height="22" rx="5" fill="#2A9D8F"></rect>
	<path
		d="M9 19V5l6.5 4L9 13l6.5 6"
		fill="none"
		stroke="#10201D"
		stroke-width="2.4"
		stroke-linecap="round"
		stroke-linejoin="round"
	></path>
</svg>
