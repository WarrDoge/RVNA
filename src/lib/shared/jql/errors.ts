import type { JqlPosition } from "./ast.ts";

export class JqlError extends Error {
	readonly line: number | null;
	readonly character: number | null;

	constructor(message: string, position?: JqlPosition | null) {
		super(message);
		this.name = "JqlError";
		this.line = position?.line ?? null;
		this.character = position?.character ?? null;
	}

	get position(): JqlPosition | null {
		if (this.line === null || this.character === null) return null;
		return { line: this.line, character: this.character };
	}

	get jiraMessage(): string {
		if (this.line === null || this.character === null) {
			return `Error in the JQL Query: ${this.message}`;
		}
		return `Error in the JQL Query: ${this.message} (line ${this.line}, character ${this.character})`;
	}
}

export function jqlError(
	message: string,
	position?: JqlPosition | null,
): never {
	throw new JqlError(message, position);
}
