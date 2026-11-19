<script lang="ts">
	import type { IssueTypeRef } from "#lib/api-types.ts";
	import IssueTypeIcon from "#lib/components/IssueTypeIcon.svelte";
	import { inlineIconStyle } from "./styles.ts";

	interface Props {
		type: IssueTypeRef;
	}

	let { type }: Props = $props();
</script>

<span style={inlineIconStyle}>
	<IssueTypeIcon id={type.id} name={type.name} icon={type.iconUrl} />
	{type.name}
</span>
