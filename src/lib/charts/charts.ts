import { monthDay, monthDayTime } from "#lib/dates.ts";
import { token } from "#lib/tokens.ts";

export const chartWidth = 1000;
export const chartHeight = 340;
export const margin = { top: 18, right: 18, bottom: 42, left: 54 };
export const plotWidth = chartWidth - margin.left - margin.right;
export const plotHeight = chartHeight - margin.top - margin.bottom;

export const axisColor = token("color.border");
export const textColor = token("color.text.subtle");
export const lineColor = token("color.chart.brand");
export const guidelineColor = token("color.chart.neutral");
export const nonWorkingColor = token("color.background.neutral");
export const tooltipBackground = token("elevation.surface.overlay");
export const tooltipTextColor = token("color.text");
export const tooltipShadow = token("elevation.shadow.overlay");
export const completedColor = token("color.chart.success.bold");
export const commitmentColor = token("color.chart.blue.bold");

export const cfdColors = [
	token("color.chart.blue.bold"),
	token("color.chart.purple.bold"),
	token("color.chart.teal.bold"),
	token("color.chart.orange.bold"),
	token("color.chart.magenta.bold"),
	token("color.chart.green.bold"),
	token("color.chart.gray.bold"),
	token("color.chart.red.bold"),
];

export function yTicksFor(yMax: number) {
	return [
		...new Set(
			Array.from({ length: 6 }, (_, index) => Math.round((yMax * index) / 5)),
		),
	];
}

export function niceMax(value: number) {
	if (value <= 0) return 1;
	const exponent = 10 ** Math.floor(Math.log10(value));
	const fraction = value / exponent;
	const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
	const nice = steps.find((step) => fraction <= step) ?? 10;
	return nice * exponent;
}

export function dateLabel(value: string) {
	return monthDay(value);
}

export function dateTimeLabel(value: string) {
	return monthDayTime(value);
}

export function shortName(value: string, length = 16) {
	return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

export function timeScale(startTime: number, span: number) {
	return (value: number) =>
		margin.left + ((value - startTime) / span) * plotWidth;
}

export function valueScale(yMax: number) {
	return (value: number) =>
		margin.top + plotHeight - (value / yMax) * plotHeight;
}

export function clampIndex(index: number, count: number) {
	if (count <= 0) return -1;
	return Math.max(0, Math.min(count - 1, Math.round(index)));
}

export function indexScale(count: number) {
	return (index: number) =>
		margin.left +
		(count <= 1 ? plotWidth / 2 : (index / (count - 1)) * plotWidth);
}

export function stepPath(
	points: { at: string; remaining: number }[],
	xScale: (value: number) => number,
	yScale: (value: number) => number,
) {
	if (points.length === 0) return "";
	let path = `M ${xScale(new Date(points[0].at).getTime())} ${yScale(points[0].remaining)}`;
	for (let index = 1; index < points.length; index += 1) {
		const previous = points[index - 1];
		const point = points[index];
		const x = xScale(new Date(point.at).getTime());
		path += ` L ${x} ${yScale(previous.remaining)} L ${x} ${yScale(point.remaining)}`;
	}
	return path;
}

export function guidelinePath(
	points: { at: string; remaining: number }[],
	xScale: (value: number) => number,
	yScale: (value: number) => number,
) {
	return points
		.map((point, index) => {
			const x = xScale(new Date(point.at).getTime());
			const y = yScale(point.remaining);
			return `${index === 0 ? "M" : "L"} ${x} ${y}`;
		})
		.join(" ");
}

export function stackedAreaPath(
	top: number[],
	below: number[],
	xScale: (value: number) => number,
	yScale: (value: number) => number,
) {
	const topPath = top
		.map(
			(value, index) =>
				`${index === 0 ? "M" : "L"} ${xScale(index)} ${yScale(value)}`,
		)
		.join(" ");
	const bottomPath = [...below]
		.reverse()
		.map((value, index) => {
			const dateIndex = below.length - 1 - index;
			return `L ${xScale(dateIndex)} ${yScale(value)}`;
		})
		.join(" ");
	return `${topPath} ${bottomPath} Z`;
}
