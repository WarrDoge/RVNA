import { extractIssueKeys } from "./keys.ts";

export type SmartCommitCommand =
	| { kind: "comment"; text: string }
	| { kind: "time"; seconds: number; text: string }
	| { kind: "transition"; name: string };

export interface SmartCommitLine {
	keys: string[];
	commands: SmartCommitCommand[];
}

const COMMENT = /^comment(?=\s|$)/i;
const TIME = /^time(?=\s|$)/i;

export function parseTimeSpent(value: string): number | null {
	const trimmed = value.trim().toLowerCase();
	if (trimmed === "") return null;
	if (/^\d+$/.test(trimmed)) return Number(trimmed) * 60;

	let total = 0;
	let consumed = "";
	const pattern = /(\d+(?:\.\d+)?)\s*([wdhm])/g;
	for (const match of trimmed.matchAll(pattern)) {
		consumed += match[0];
		const amount = Number(match[1]);
		total +=
			match[2] === "w"
				? amount * 5 * 8 * 3600
				: match[2] === "d"
					? amount * 8 * 3600
					: match[2] === "h"
						? amount * 3600
						: amount * 60;
	}
	if (
		total === 0 ||
		consumed.replace(/\s/g, "") !== trimmed.replace(/\s/g, "")
	) {
		return null;
	}
	return Math.round(total);
}

type Marker =
	| { at: number; end: number; kind: "comment" }
	| { at: number; end: number; kind: "time" }
	| { at: number; end: number; kind: "transition"; name: string };

function isBoundary(text: string, index: number) {
	if (index >= text.length) return true;
	return !/[A-Za-z0-9_]/.test(text[index] as string);
}

function findMarker(
	line: string,
	from: number,
	names: string[],
): Marker | null {
	let hash = line.indexOf("#", from);
	while (hash !== -1) {
		const rest = line.slice(hash + 1);
		if (COMMENT.test(rest)) {
			return { at: hash, end: hash + 1 + "comment".length, kind: "comment" };
		}
		if (TIME.test(rest)) {
			return { at: hash, end: hash + 1 + "time".length, kind: "time" };
		}
		const match = names.find((name) => {
			if (!rest.toLowerCase().startsWith(name.toLowerCase())) return false;
			return isBoundary(rest, name.length) && rest[name.length] !== "-";
		});
		if (match) {
			return {
				at: hash,
				end: hash + 1 + match.length,
				kind: "transition",
				name: match,
			};
		}
		hash = line.indexOf("#", hash + 1);
	}
	return null;
}

function commandsIn(line: string, names: string[]): SmartCommitCommand[] {
	const markers: Marker[] = [];
	let marker = findMarker(line, 0, names);
	while (marker) {
		markers.push(marker);
		marker = findMarker(line, marker.end, names);
	}

	const entries = markers.map((marker, index) => {
		const next = markers[index + 1];
		return {
			marker,
			text: line.slice(marker.end, next?.at ?? line.length).trim(),
		};
	});
	const valid = entries.filter(({ marker, text }) => {
		if (marker.kind === "time") return parseTimeSpent(text) !== null;
		if (marker.kind === "comment") return text !== "";
		return true;
	});

	const commands: SmartCommitCommand[] = [];
	for (const [index, { marker, text }] of valid.entries()) {
		const next = valid[index + 1]?.marker;
		if (marker.kind === "comment") {
			const comment = line.slice(marker.end, next?.at ?? line.length).trim();
			if (comment !== "") commands.push({ kind: "comment", text: comment });
		} else if (marker.kind === "time") {
			const seconds = parseTimeSpent(text);
			if (seconds !== null) {
				commands.push({ kind: "time", seconds, text });
			}
		} else {
			commands.push({ kind: "transition", name: marker.name });
		}
	}
	return commands;
}

/**
 * Reads Jira smart commit commands from a commit message. Each line applies its
 * commands to the issue keys on that same line. A `#` that does not introduce a
 * known command stays part of the surrounding comment.
 */
export function parseSmartCommitMessage(
	message: string,
	options: { projectKeys: string[]; commandNames: string[] },
): SmartCommitLine[] {
	const names = [...new Set(options.commandNames)].sort(
		(left, right) => right.length - left.length,
	);
	const lines: SmartCommitLine[] = [];
	for (const line of message.split(/\r?\n/)) {
		const keys = extractIssueKeys(line, options.projectKeys);
		if (keys.length === 0) continue;
		const commands = commandsIn(line, names);
		if (commands.length === 0) continue;
		lines.push({ keys, commands });
	}
	return lines;
}
