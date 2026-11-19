<script lang="ts">
	import PageTitle from "#lib/components/PageTitle.svelte";
	import PortalHome from "../../../../PortalHome.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();
</script>

<PageTitle title={data.portal.name} />

<PortalHome portal={data.portal} groupId={data.groupId} />
