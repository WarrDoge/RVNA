/** The design tokens the components use, as the CSS variables that `src/theme.css` defines. */
const variables = {
	"color.background.accent.blue.subtlest":
		"--ds-background-accent-blue-subtlest",
	"color.background.accent.green.subtlest":
		"--ds-background-accent-green-subtlest",
	"color.background.accent.purple.subtlest":
		"--ds-background-accent-purple-subtlest",
	"color.background.accent.red.subtlest": "--ds-background-accent-red-subtlest",
	"color.background.accent.yellow.subtlest":
		"--ds-background-accent-yellow-subtlest",
	"color.background.brand.bold": "--ds-background-brand-bold",
	"color.background.information.bold": "--ds-background-information-bold",
	"color.background.input": "--ds-background-input",
	"color.background.neutral": "--ds-background-neutral",
	"color.background.neutral.bold": "--ds-background-neutral-bold",
	"color.background.neutral.subtle": "--ds-background-neutral-subtle",
	"color.background.neutral.subtle.hovered":
		"--ds-background-neutral-subtle-hovered",
	"color.background.selected": "--ds-background-selected",
	"color.background.success.bold": "--ds-background-success-bold",
	"color.border": "--ds-border",
	"color.border.bold": "--ds-border-bold",
	"color.border.input": "--ds-border-input",
	"color.border.selected": "--ds-border-selected",
	"color.chart.blue.bold": "--ds-chart-blue-bold",
	"color.chart.brand": "--ds-chart-brand",
	"color.chart.categorical.1": "--ds-chart-categorical-1",
	"color.chart.categorical.2": "--ds-chart-categorical-2",
	"color.chart.categorical.3": "--ds-chart-categorical-3",
	"color.chart.categorical.4": "--ds-chart-categorical-4",
	"color.chart.categorical.5": "--ds-chart-categorical-5",
	"color.chart.categorical.6": "--ds-chart-categorical-6",
	"color.chart.categorical.7": "--ds-chart-categorical-7",
	"color.chart.categorical.8": "--ds-chart-categorical-8",
	"color.chart.gray.bold": "--ds-chart-gray-bold",
	"color.chart.green.bold": "--ds-chart-green-bold",
	"color.chart.magenta.bold": "--ds-chart-magenta-bold",
	"color.chart.neutral": "--ds-chart-neutral",
	"color.chart.orange.bold": "--ds-chart-orange-bold",
	"color.chart.purple.bold": "--ds-chart-purple-bold",
	"color.chart.red.bold": "--ds-chart-red-bold",
	"color.chart.success.bold": "--ds-chart-success-bold",
	"color.chart.teal.bold": "--ds-chart-teal-bold",
	"color.icon": "--ds-icon",
	"color.link": "--ds-link",
	"color.text": "--ds-text",
	"color.text.danger": "--ds-text-danger",
	"color.text.disabled": "--ds-text-disabled",
	"color.text.inverse": "--ds-text-inverse",
	"color.text.selected": "--ds-text-selected",
	"color.text.subtle": "--ds-text-subtle",
	"color.text.subtlest": "--ds-text-subtlest",
	"elevation.shadow.overlay": "--ds-shadow-overlay",
	"elevation.surface": "--ds-surface",
	"elevation.surface.overlay": "--ds-surface-overlay",
	"elevation.surface.raised": "--ds-surface-raised",
	"elevation.surface.sunken": "--ds-surface-sunken",
} as const;

export type TokenName = keyof typeof variables;

/** `var(--ds-...)` for a token name; the optional fallback is the second argument of `var()`. */
export function token(name: TokenName, fallback?: string) {
	const variable = variables[name];
	return fallback ? `var(${variable}, ${fallback})` : `var(${variable})`;
}
