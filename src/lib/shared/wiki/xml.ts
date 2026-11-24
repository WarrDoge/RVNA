export type XText = { text: string; cdata?: boolean };
export type XElement = {
	tag: string;
	attrs: Record<string, string>;
	children: XNode[];
};
export type XNode = XText | XElement;

export function isElement(node: XNode): node is XElement {
	return "tag" in node;
}

const named: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	ndash: "–",
	mdash: "—",
	hellip: "…",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
	laquo: "«",
	raquo: "»",
	bull: "•",
	middot: "·",
	copy: "©",
	reg: "®",
	trade: "™",
	euro: "€",
	times: "×",
	rarr: "→",
	larr: "←",
	deg: "°",
	plusmn: "±",
	shy: "­",
	zwj: "‍",
};

export function decodeEntities(value: string): string {
	if (!value.includes("&")) return value;
	return value.replace(
		/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g,
		(match, body: string) => {
			if (body[0] === "#") {
				const code =
					body[1] === "x" || body[1] === "X"
						? Number.parseInt(body.slice(2), 16)
						: Number.parseInt(body.slice(1), 10);
				return code > 0 && code <= 0x10ffff
					? String.fromCodePoint(code)
					: match;
			}
			return named[body] ?? match;
		},
	);
}

const voidTags = new Set([
	"br",
	"hr",
	"img",
	"col",
	"input",
	"meta",
	"link",
	"area",
	"base",
	"wbr",
]);

const attrPattern =
	/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/y;

function parseAttributes(source: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	attrPattern.lastIndex = 0;
	let index = 0;
	while (index < source.length) {
		while (index < source.length && /[\s/]/.test(source[index] ?? "")) index++;
		if (index >= source.length) break;
		attrPattern.lastIndex = index;
		const match = attrPattern.exec(source);
		if (!match) break;
		const value = match[2] ?? match[3] ?? match[4] ?? "";
		attrs[match[1] ?? ""] = decodeEntities(value);
		index = attrPattern.lastIndex;
	}
	return attrs;
}

/** Elements nested deeper than this stay as siblings, so the tree is shallow enough for every recursive walk. */
const maxNesting = 50;

/** Tolerant parser for Confluence storage format (XHTML with ac:/ri: elements). Linear time. */
export function parseXml(source: string): XNode[] {
	const root: XElement = { tag: "#root", attrs: {}, children: [] };
	const stack: XElement[] = [root];
	const top = () => stack[stack.length - 1] as XElement;
	let index = 0;
	const length = source.length;

	const pushText = (text: string, cdata = false) => {
		if (text === "") return;
		const children = top().children;
		const last = children[children.length - 1];
		if (!cdata && last && !isElement(last) && !last.cdata) {
			last.text += text;
			return;
		}
		children.push(cdata ? { text, cdata: true } : { text });
	};

	while (index < length) {
		const open = source.indexOf("<", index);
		if (open === -1) {
			pushText(decodeEntities(source.slice(index)));
			break;
		}
		if (open > index) pushText(decodeEntities(source.slice(index, open)));

		if (source.startsWith("<![CDATA[", open)) {
			const end = source.indexOf("]]>", open + 9);
			const stop = end === -1 ? length : end;
			pushText(source.slice(open + 9, stop), true);
			index = end === -1 ? length : end + 3;
			continue;
		}
		if (source.startsWith("<!--", open)) {
			const end = source.indexOf("-->", open + 4);
			index = end === -1 ? length : end + 3;
			continue;
		}
		if (source[open + 1] === "!" || source[open + 1] === "?") {
			const end = source.indexOf(">", open + 2);
			index = end === -1 ? length : end + 1;
			continue;
		}
		if (source[open + 1] === "/") {
			const end = source.indexOf(">", open + 2);
			const stop = end === -1 ? length : end;
			const tag = source
				.slice(open + 2, stop)
				.trim()
				.toLowerCase();
			for (let depth = stack.length - 1; depth > 0; depth--) {
				if (stack[depth]?.tag === tag) {
					stack.length = depth;
					break;
				}
			}
			index = end === -1 ? length : end + 1;
			continue;
		}

		const tagMatch = /^<([a-zA-Z][^\s/>]*)/.exec(
			source.slice(open, open + 200),
		);
		if (!tagMatch) {
			pushText("<");
			index = open + 1;
			continue;
		}
		let end = open + tagMatch[0].length;
		let quote = "";
		while (end < length) {
			const char = source[end];
			if (quote) {
				if (char === quote) quote = "";
			} else if (char === '"' || char === "'") {
				quote = char;
			} else if (char === ">") {
				break;
			}
			end++;
		}
		const inner = source.slice(open + tagMatch[0].length, end);
		const selfClosing = inner.endsWith("/");
		const tag = (tagMatch[1] ?? "").toLowerCase();
		const element: XElement = {
			tag,
			attrs: parseAttributes(selfClosing ? inner.slice(0, -1) : inner),
			children: [],
		};
		top().children.push(element);
		if (!selfClosing && !voidTags.has(tag) && stack.length <= maxNesting) {
			stack.push(element);
		}
		index = end + 1;
	}
	return root.children;
}

export function textContent(node: XNode): string {
	if (!isElement(node)) return node.text;
	if (node.tag === "br") return "\n";
	return node.children.map(textContent).join("");
}

export function escapeText(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

export function escapeAttr(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}
