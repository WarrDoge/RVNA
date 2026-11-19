<script lang="ts">
	import type { ProjectSummary } from "#lib/api-types.ts";
	import {
		BASIC_CRITERIA,
		BASIC_NONE,
		type BasicCriterionId,
		type BasicQuery,
	} from "#lib/shared/jql/index.ts";
	import ExtraCriterion from "./ExtraCriterion.svelte";
	import MoreMenu from "./MoreMenu.svelte";
	import Picker from "./Picker.svelte";
	import { suggestJqlValues } from "./suggest.ts";

	interface Props {
		query: BasicQuery;
		projects: ProjectSummary[];
		onChange: (query: BasicQuery) => void;
		onRun: (query: BasicQuery) => void;
	}

	let { query, projects, onChange, onRun }: Props = $props();

	function useSuggestions(field: string | undefined) {
		let values = $state<string[]>([]);
		$effect(() => {
			if (!field) {
				values = [];
				return;
			}
			let cancelled = false;
			suggestJqlValues(field, "", 50)
				.then((result) => {
					if (!cancelled) values = result.values;
				})
				.catch(() => {
					if (!cancelled) values = [];
				});
			return () => {
				cancelled = true;
			};
		});
		return () => values;
	}

	const types = useSuggestions("issuetype");
	const statuses = useSuggestions("status");
	const assignees = useSuggestions("assignee");

	function criteriaFrom(query: BasicQuery) {
		return BASIC_CRITERIA.filter((criterion) => {
			if (criterion.id === "created" || criterion.id === "updated") {
				return query[criterion.id] !== null;
			}
			return query[criterion.id].length > 0;
		}).map((criterion) => criterion.id);
	}

	// svelte-ignore state_referenced_locally
	let extra = $state<BasicCriterionId[]>(criteriaFrom(query));
	// svelte-ignore state_referenced_locally
	let lastQuery = query;

	// Reset the added criteria when a caller replaces the query prop (a saved
	// filter), but not for the patches this component emits.
	$effect(() => {
		if (query === lastQuery) return;
		extra = criteriaFrom(query);
		lastQuery = query;
	});

	let extraCriteria = $derived(
		BASIC_CRITERIA.filter((criterion) => extra.includes(criterion.id)),
	);

	function patch(next: Partial<BasicQuery>, run = true) {
		const merged = { ...query, ...next };
		lastQuery = merged;
		onChange(merged);
		if (run) onRun(merged);
	}

	function addCriterion(id: BasicCriterionId) {
		extra = extra.includes(id) ? extra : [...extra, id];
		if (id === "created" || id === "updated") {
			patch({ [id]: { from: "", to: "" } }, false);
		}
	}

	function removeCriterion(id: BasicCriterionId) {
		extra = extra.filter((item) => item !== id);
		if (id === "created" || id === "updated") {
			patch({ [id]: null });
		} else {
			patch({ [id]: [] });
		}
	}
</script>

<div class="basic-mode">
	<div class="criteria">
		<Picker
			label="Project"
			value={query.project}
			options={projects.map((project) => project.key)}
			onChange={(value) => patch({ project: value })}
			none="All projects"
		/>
		<Picker
			label="Type"
			value={query.type}
			options={types()}
			onChange={(value) => patch({ type: value })}
			none="All types"
		/>
		<Picker
			label="Status"
			value={query.status}
			options={statuses()}
			onChange={(value) => patch({ status: value })}
			none="All statuses"
		/>
		<Picker
			label="Assignee"
			value={query.assignee}
			options={assignees()}
			onChange={(value) => patch({ assignee: value })}
			none="Anyone"
			extra={[
				{ label: "Current user", value: "currentUser()" },
				{ label: "Unassigned", value: BASIC_NONE },
			]}
		/>
		<label class="field">
			<span class="label">Contains text</span>
			<input
				aria-label="Contains text"
				value={query.text}
				oninput={(event) =>
					patch({ text: event.currentTarget.value }, false)}
				onkeydown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						onRun(query);
					}
				}}
				placeholder="Search the text of issues"
				class="control text-input"
			/>
		</label>
		<MoreMenu
			active={extraCriteria.map((criterion) => criterion.id)}
			onAdd={addCriterion}
		/>
	</div>

	{#if extraCriteria.length > 0}
		<div class="criteria">
			{#each extraCriteria as criterion (criterion.id)}
				<ExtraCriterion
					id={criterion.id}
					name={criterion.name}
					suggestField={criterion.suggestField}
					{query}
					{patch}
					onRemove={() => removeCriterion(criterion.id)}
				/>
			{/each}
		</div>
	{/if}
</div>

<style>
	.basic-mode {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.criteria {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		flex-wrap: wrap;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.label {
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 12px;
		line-height: 16px;
	}

	.control {
		height: 32px;
		padding: 0 8px;
		background: var(--ds-background-input, #ffffff);
		border: 1px solid var(--ds-border-input, #8c8f97);
		border-radius: 3px;
		color: var(--ds-text, #292a2e);
		font-size: 14px;
		max-width: 200px;
	}

	.text-input {
		width: 240px;
	}
</style>
