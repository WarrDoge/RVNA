import { escapeHtml } from "./storage.ts";

export type DiffOp = {
	type: "equal" | "insert" | "delete";
	text: string;
};

const blockTags =
	"p|h1|h2|h3|h4|h5|h6|li|tr|pre|blockquote|dt|dd|figcaption|summary|div|br";

function decode(value: string) {
	return value
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&");
}

/** Plain text of an HTML body, one entry per block element. */
export function htmlToBlocks(html: string | null | undefined): string[] {
	if (!html) return [];
	const withBreaks = html
		.replace(new RegExp(`</(?:${blockTags})>`, "gi"), "\n")
		.replace(new RegExp(`<(?:${blockTags})[^>]*>`, "gi"), "\n")
		.replace(/<[^>]*>/g, "");
	return decode(withBreaks)
		.split("\n")
		.map((line) => line.replace(/\s+/g, " ").trim())
		.filter((line) => line !== "");
}

function lcs(a: string[], b: string[]): DiffOp[] {
	if (a.length === 0)
		return b.map((text) => ({ type: "insert" as const, text }));
	if (b.length === 0)
		return a.map((text) => ({ type: "delete" as const, text }));
	if (a.length * b.length > 4_000_000) {
		return [
			...a.map((text) => ({ type: "delete" as const, text })),
			...b.map((text) => ({ type: "insert" as const, text })),
		];
	}

	const table = new Uint32Array((a.length + 1) * (b.length + 1));
	const width = b.length + 1;
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			table[i * width + j] =
				a[i] === b[j]
					? (table[(i + 1) * width + j + 1] as number) + 1
					: Math.max(
							table[(i + 1) * width + j] as number,
							table[i * width + j + 1] as number,
						);
		}
	}

	const ops: DiffOp[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			ops.push({ type: "equal", text: a[i] as string });
			i++;
			j++;
		} else if (
			(table[(i + 1) * width + j] as number) >=
			(table[i * width + j + 1] as number)
		) {
			ops.push({ type: "delete", text: a[i] as string });
			i++;
		} else {
			ops.push({ type: "insert", text: b[j] as string });
			j++;
		}
	}
	while (i < a.length) ops.push({ type: "delete", text: a[i++] as string });
	while (j < b.length) ops.push({ type: "insert", text: b[j++] as string });
	return ops;
}

export function diffBlocks(before: string[], after: string[]): DiffOp[] {
	return lcs(before, after);
}

function wordTokens(value: string): string[] {
	return value.split(/(\s+)/).filter((token) => token !== "");
}

/** Word-level diff of two blocks, so a changed paragraph stays readable. */
export function diffWords(before: string, after: string): DiffOp[] {
	return lcs(wordTokens(before), wordTokens(after));
}

function renderOps(ops: DiffOp[]): string {
	return ops
		.map((op) => {
			const text = escapeHtml(op.text);
			if (op.type === "delete") {
				return `<del class="wiki-diff-removed">${text}</del>`;
			}
			if (op.type === "insert") {
				return `<ins class="wiki-diff-added">${text}</ins>`;
			}
			return text;
		})
		.join("");
}

export type DiffBlock = {
	type: "equal" | "change";
	html: string;
};

/**
 * A readable HTML diff of two rendered bodies: unchanged blocks pass through,
 * changed blocks are paired up and diffed word by word.
 */
export function diffHtml(
	beforeHtml: string | null | undefined,
	afterHtml: string | null | undefined,
): DiffBlock[] {
	const ops = diffBlocks(htmlToBlocks(beforeHtml), htmlToBlocks(afterHtml));
	const blocks: DiffBlock[] = [];
	let index = 0;
	while (index < ops.length) {
		const op = ops[index] as DiffOp;
		if (op.type === "equal") {
			blocks.push({
				type: "equal",
				html: `<p class="wiki-diff-equal">${escapeHtml(op.text)}</p>`,
			});
			index++;
			continue;
		}

		const deleted: string[] = [];
		const inserted: string[] = [];
		while (index < ops.length && (ops[index] as DiffOp).type !== "equal") {
			const next = ops[index] as DiffOp;
			if (next.type === "delete") deleted.push(next.text);
			else inserted.push(next.text);
			index++;
		}

		const pairs = Math.max(deleted.length, inserted.length);
		for (let pair = 0; pair < pairs; pair++) {
			const removed = deleted[pair];
			const added = inserted[pair];
			if (removed !== undefined && added !== undefined) {
				blocks.push({
					type: "change",
					html: `<p class="wiki-diff-change">${renderOps(diffWords(removed, added))}</p>`,
				});
			} else if (removed !== undefined) {
				blocks.push({
					type: "change",
					html: `<p class="wiki-diff-change"><del class="wiki-diff-removed">${escapeHtml(removed)}</del></p>`,
				});
			} else if (added !== undefined) {
				blocks.push({
					type: "change",
					html: `<p class="wiki-diff-change"><ins class="wiki-diff-added">${escapeHtml(added)}</ins></p>`,
				});
			}
		}
	}
	return blocks;
}
