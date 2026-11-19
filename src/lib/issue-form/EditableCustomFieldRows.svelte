<script lang="ts">
	import { api } from "#lib/api.ts";
	import type { IssueDetail, Me } from "#lib/api-types.ts";
	import EditableFieldRow from "./EditableFieldRow.svelte";

	interface Props {
		issue: IssueDetail;
		me: Me | null;
		onSaved: () => Promise<void>;
	}

	let { issue, me, onSaved }: Props = $props();

	let fields = $derived(issue.editableCustomFields ?? []);

	async function save(fieldId: string, value: unknown) {
		await api(`/api/issues/${encodeURIComponent(issue.key)}`, {
			method: "PATCH",
			body: JSON.stringify({ customFields: { [fieldId]: value } }),
		});
		await onSaved();
	}
</script>

{#each fields as field (field.id)}
	<EditableFieldRow {field} {me} onSave={save} />
{/each}
