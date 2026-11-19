import type { WikiDoc } from "#lib/shared/wiki/index.ts";

/** The content of the editor gallery. */
export const sampleIssueHtml = `<h2>Release notes</h2>
<p>This release fixes the <strong>board filters</strong> and adds a new <em>task list</em>.</p>
<ul><li><p>Faster search</p></li><li><p>Better tables</p></li></ul>
<table><tbody><tr><th><p>Area</p></th><th><p>Status</p></th></tr><tr><td><p>Board</p></td><td><p>Ready</p></td></tr></tbody></table>
<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Write release notes</p></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Publish build</p></div></li></ul>`;

export const sampleWikiDoc: WikiDoc = {
	type: "doc",
	content: [
		{
			type: "paragraph",
			content: [
				{ type: "text", text: "Read the " },
				{
					type: "inlineMacro",
					attrs: {
						name: "anchor",
						params: [{ name: "", value: "release-notes" }],
						bodyType: null,
					},
				},
				{ type: "text", text: " section before deploying." },
			],
		},
		{
			type: "heading",
			attrs: { level: 2 },
			content: [{ type: "text", text: "Release notes" }],
		},
		{
			type: "macro",
			attrs: {
				name: "info",
				params: [{ name: "title", value: "Deployment window" }],
				bodyType: "rich",
			},
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: "Deploy on Tuesday between 10:00 and 11:00.",
						},
					],
				},
			],
		},
		{
			type: "macro",
			attrs: {
				name: "note",
				params: [{ name: "title", value: "Heads up" }],
				bodyType: "rich",
			},
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "text",
							text: "The board may be slow while the index rebuilds.",
						},
					],
				},
			],
		},
		{
			type: "paragraph",
			content: [
				{ type: "text", text: "After the deploy, check the dashboard." },
			],
		},
	],
};
