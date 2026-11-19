<script lang="ts">
	import { onMount } from "svelte";
	import { api } from "#lib/api.ts";
	import type { CustomFieldColumn, ProjectSummary } from "#lib/api-types.ts";
	import Button from "#lib/components/Button.svelte";
	import BasicMode from "#lib/jql/BasicMode.svelte";
	import { jqlErrorText } from "#lib/jql/context.ts";
	import JqlInput from "#lib/jql/JqlInput.svelte";
	import {
		basicToJql,
		emptyBasicQuery,
		jqlToBasic,
		parseJql,
		type BasicQuery,
		type JqlOrderBy,
	} from "#lib/shared/jql/index.ts";

	const initialJql = "ORDER BY key DESC";
	const customFields: CustomFieldColumn[] = [];

	let jql = $state(initialJql);
	let mode = $state<"advanced" | "basic">("advanced");
	let basic = $state<BasicQuery>(emptyBasicQuery());
	let orderBy = $state<JqlOrderBy[]>(parseJql(initialJql).orderBy);
	let projects = $state<ProjectSummary[]>([]);
	let runError = $state<string | null>(null);
	let submitCount = $state(0);

	let basicAvailable = $derived.by(() => {
		try {
			return jqlToBasic(parseJql(jql)).ok;
		} catch {
			return false;
		}
	});

	onMount(() => {
		let cancelled = false;
		api<ProjectSummary[]>("/api/projects")
			.then((result) => {
				if (!cancelled) projects = result;
			})
			.catch(() => {
				if (!cancelled) projects = [];
			});
		return () => {
			cancelled = true;
		};
	});

	function submit() {
		const error = jqlErrorText(jql);
		if (error) {
			runError = error;
			return;
		}
		runError = null;
		submitCount += 1;
	}

	function switchToBasic() {
		try {
			const representation = jqlToBasic(parseJql(jql));
			if (!representation.ok) return;
			basic = representation.query;
			orderBy = representation.orderBy;
			mode = "basic";
		} catch {
			// The Basic button is disabled while the query cannot be shown.
		}
	}

	function changeBasic(next: BasicQuery) {
		basic = next;
		jql = basicToJql(next, orderBy);
	}

	function runBasic(next: BasicQuery) {
		changeBasic(next);
		submitCount += 1;
	}
</script>

<svelte:head>
	<title>JQL gallery - RVNA</title>
</svelte:head>

<main class="gallery" data-testid="jql-gallery">
	<h1>JQL input gallery</h1>
	<p class="intro">
		The Svelte JQL input and basic search mode, bound to local state.
	</p>

	<section class="panel">
		<div class="modes">
			<Button
				appearance={mode === "basic" ? "primary" : "default"}
				isDisabled={!basicAvailable && mode !== "basic"}
				onclick={switchToBasic}
			>
				Basic
			</Button>
			<Button
				appearance={mode === "advanced" ? "primary" : "default"}
				onclick={() => (mode = "advanced")}
			>
				Advanced
			</Button>
		</div>

		<div class="search-row">
			{#if mode === "advanced"}
				<JqlInput
					value={jql}
					onChange={(value) => (jql = value)}
					onSubmit={submit}
					{customFields}
					rejected={runError !== null}
				/>
			{:else}
				<div class="basic-wrap">
					<BasicMode
						query={basic}
						{projects}
						onChange={changeBasic}
						onRun={runBasic}
					/>
				</div>
			{/if}
			<Button appearance="primary" onclick={submit}>Search</Button>
		</div>

		{#if runError}
			<p class="error" role="alert" data-testid="jql-error">{runError}</p>
		{/if}

		<div class="current">
			<span class="current-label">Current JQL</span>
			<pre data-testid="current-jql">{jql}</pre>
			<span class="submit-count" data-testid="submit-count">
				Submits: {submitCount}
			</span>
		</div>
	</section>
</main>

<style>
	.gallery {
		min-height: 100vh;
		padding: 24px 32px 64px;
		background: var(--ds-surface, #1d2125);
		color: var(--ds-text, #cecfd2);
	}

	h1 {
		margin: 0 0 8px;
		font-size: 24px;
		font-weight: 600;
		line-height: 32px;
	}

	.intro {
		margin: 0 0 24px;
		color: var(--ds-text-subtle, #a9abaf);
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 1100px;
		padding: 20px;
		background: var(--ds-surface-raised, #22272b);
		border: 1px solid var(--ds-border, #3b3d42);
		border-radius: 6px;
	}

	.modes {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.search-row {
		display: flex;
		align-items: flex-end;
		gap: 8px;
	}

	.basic-wrap {
		flex: 1;
		min-width: 0;
	}

	.error {
		margin: 0;
		color: #e5493a;
		font-size: 13px;
	}

	.current {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding-top: 12px;
		border-top: 1px solid var(--ds-border, #3b3d42);
	}

	.current-label {
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 12px;
		line-height: 16px;
	}

	pre {
		margin: 0;
		padding: 8px 10px;
		overflow-x: auto;
		background: var(--ds-background-neutral, #22272b);
		border: 1px solid var(--ds-border, #3b3d42);
		border-radius: 3px;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 13px;
		white-space: pre-wrap;
	}

	.submit-count {
		color: var(--ds-text-subtle, #a9abaf);
		font-size: 12px;
	}
</style>
