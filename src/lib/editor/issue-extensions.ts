import { mergeAttributes, Node } from "@tiptap/core";

/** A block the importer kept as HTML and the editor cannot represent as nodes. */
export const UnknownBlock = Node.create({
	name: "unknownBlock",
	group: "block",
	atom: true,
	selectable: false,
	draggable: false,

	addAttributes() {
		return { html: { default: "" } };
	},

	parseHTML() {
		return [
			{
				tag: "div[class]",
				getAttrs: (element) => ({
					html: (element as HTMLElement).outerHTML,
				}),
			},
		];
	},

	renderHTML({ node }) {
		const template = document.createElement("template");
		template.innerHTML = String(node.attrs.html ?? "");
		const element = template.content.firstElementChild;
		return (
			(element as HTMLElement | null) ?? ["div", { class: "fat-unknown-block" }]
		);
	},
});

/** An inline `@user` mention; the label is text, the id is a data attribute. */
export const Mention = Node.create({
	name: "mention",
	group: "inline",
	inline: true,
	atom: true,
	selectable: false,

	addAttributes() {
		return {
			id: {
				default: null,
				parseHTML: (element) => element.getAttribute("data-user-id"),
				renderHTML: (attributes) => ({ "data-user-id": attributes.id }),
			},
			label: {
				default: "",
				parseHTML: (element) => (element.textContent ?? "").replace(/^@/, ""),
				renderHTML: () => ({}),
			},
		};
	},

	parseHTML() {
		return [{ tag: "a.user-hover" }];
	},

	renderHTML({ node, HTMLAttributes }) {
		return [
			"a",
			mergeAttributes(HTMLAttributes, { class: "user-hover" }),
			`@${node.attrs.label}`,
		];
	},

	renderText({ node }) {
		return `@${node.attrs.label}`;
	},
});
