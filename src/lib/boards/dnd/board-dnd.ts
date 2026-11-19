import type {
	BoardIssue,
	CardColourStrategy,
	EstimationField,
} from "#lib/api-types.ts";
import { formatDuration } from "#lib/dates.ts";
import { token } from "#lib/tokens.ts";

export const BOARD_ONLY = ["board-issue"];
export const BACKLOG_ACCEPT = ["board-issue", "backlog-issue"];

const EPIC_COLOURS = [
	"#57a55a",
	"#8777d9",
	"#4bade8",
	"#f6c243",
	"#f79232",
	"#e5493a",
	"#2c9a9a",
	"#8eb021",
	"#d04437",
	"#a259d9",
	"#3b7ddd",
	"#e0a800",
	"#c43e3e",
	"#6b8e23",
];

export type DndStyle = Record<string, string | number | undefined>;

const unitless = new Set([
	"animationIterationCount",
	"aspectRatio",
	"borderImageSlice",
	"columnCount",
	"columns",
	"flex",
	"flexGrow",
	"flexShrink",
	"fontWeight",
	"gridColumn",
	"gridColumnEnd",
	"gridColumnStart",
	"gridRow",
	"gridRowEnd",
	"gridRowStart",
	"lineClamp",
	"lineHeight",
	"opacity",
	"order",
	"orphans",
	"scale",
	"tabSize",
	"widows",
	"zIndex",
	"zoom",
	"WebkitLineClamp",
]);

function propertyName(property: string) {
	if (property.startsWith("--")) return property;
	const prefixed = property.match(/^(Webkit|Moz|ms|O)([A-Z].*)$/);
	const name = prefixed ? prefixed[2] : property;
	const kebab = name
		.replace(/^[A-Z]/, (letter) => letter.toLowerCase())
		.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
	return prefixed ? `-${prefixed[1].toLowerCase()}-${kebab}` : kebab;
}

/** Serialise style objects for a Svelte `style` attribute. */
export function cssStyle(style?: string | DndStyle | null) {
	if (!style) return "";
	if (typeof style === "string") return style;
	return Object.entries(style)
		.filter(([, value]) => value !== undefined && value !== null)
		.map(([property, value]) => {
			const serialised =
				typeof value === "number" && !unitless.has(property)
					? `${value}px`
					: String(value);
			return `${propertyName(property)}: ${serialised};`;
		})
		.join(" ");
}

export function epicColour(colour: string | null | undefined) {
	if (!colour) return EPIC_COLOURS[1];
	const match = /ghx-label-(\d+)/.exec(colour);
	if (!match) return colour;
	const index = (Number(match[1]) - 1) % EPIC_COLOURS.length;
	return EPIC_COLOURS[index];
}

export function readableText(background: string) {
	const value = background.replace("#", "");
	const red = Number.parseInt(value.slice(0, 2), 16);
	const green = Number.parseInt(value.slice(2, 4), 16);
	const blue = Number.parseInt(value.slice(4, 6), 16);
	const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
	return luminance > 0.62 ? "#1d2125" : "#ffffff";
}

export function estimateLabel(estimate: number | null, field: EstimationField) {
	if (estimate === null || field === "issue_count") return "";
	if (field === "original_estimate") return formatDuration(estimate);
	return Number.isInteger(estimate) ? String(estimate) : estimate.toFixed(1);
}

export function cardBackground(
	issue: BoardIssue,
	strategy: CardColourStrategy,
) {
	if (strategy === "none") return token("elevation.surface.raised", "#242528");
	if (strategy === "priority" && issue.priority?.iconColor) {
		return issue.priority.iconColor;
	}
	if (strategy === "epic" && issue.epic) return epicColour(issue.epic.colour);
	if (strategy === "issue_type") {
		return issue.type.name === "Bug" ? "#5c2b29" : "#2c2e33";
	}
	if (strategy === "assignee" && issue.assignee) {
		const code = issue.assignee.username
			.split("")
			.reduce((sum, character) => sum + character.charCodeAt(0), 0);
		return EPIC_COLOURS[code % EPIC_COLOURS.length];
	}
	return token("elevation.surface.raised", "#242528");
}
