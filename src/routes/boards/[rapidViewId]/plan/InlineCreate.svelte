<script lang="ts">
	interface Props {
		onClick: () => void;
	}

	let { onClick }: Props = $props();
</script>

<button type="button" class="inline-create" onclick={onClick}>+ Create issue</button>

<style>
	.inline-create {
		display: block;
		width: 100%;
		padding: 6px 8px;
		background: transparent;
		border: 0;
		color: var(--ds-link);
		font-size: 13px;
		text-align: left;
		cursor: pointer;
	}
</style>
