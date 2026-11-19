<script lang="ts">
	import type { CustomFieldSpec, Me } from "#lib/api-types.ts";
	import { toStoredUser, toUserRef } from "./custom-field-values.ts";
	import CascadingEditor from "./editors/CascadingEditor.svelte";
	import DateEditor from "./editors/DateEditor.svelte";
	import LabelsEditor from "./editors/LabelsEditor.svelte";
	import MultiSelectEditor from "./editors/MultiSelectEditor.svelte";
	import MultiUserEditor from "./editors/MultiUserEditor.svelte";
	import NumberEditor from "./editors/NumberEditor.svelte";
	import SelectEditor from "./editors/SelectEditor.svelte";
	import TextEditor from "./editors/TextEditor.svelte";
	import UrlEditor from "./editors/UrlEditor.svelte";
	import UserSelect from "./UserSelect.svelte";

	interface Props {
		field: CustomFieldSpec;
		value: unknown;
		onChange: (value: unknown) => void;
		me: Me | null;
		autoFocus?: boolean;
	}

	let { field, value, onChange, me, autoFocus = false }: Props = $props();
</script>

{#if field.type === "text"}
	<TextEditor {field} {value} {onChange} {autoFocus} />
{:else if field.type === "paragraph"}
	<TextEditor {field} {value} {onChange} multiline {autoFocus} />
{:else if field.type === "number"}
	<NumberEditor {field} {value} {onChange} {autoFocus} />
{:else if field.type === "date"}
	<DateEditor {field} {value} {onChange} {autoFocus} />
{:else if field.type === "datetime"}
	<DateEditor {field} {value} {onChange} withTime {autoFocus} />
{:else if field.type === "select"}
	<SelectEditor {field} {value} {onChange} {autoFocus} />
{:else if field.type === "multiselect"}
	<MultiSelectEditor {field} {value} {onChange} />
{:else if field.type === "cascading"}
	<CascadingEditor {field} {value} {onChange} />
{:else if field.type === "user"}
	<UserSelect
		label={field.name}
		value={toUserRef(value)}
		onChange={(user) => onChange(user ? toStoredUser(user) : null)}
		{me}
	/>
{:else if field.type === "multiuser"}
	<MultiUserEditor {field} {value} {onChange} />
{:else if field.type === "labels"}
	<LabelsEditor {field} {value} {onChange} />
{:else if field.type === "url"}
	<UrlEditor {field} {value} {onChange} {autoFocus} />
{/if}
