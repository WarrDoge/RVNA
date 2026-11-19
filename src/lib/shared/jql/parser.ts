import type {
	JqlComparisonOperator,
	JqlFieldRef,
	JqlHistoryClause,
	JqlHistoryOperator,
	JqlNode,
	JqlOperand,
	JqlOrderBy,
	JqlQuery,
} from "./ast.ts";
import { JqlError } from "./errors.ts";
import { JQL_FUNCTIONS, JQL_RESERVED_WORDS } from "./functions.ts";
import { type JqlToken, tokenize } from "./tokenizer.ts";

const SYMBOL_OPERATORS: Record<string, JqlComparisonOperator> = {
	"=": "=",
	"!=": "!=",
	"~": "~",
	"!~": "!~",
	">": ">",
	">=": ">=",
	"<": "<",
	"<=": "<=",
};

const CHANGE_PREDICATES = new Set([
	"from",
	"to",
	"by",
	"after",
	"before",
	"on",
	"during",
]);

function isReserved(word: string) {
	return JQL_RESERVED_WORDS.has(word.toLowerCase());
}

class Parser {
	private index = 0;
	private readonly tokens: JqlToken[];

	constructor(tokens: JqlToken[]) {
		this.tokens = tokens;
	}

	parse(): JqlQuery {
		const where =
			this.atEnd() || this.peekWord("order") ? null : this.parseOr();
		let orderBy: JqlOrderBy[] = [];

		if (this.peekWord("order")) {
			this.next();
			this.expectWord("by", "Expecting 'BY' after 'ORDER'");
			orderBy = this.parseOrderBy();
		}

		const token = this.peek();
		if (token.type !== "eof") {
			throw new JqlError(
				`Expecting end of query but got '${token.text}'.`,
				token.position,
			);
		}

		return { where, orderBy };
	}

	private peek(offset = 0): JqlToken {
		const token = this.tokens[this.index + offset];
		if (token) return token;
		return this.tokens[this.tokens.length - 1] as JqlToken;
	}

	private next(): JqlToken {
		const token = this.peek();
		if (token.type !== "eof") this.index += 1;
		return token;
	}

	private atEnd() {
		return this.peek().type === "eof";
	}

	private peekWord(word: string, offset = 0) {
		const token = this.peek(offset);
		return token.type === "word" && token.value.toLowerCase() === word;
	}

	private expectWord(word: string, message: string) {
		const token = this.peek();
		if (token.type === "word" && token.value.toLowerCase() === word) {
			return this.next();
		}
		throw new JqlError(
			`${message} but got '${this.describe(token)}'.`,
			token.position,
		);
	}

	private describe(token: JqlToken) {
		return token.type === "eof" ? "end of input" : token.text;
	}

	private parseOr(): JqlNode {
		let left = this.parseAnd();
		while (this.peekWord("or")) {
			this.next();
			left = { kind: "or", left, right: this.parseAnd() };
		}
		return left;
	}

	private parseAnd(): JqlNode {
		let left = this.parseNot();
		while (this.peekWord("and")) {
			this.next();
			left = { kind: "and", left, right: this.parseNot() };
		}
		return left;
	}

	private parseNot(): JqlNode {
		const token = this.peek();
		if (
			this.peekWord("not") ||
			(token.type === "operator" && token.value === "!")
		) {
			this.next();
			return { kind: "not", operand: this.parseNot() };
		}
		return this.parsePrimary();
	}

	private parsePrimary(): JqlNode {
		const token = this.peek();
		if (token.type === "lparen") {
			this.next();
			const node = this.parseOr();
			const closing = this.peek();
			if (closing.type !== "rparen") {
				throw new JqlError(
					`Expecting ')' but got '${this.describe(closing)}'.`,
					closing.position,
				);
			}
			this.next();
			return node;
		}
		return this.parseClause();
	}

	private parseField(): JqlFieldRef {
		const token = this.peek();

		if (token.type === "string") {
			this.next();
			return { name: token.value, customId: null, position: token.position };
		}

		if (token.type === "word" && !isReserved(token.value)) {
			if (
				token.value.toLowerCase() === "cf" &&
				this.peek(1).type === "lbracket"
			) {
				const position = token.position;
				this.next();
				const open = this.peek();
				if (open.type !== "lbracket") {
					throw new JqlError("Expecting '[' after 'cf'.", open.position);
				}
				this.next();
				const id = this.peek();
				if (id.type !== "number" || !/^\d+$/.test(id.text)) {
					throw new JqlError(
						`Expecting a custom field id but got '${this.describe(id)}'.`,
						id.position,
					);
				}
				this.next();
				const close = this.peek();
				if (close.type !== "rbracket") {
					throw new JqlError(
						`Expecting ']' but got '${this.describe(close)}'.`,
						close.position,
					);
				}
				this.next();
				return {
					name: `cf[${id.text}]`,
					customId: Number(id.text),
					position,
				};
			}

			this.next();
			return { name: token.value, customId: null, position: token.position };
		}

		throw new JqlError(
			`Expecting a field name but got '${this.describe(token)}'.`,
			token.position,
		);
	}

	private parseClause(): JqlNode {
		const field = this.parseField();
		const token = this.peek();

		if (token.type === "operator") {
			const operator = SYMBOL_OPERATORS[token.value];
			if (!operator) {
				throw new JqlError(
					`Expecting operator but got '${token.text}'.`,
					token.position,
				);
			}
			this.next();
			const operand = this.parseOperand();
			return { kind: "clause", field, operator, operand };
		}

		if (token.type === "word") {
			const word = token.value.toLowerCase();

			if (word === "in") {
				this.next();
				return {
					kind: "clause",
					field,
					operator: "in",
					operand: this.parseValueList(),
				};
			}

			if (word === "not") {
				this.next();
				this.expectWord("in", "Expecting 'IN' after 'NOT'");
				return {
					kind: "clause",
					field,
					operator: "not in",
					operand: this.parseValueList(),
				};
			}

			if (word === "is") {
				this.next();
				let operator: JqlComparisonOperator = "is";
				if (this.peekWord("not")) {
					this.next();
					operator = "is not";
				}
				const empty = this.parseEmpty();
				return { kind: "clause", field, operator, operand: empty };
			}

			if (word === "was") {
				this.next();
				return this.parseWas(field);
			}

			if (word === "changed") {
				this.next();
				return this.parseChanged(field);
			}
		}

		throw new JqlError(
			`Expecting operator but got '${this.describe(token)}'.`,
			token.position,
		);
	}

	private parseWas(field: JqlFieldRef): JqlHistoryClause {
		let operator: JqlHistoryOperator = "was";
		if (this.peekWord("not")) {
			this.next();
			operator = "was not";
		}

		const clause: JqlHistoryClause = {
			kind: "history",
			field,
			operator,
			values: [],
			from: null,
			to: null,
			by: null,
			after: null,
			before: null,
			on: null,
			during: null,
		};

		if (this.peekWord("in")) {
			this.next();
			operator = operator === "was not" ? "was not in" : "was in";
			clause.operator = operator;
			const list = this.parseValueList();
			clause.values = list.kind === "list" ? list.values : [list];
			return clause;
		}

		clause.values = [this.parseOperand()];
		return clause;
	}

	private parseChanged(field: JqlFieldRef): JqlHistoryClause {
		const clause: JqlHistoryClause = {
			kind: "history",
			field,
			operator: "changed",
			values: [],
			from: null,
			to: null,
			by: null,
			after: null,
			before: null,
			on: null,
			during: null,
		};

		while (true) {
			const token = this.peek();
			if (token.type !== "word") break;
			const word = token.value.toLowerCase();
			if (!CHANGE_PREDICATES.has(word)) break;
			this.next();

			if (word === "during") {
				const open = this.peek();
				if (open.type !== "lparen") {
					throw new JqlError(
						`Expecting '(' but got '${this.describe(open)}'.`,
						open.position,
					);
				}
				this.next();
				const from = this.parseOperand();
				const comma = this.peek();
				if (comma.type !== "comma") {
					throw new JqlError(
						`Expecting ',' but got '${this.describe(comma)}'.`,
						comma.position,
					);
				}
				this.next();
				const to = this.parseOperand();
				const close = this.peek();
				if (close.type !== "rparen") {
					throw new JqlError(
						`Expecting ')' but got '${this.describe(close)}'.`,
						close.position,
					);
				}
				this.next();
				clause.during = [from, to];
				continue;
			}

			const operand = this.parseOperand();
			switch (word) {
				case "from":
					clause.from = operand;
					break;
				case "to":
					clause.to = operand;
					break;
				case "by":
					clause.by = operand;
					break;
				case "after":
					clause.after = operand;
					break;
				case "before":
					clause.before = operand;
					break;
				case "on":
					clause.on = operand;
					break;
			}
		}

		return clause;
	}

	private parseOperand(): JqlOperand {
		const token = this.peek();

		if (token.type === "string") {
			this.next();
			return {
				kind: "string",
				value: token.value,
				quoted: true,
				position: token.position,
			};
		}

		if (token.type === "number") {
			this.next();
			return {
				kind: "number",
				value: Number(token.text),
				text: token.text,
				position: token.position,
			};
		}

		if (token.type === "word") {
			const word = token.value.toLowerCase();
			if (word === "empty" || word === "null") {
				this.next();
				return { kind: "empty", position: token.position };
			}
			if (isReserved(word)) {
				throw new JqlError(
					`Expecting a value but got '${token.text}'.`,
					token.position,
				);
			}
			if (this.peek(1).type === "lparen") {
				return this.parseFunction();
			}
			this.next();
			return {
				kind: "string",
				value: token.text,
				quoted: false,
				position: token.position,
			};
		}

		throw new JqlError(
			`Expecting a value but got '${this.describe(token)}'.`,
			token.position,
		);
	}

	private parseFunction(): JqlOperand {
		const nameToken = this.next();
		const name = nameToken.value.toLowerCase();
		const spec = JQL_FUNCTIONS[name];
		if (!spec) {
			throw new JqlError(
				`Function '${nameToken.text}' does not exist.`,
				nameToken.position,
			);
		}

		const open = this.peek();
		this.next();
		const args: JqlOperand[] = [];
		if (this.peek().type !== "rparen") {
			args.push(this.parseOperand());
			while (this.peek().type === "comma") {
				this.next();
				args.push(this.parseOperand());
			}
		}

		const close = this.peek();
		if (close.type !== "rparen") {
			throw new JqlError(
				`Expecting ')' but got '${this.describe(close)}'.`,
				close.position,
			);
		}
		this.next();

		if (args.length < spec.minArgs || args.length > spec.maxArgs) {
			throw new JqlError(
				`Function '${nameToken.text}' does not accept ${args.length} argument${args.length === 1 ? "" : "s"}.`,
				open.position,
			);
		}

		return { kind: "function", name, args, position: nameToken.position };
	}

	private parseValueList(): JqlOperand {
		if (this.peek().type !== "lparen") {
			const operand = this.parseOperand();
			return {
				kind: "list",
				values: operand.kind === "list" ? operand.values : [operand],
				position: operand.position,
			};
		}
		return this.parseList();
	}

	private parseList(): JqlOperand {
		const open = this.peek();
		if (open.type !== "lparen") {
			throw new JqlError(
				`Expecting '(' but got '${this.describe(open)}'.`,
				open.position,
			);
		}
		this.next();

		const values: JqlOperand[] = [];
		if (this.peek().type !== "rparen") {
			values.push(this.parseOperand());
			while (this.peek().type === "comma") {
				this.next();
				values.push(this.parseOperand());
			}
		}

		const close = this.peek();
		if (close.type !== "rparen") {
			throw new JqlError(
				`Expecting ')' but got '${this.describe(close)}'.`,
				close.position,
			);
		}
		this.next();

		if (values.length === 0) {
			throw new JqlError("Expecting a value but got ')'.", close.position);
		}

		return { kind: "list", values, position: open.position };
	}

	private parseEmpty(): JqlOperand {
		const token = this.peek();
		if (
			token.type === "word" &&
			(token.value.toLowerCase() === "empty" ||
				token.value.toLowerCase() === "null")
		) {
			this.next();
			return { kind: "empty", position: token.position };
		}
		throw new JqlError(
			`Expecting 'EMPTY' or 'NULL' but got '${this.describe(token)}'.`,
			token.position,
		);
	}

	private parseOrderBy(): JqlOrderBy[] {
		const items: JqlOrderBy[] = [];
		while (true) {
			const field = this.parseField();
			let direction: "asc" | "desc" = "asc";
			if (this.peekWord("asc")) {
				this.next();
			} else if (this.peekWord("desc")) {
				this.next();
				direction = "desc";
			}
			items.push({ field, direction });

			if (this.peek().type !== "comma") break;
			this.next();
		}
		return items;
	}
}

export function parseJql(input: string): JqlQuery {
	if (input.length > JQL_MAX_LENGTH) {
		throw new JqlError(
			`JQL query is longer than the ${JQL_MAX_LENGTH} character limit.`,
		);
	}

	const tokens = tokenize(input);
	if (parenDepth(tokens) > JQL_MAX_DEPTH) {
		throw new JqlError(
			`JQL query nesting is deeper than the ${JQL_MAX_DEPTH} level limit.`,
		);
	}

	const query = new Parser(tokens).parse();
	if (countClauses(query.where) > JQL_MAX_CLAUSES) {
		throw new JqlError(
			`JQL query has more than the ${JQL_MAX_CLAUSES} clause limit.`,
		);
	}
	return query;
}

export const JQL_MAX_LENGTH = 10_000;
export const JQL_MAX_CLAUSES = 200;
export const JQL_MAX_DEPTH = 20;

function parenDepth(tokens: JqlToken[]) {
	let depth = 0;
	let maximum = 0;
	for (const token of tokens) {
		if (token.type === "lparen") {
			depth += 1;
			maximum = Math.max(maximum, depth);
		} else if (token.type === "rparen") {
			depth = Math.max(0, depth - 1);
		}
	}
	return maximum;
}

function countClauses(node: JqlNode | null): number {
	if (!node) return 0;
	if (node.kind === "clause" || node.kind === "history") return 1;
	if (node.kind === "not") return countClauses(node.operand);
	return countClauses(node.left) + countClauses(node.right);
}
