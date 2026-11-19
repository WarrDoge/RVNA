<script lang="ts">
	import { page } from "$app/state";
	import PageTitle from "#lib/components/PageTitle.svelte";
	import IssueUnavailable from "#lib/issue/IssueUnavailable.svelte";

	let kind = $derived<"hidden-or-missing" | "failed">(
		page.status === 404 ? "hidden-or-missing" : "failed",
	);
</script>

<PageTitle
	title={page.status === 404
		? "You do not have permission to view this issue"
		: "Issue not found"}
/>

<IssueUnavailable {kind} />
