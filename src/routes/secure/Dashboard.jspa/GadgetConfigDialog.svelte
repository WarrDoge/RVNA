<script lang="ts">
	import { onMount } from "svelte";
	import { invalidate } from "$app/navigation";
	import { api } from "#lib/api.ts";
	import type { Filter, ProjectSummary } from "#lib/api-types.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import RichTextEditor from "#lib/editor/RichTextEditor.svelte";
	import { SYSTEM_FIELDS } from "#lib/shared/fields.ts";
	import { gadgetTitle, STATISTICS } from "#lib/shared/gadgets.ts";
	import { errorMessage } from "#lib/dashboards/gadget-helpers.ts";
	import type { Gadget } from "#lib/dashboards/types.ts";

	interface Props {
		gadget: Gadget;
		isAdmin: boolean;
		onClose: () => void;
	}

	let { gadget, isAdmin, onClose }: Props = $props();

	// svelte-ignore state_referenced_locally
	let config = $state<Record<string, unknown>>({ ...gadget.config });
	// svelte-ignore state_referenced_locally
	let title = $state(gadget.title ?? "");
	// svelte-ignore state_referenced_locally
	let refreshMinutes = $state(Math.round(gadget.refreshSeconds / 60));
	let error = $state<string | null>(null);
	let pending = $state(false);
	let filters = $state<Filter[]>([]);
	let projects = $state<ProjectSummary[]>([]);

	// svelte-ignore state_referenced_locally
	const introduction = gadget.type === "introduction";

	function list(value: unknown) {
		return Array.isArray(value)
			? value.filter((item): item is string => typeof item === "string")
			: [];
	}

	function number(value: unknown, fallback: number) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}

	function linksOf(value: Record<string, unknown>) {
		const links = Array.isArray(value.links) ? value.links : [];
		return links.map((link) => {
			const item = (link ?? {}) as { title?: unknown; url?: unknown };
			return {
				title: typeof item.title === "string" ? item.title : "",
				url: typeof item.url === "string" ? item.url : "",
			};
		});
	}

	function set(key: string, value: unknown) {
		config = { ...config, [key]: value };
	}

	function setLink(index: number, field: "title" | "url", value: string) {
		const links = linksOf(config);
		links[index] = { ...links[index], [field]: value };
		set("links", links);
	}

	onMount(() => {
		if (needsFilter(gadget.type)) {
			void api<Filter[]>("/api/filters?scope=visible")
				.then((value) => (filters = value))
				.catch(() => {});
		}
		if (needsProject(gadget.type)) {
			void api<ProjectSummary[]>("/api/projects")
				.then((value) => (projects = value))
				.catch(() => {});
		}
	});

	async function save() {
		pending = true;
		error = null;
		try {
			await api(`/api/gadgets/${gadget.id}`, {
				method: "PATCH",
				body: JSON.stringify({
					title: title.trim() === "" ? null : title.trim(),
					refreshSeconds: Math.max(0, Math.round(refreshMinutes * 60)),
					config,
				}),
			});
			await invalidate("app:dashboard");
			onClose();
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			pending = false;
		}
	}

	function needsFilter(type: string) {
		return [
			"filter-results",
			"pie-chart",
			"issue-statistics",
			"two-dimensional",
			"created-vs-resolved",
		].includes(type);
	}

	function needsProject(type: string) {
		return [
			"pie-chart",
			"issue-statistics",
			"two-dimensional",
			"created-vs-resolved",
		].includes(type);
	}

	function needsStatistic(type: string) {
		return type === "pie-chart" || type === "issue-statistics";
	}

	function needsColumns(type: string) {
		return ["filter-results", "assigned-to-me", "watched-issues"].includes(
			type,
		);
	}

	function needsRows(type: string) {
		return ["filter-results", "assigned-to-me", "watched-issues"].includes(
			type,
		);
	}
</script>

{#snippet footer()}
	<Button appearance="primary" isLoading={pending} onclick={() => void save()}
		>Save</Button
	>
	<Button appearance="subtle" onclick={onClose}>Cancel</Button>
{/snippet}

<Modal
	title={`Configure ${gadgetTitle(gadget.type)}`}
	{onClose}
	width={560}
	{footer}
>
	{#if error}
		<p role="alert" class="error">{error}</p>
	{/if}

	<label class="label">
		Gadget title
		<input
			aria-label="Gadget title"
			class="input"
			bind:value={title}
			autocomplete="off"
		/>
	</label>

	{#if introduction}
		<div class="section">
			<div class="section-title">Introduction text</div>
			{#if isAdmin}
				<RichTextEditor
					value={typeof config.html === "string" ? config.html : ""}
					onChange={(html) => set("html", html)}
					placeholder="Welcome to your dashboards"
					minHeight={120}
				/>
			{:else}
				<p class="note">Only an administrator can change the introduction text.</p>
			{/if}
		</div>
	{/if}

	{#if needsFilter(gadget.type)}
		<label class="label">
			Saved filter
			<select
				aria-label="Saved filter"
				class="input"
				value={typeof config.filterId === "string" ? config.filterId : ""}
				onchange={(event) =>
					set("filterId", event.currentTarget.value || null)}
			>
				<option value="">No filter</option>
				{#each filters as filter (filter.id)}
					<option value={filter.id}>{filter.name}</option>
				{/each}
			</select>
		</label>
	{/if}

	{#if needsProject(gadget.type)}
		<label class="label">
			Project, when no filter is chosen
			<select
				aria-label="Project"
				class="input"
				value={typeof config.project === "string" ? config.project : ""}
				onchange={(event) =>
					set("project", event.currentTarget.value || null)}
			>
				<option value="">All projects</option>
				{#each projects as project (project.key)}
					<option value={project.key}>{project.name}</option>
				{/each}
			</select>
		</label>
	{/if}

	{#if needsStatistic(gadget.type)}
		<label class="label">
			Statistic
			<select
				aria-label="Statistic"
				class="input"
				value={String(config.statistic ?? "status")}
				onchange={(event) => set("statistic", event.currentTarget.value)}
			>
				{#each STATISTICS as statistic (statistic.value)}
					<option value={statistic.value}>{statistic.label}</option>
				{/each}
			</select>
		</label>
	{/if}

	{#if gadget.type === "two-dimensional"}
		<div class="row">
			<label class="label grow">
				X axis
				<select
					aria-label="X axis"
					class="input"
					value={String(config.xStatistic ?? "status")}
					onchange={(event) =>
						set("xStatistic", event.currentTarget.value)}
				>
					{#each STATISTICS as statistic (statistic.value)}
						<option value={statistic.value}>{statistic.label}</option>
					{/each}
				</select>
			</label>
			<label class="label grow">
				Y axis
				<select
					aria-label="Y axis"
					class="input"
					value={String(config.yStatistic ?? "priority")}
					onchange={(event) =>
						set("yStatistic", event.currentTarget.value)}
				>
					{#each STATISTICS as statistic (statistic.value)}
						<option value={statistic.value}>{statistic.label}</option>
					{/each}
				</select>
			</label>
		</div>
	{/if}

	{#if needsColumns(gadget.type)}
		<div class="section">
			<div class="section-title">Columns</div>
			<div class="columns">
				{#each SYSTEM_FIELDS as field (field.id)}
					{@const selected = list(config.columns).includes(field.id)}
					<label class="checkbox">
						<input
							type="checkbox"
							checked={selected}
							onchange={(event) => {
								const columns = list(config.columns);
								set(
									"columns",
									event.currentTarget.checked
										? [...columns, field.id]
										: columns.filter((column) => column !== field.id),
								);
							}}
						/>
						{field.name}
					</label>
				{/each}
			</div>
		</div>
	{/if}

	{#if needsRows(gadget.type)}
		<label class="label">
			Rows
			<input
				aria-label="Rows"
				class="input"
				type="number"
				min={1}
				max={100}
				value={number(config.rows, 10)}
				oninput={(event) =>
					set("rows", Number(event.currentTarget.value))}
			/>
		</label>
	{/if}

	{#if gadget.type === "watched-issues"}
		<label class="checkbox spaced">
			<input
				type="checkbox"
				checked={config.showResolved !== false}
				onchange={(event) =>
					set("showResolved", event.currentTarget.checked)}
			/>
			Show resolved issues
		</label>
	{/if}

	{#if gadget.type === "activity-stream"}
		<label class="label">
			Projects (comma separated keys, empty for all)
			<input
				aria-label="Projects"
				class="input"
				value={list(config.projects).join(", ")}
				oninput={(event) =>
					set(
						"projects",
						event.currentTarget.value
							.split(",")
							.map((value) => value.trim())
							.filter(Boolean),
					)}
				autocomplete="off"
			/>
		</label>
		<label class="label">
			Users (comma separated usernames, empty for everyone)
			<input
				aria-label="Users"
				class="input"
				value={list(config.users).join(", ")}
				oninput={(event) =>
					set(
						"users",
						event.currentTarget.value
							.split(",")
							.map((value) => value.trim())
							.filter(Boolean),
					)}
				autocomplete="off"
			/>
		</label>
		<label class="label">
			Days
			<input
				aria-label="Days"
				class="input"
				type="number"
				min={1}
				max={90}
				value={number(config.days, 7)}
				oninput={(event) => set("days", Number(event.currentTarget.value))}
			/>
		</label>
	{/if}

	{#if gadget.type === "created-vs-resolved"}
		<label class="label">
			Days
			<input
				aria-label="Days"
				class="input"
				type="number"
				min={2}
				max={120}
				value={number(config.days, 30)}
				oninput={(event) => set("days", Number(event.currentTarget.value))}
			/>
		</label>
	{/if}

	{#if gadget.type === "quick-links"}
		<div class="section">
			<div class="section-title">Links</div>
			{#each linksOf(config) as link, index (index)}
				<div class="link-row">
					<input
						aria-label={`Link ${index + 1} title`}
						class="input grow"
						placeholder="Title"
						value={link.title}
						oninput={(event) =>
							setLink(index, "title", event.currentTarget.value)}
					/>
					<input
						aria-label={`Link ${index + 1} URL`}
						class="input grow"
						placeholder="https://"
						value={link.url}
						oninput={(event) =>
							setLink(index, "url", event.currentTarget.value)}
					/>
					<Button
						appearance="subtle"
						onclick={() =>
							set(
								"links",
								linksOf(config).filter(
									(_item, itemIndex) => itemIndex !== index,
								),
							)}
					>
						Remove
					</Button>
				</div>
			{/each}
			<Button
				appearance="subtle"
				onclick={() =>
					set("links", [...linksOf(config), { title: "", url: "" }])}
			>
				Add link
			</Button>
		</div>
	{/if}

	<label class="label">
		Auto refresh (minutes, 0 for never)
		<input
			aria-label="Auto refresh"
			class="input"
			type="number"
			min={0}
			max={1440}
			value={refreshMinutes}
			oninput={(event) =>
				(refreshMinutes = Number(event.currentTarget.value))}
		/>
	</label>
</Modal>

<style>
	.error {
		margin-top: 0;
		color: #e5493a;
	}
	.label {
		display: block;
		margin-top: 12px;
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle);
	}
	.input {
		display: block;
		width: 100%;
		min-height: 32px;
		padding: 4px 8px;
		margin-top: 4px;
		background: var(--ds-background-input);
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text);
		font-size: 14px;
	}
	.section {
		margin-top: 12px;
	}
	.section-title {
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle);
	}
	.note {
		margin: 0;
	}
	.row {
		display: flex;
		gap: 12px;
	}
	.grow {
		flex: 1;
	}
	.columns {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px;
		margin-top: 4px;
	}
	.checkbox {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
	}
	.checkbox.spaced {
		margin-top: 12px;
	}
	.link-row {
		display: flex;
		gap: 6px;
		margin-top: 4px;
	}
	.link-row .input {
		margin-top: 0;
	}
</style>
