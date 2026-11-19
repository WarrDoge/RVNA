// Style values that come from a stored document are user input. A value is safe only when
// it cannot leave the declaration it is put in: no `;`, `:` or quotes. The converters and
// the Svelte node views use the same checks.

const cssValue = /^[#a-zA-Z0-9(),.%\s-]{1,64}$/;
const fontSize = /^[\d.]+(px|pt|em|rem|%)$/;
const textAlign = new Set(["left", "right", "center", "justify"]);
const listStyle = /^[a-z-]{1,32}$/;
const borderStyles = new Set([
	"none",
	"hidden",
	"dotted",
	"dashed",
	"solid",
	"double",
	"groove",
	"ridge",
	"inset",
	"outset",
]);
const borderWidth = /^\d{1,4}(px)?$/;

/** A CSS value that cannot add another declaration. */
export function safeCssValue(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const text = value.trim();
	return text !== "" && cssValue.test(text) ? text : null;
}

/** A colour value: a hex colour, a colour keyword, or rgb()/hsl() notation. */
export const safeColour = safeCssValue;

export function safeFontSize(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const text = value.trim();
	return fontSize.test(text) ? text : null;
}

export function safeTextAlign(value: unknown): string | null {
	return typeof value === "string" && textAlign.has(value) ? value : null;
}

export function safeListStyle(value: unknown): string | null {
	return typeof value === "string" && listStyle.test(value) ? value : null;
}

export function safeBorderStyle(value: unknown): string | null {
	return typeof value === "string" && borderStyles.has(value) ? value : null;
}

export function safeBorderWidth(value: unknown): number | null {
	if (typeof value === "number") {
		return Number.isFinite(value) && value >= 0 && value <= 1000
			? Math.round(value)
			: null;
	}
	if (typeof value !== "string") return null;
	const text = value.trim();
	if (!borderWidth.test(text)) return null;
	const number = Number.parseInt(text, 10);
	return number <= 1000 ? number : null;
}
