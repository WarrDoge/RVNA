<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { Editor } from "@tiptap/core";
	import RichTextEditor from "#lib/editor/RichTextEditor.svelte";
	import {
		sampleIssueHtml,
		sampleWikiDoc,
	} from "#lib/editor/gallery-content.ts";
	import type { PageData } from "./$types";
	import WikiEditorDemo from "./WikiEditorDemo.svelte";

	let { data }: { data: PageData } = $props();

	let issueHtml = $state(sampleIssueHtml);
	let issueJson = $state("");
	let wikiJson = $state(JSON.stringify(sampleWikiDoc));

	function issueReady(editor: Editor) {
		issueJson = JSON.stringify(editor.getJSON());
		editor.on("update", () => {
			issueJson = JSON.stringify(editor.getJSON());
		});
	}

	const pageStyle = `min-height: 100vh; padding: 24px 32px 64px; background: ${token(
		"elevation.surface",
	)}; color: ${token("color.text")};`;
	const gridStyle =
		"display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; max-width: 1200px; margin: 0 auto;";
	const headingStyle = "margin: 0 0 8px; font-size: 16px; font-weight: 600;";
	const sectionStyle = "min-width: 0;";
</script>

<svelte:head>
	<title>SK editor gallery - RVNA</title>
</svelte:head>

<main style={pageStyle}>
	<header style="max-width: 1200px; margin: 0 auto 24px;">
		<h1 style="margin: 0 0 4px; font-size: 24px; font-weight: 600;">
			SK editor gallery
		</h1>
		<p style="margin: 0; color: {token('color.text.subtle')};">
			Signed in as {data.user?.displayName}.
		</p>
	</header>

	<div style={gridStyle}>
		<section data-testid="issue-editor" style={sectionStyle}>
			<h2 style={headingStyle}>Issue editor</h2>
			<RichTextEditor
				value={issueHtml}
				onChange={(html) => (issueHtml = html)}
				onEditor={issueReady}
				placeholder="Describe the issue…"
			/>
			<pre data-testid="issue-html" hidden>{issueHtml}</pre>
			<pre data-testid="issue-json" hidden>{issueJson}</pre>
		</section>

		<section data-testid="readonly-editor" style={sectionStyle}>
			<h2 style={headingStyle}>Read-only</h2>
			<RichTextEditor value={sampleIssueHtml} onChange={() => {}} readOnly />
		</section>

		<section
			data-testid="wiki-editor"
			style="{sectionStyle} grid-column: 1 / -1;"
		>
			<h2 style={headingStyle}>Wiki editor</h2>
			<WikiEditorDemo
				doc={sampleWikiDoc}
				onChange={(doc) => (wikiJson = JSON.stringify(doc))}
			/>
			<pre data-testid="wiki-json" hidden>{wikiJson}</pre>
		</section>
	</div>
</main>
