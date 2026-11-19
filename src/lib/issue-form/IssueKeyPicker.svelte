<script lang="ts">
	import { api } from "#lib/api.ts";
	import { dismiss } from "#lib/components/dismiss.ts";
	import Icon from "#lib/components/Icon.svelte";
	import { inputStyle, linkButtonStyle, popupStyle } from "./styles.ts";

	type SearchResponse = {
		issues: { key: string; summary: string }[];
	};

	interface Props {
		label: string;
		projectKey: string;
		jql: string;
		value: string;
		excludeKey?: string;
		onChange: (key: string) => void;
	}

	let { label, projectKey, jql, value, excludeKey, onChange }: Props = $props();

	let query = $state("");
	let results = $state<SearchResponse["issues"]>([]);
	let open = $state(false);
	let pending = $state(false);
	let failed = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;
	let version = 0;

	function escaped(value: string) {
		return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	}

	async function search(text: string) {
		controller?.abort();
		const active = new AbortController();
		controller = active;
		const current = ++version;
		pending = true;
		failed = false;
		const conditions = [`project = "${escaped(projectKey)}"`, jql];
		if (text.trim() !== "") {
			conditions.push(`text ~ "${escaped(text.trim())}"`);
		}
		try {
			const result = await api<SearchResponse>(
				`/api/search?jql=${encodeURIComponent(`${conditions.join(" AND ")} ORDER BY key ASC`)}&maxResults=20`,
				{ signal: active.signal },
			);
			if (current !== version) return;
			results = result.issues.filter((issue) => issue.key !== excludeKey);
			pending = false;
		} catch {
			if (current !== version || active.signal.aborted) return;
			results = [];
			pending = false;
			failed = true;
		}
	}

	function type(text: string) {
		query = text;
		open = true;
		clearTimeout(timer);
		timer = setTimeout(() => void search(query), 200);
	}

	function start() {
		open = true;
		clearTimeout(timer);
		void search(query);
	}

	function choose(key: string) {
		onChange(key);
		open = false;
		query = "";
		controller?.abort();
	}

	function clear() {
		onChange("");
		open = false;
		query = "";
		controller?.abort();
	}

	function cancel() {
		clearTimeout(timer);
		controller?.abort();
	}

	$effect(() => () => cancel());

	const listStyle = `${popupStyle} z-index: 50;`;
	const itemStyle =
		"display: flex; gap: 8px; width: 100%; padding: 6px 8px; background: transparent; border: 0; border-radius: 3px; color: inherit; text-align: left; cursor: pointer;";
	const keyStyle = "font-weight: 600; flex: none;";
	const summaryStyle =
		"overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
	const mutedStyle = "padding: 6px; color: var(--ds-text-subtle);";
</script>

<div
	class="picker"
	{@attach dismiss(() => open, () => (open = false))}
	style="position: relative;"
>
	{#if value}
		<div class="value">
			<span class="key">{value}</span>
			<button
				type="button"
				style={linkButtonStyle}
				onclick={start}>Change</button
			>
			<button
				type="button"
				aria-label={`Clear ${label}`}
				style={`${linkButtonStyle} margin-left: 4px;`}
				onclick={clear}
			>
				<Icon name="close" size={12} />
			</button>
		</div>
	{:else}
		<input
			aria-label={label}
			placeholder={`Search ${label.toLowerCase()}`}
			value={query}
			onfocus={start}
			oninput={(event) => type(event.currentTarget.value)}
			style={inputStyle}
		/>
	{/if}
	{#if open}
		<div role="listbox" aria-label={`${label} results`} style={listStyle}>
			{#if pending}
				<div style={mutedStyle}>Searching…</div>
			{:else if failed}
				<div role="alert" style={mutedStyle}>Could not search issues.</div>
			{:else if results.length === 0}
				<div style={mutedStyle}>No issues found.</div>
			{:else}
				{#each results as issue (issue.key)}
					<button
						type="button"
						role="option"
						aria-selected={false}
						style={itemStyle}
						onclick={() => choose(issue.key)}
					>
						<span style={keyStyle}>{issue.key}</span>
						<span style={summaryStyle}>{issue.summary}</span>
					</button>
				{/each}
			{/if}
		</div>
	{/if}
</div>
