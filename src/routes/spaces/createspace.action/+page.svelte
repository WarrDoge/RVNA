<script lang="ts">
	import PageTitle from "#lib/components/PageTitle.svelte";
	import SpaceCreateForm from "#lib/wiki/editor/SpaceCreateForm.svelte";
	import type { ActionData, PageData } from "./$types";

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<PageTitle title="Create space" />

<SpaceCreateForm isAdmin={data.isAdmin} {form} />
