import type { JqlPosition } from "./ast.ts";
import { JqlError } from "./errors.ts";

export type JqlTokenType =
	| "word"
	| "string"
	| "number"
	| "operator"
	| "lparen"
	| "rparen"
	| "comma"
	| "lbracket"
	| "rbracket"
	| "eof";

export interface JqlToken {
	type: JqlTokenType;
	/** Decoded value for strings, the source text otherwise. */
	value: string;
	/** Source text as written, including quotes for strings. */
	text: string;
	position: JqlPosition;
}

const SYMBOLS: Record<string, JqlTokenType> = {
	"(": "lparen",
	")": "rparen",
	",": "comma",
	"[": "lbracket",
	"]": "rbracket",
};

const OPERATORS = new Set(["=", "!=", "~", "!~", ">", ">=", "<", "<=", "!"]);

function isWordBreak(character: string) {
	return (
		character === " " ||
		character === "\t" ||
		character === "\r" ||
		character === "\n" ||
		character === '"' ||
		SYMBOLS[character] !== undefined ||
		OPERATORS.has(character) ||
		character === "=" ||
		character === "~" ||
		character === ">" ||
		character === "<"
	);
}

const NUMBER_PATTERN = /^[+-]?\d+(?:\.\d+)?$/;

export function tokenize(input: string): JqlToken[] {
	const tokens: JqlToken[] = [];
	let index = 0;
	let line = 1;
	let character = 1;

	const advance = (count = 1) => {
		for (let step = 0; step < count && index < input.length; step++) {
			if (input[index] === "\n") {
				line += 1;
				character = 1;
			} else {
				character += 1;
			}
			index += 1;
		}
	};

	while (index < input.length) {
		const current = input[index] as string;
		if (
			current === " " ||
			current === "\t" ||
			current === "\r" ||
			current === "\n"
		) {
			advance();
			continue;
		}

		const position = { line, character };

		if (current === '"') {
			const start = index;
			advance();
			let value = "";
			let closed = false;
			while (index < input.length) {
				const characterAtIndex = input[index] as string;
				if (characterAtIndex === "\\") {
					const next = input[index + 1];
					if (next === undefined) break;
					value += next;
					advance(2);
					continue;
				}
				if (characterAtIndex === '"') {
					advance();
					closed = true;
					break;
				}
				value += characterAtIndex;
				advance();
			}
			if (!closed) {
				throw new JqlError("Expecting '\"' but got end of input.", position);
			}
			tokens.push({
				type: "string",
				value,
				text: input.slice(start, index),
				position,
			});
			continue;
		}

		const symbol = SYMBOLS[current];
		if (symbol) {
			advance();
			tokens.push({
				type: symbol,
				value: current,
				text: current,
				position,
			});
			continue;
		}

		if (OPERATORS.has(current)) {
			const two = input.slice(index, index + 2);
			const value = OPERATORS.has(two) ? two : current;
			advance(value.length);
			tokens.push({ type: "operator", value, text: value, position });
			continue;
		}

		const start = index;
		while (index < input.length && !isWordBreak(input[index] as string)) {
			advance();
		}
		const text = input.slice(start, index);
		const type = NUMBER_PATTERN.test(text) ? "number" : "word";
		tokens.push({ type, value: text, text, position });
	}

	tokens.push({
		type: "eof",
		value: "",
		text: "",
		position: { line, character },
	});
	return tokens;
}
