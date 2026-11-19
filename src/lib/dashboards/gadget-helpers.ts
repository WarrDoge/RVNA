import { GADGET_COLORS } from "#lib/shared/gadgets.ts";
import { type TokenName, token } from "#lib/tokens.ts";
import type { Dashboard, Gadget } from "./types.ts";

export function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : "Something went wrong";
}

export function formError(data: unknown) {
	if (
		data &&
		typeof data === "object" &&
		"error" in data &&
		typeof data.error === "string"
	) {
		return data.error;
	}
	return "Something went wrong";
}

export function dashboardHref(dashboard: Dashboard) {
	return `/secure/Dashboard.jspa?selectPageId=${dashboard.sourceId ?? dashboard.id}`;
}

export function colourBackground(color: string) {
	const found = GADGET_COLORS.find((item) => item.value === color);
	return token((found?.background ?? "elevation.surface") as TokenName);
}

export function columnIds(gadgets: Gadget[], columns: number) {
	const result: string[][] = Array.from({ length: columns }, () => []);
	for (const gadget of gadgets) {
		const column = Math.min(Math.max(0, gadget.column), columns - 1);
		result[column]?.push(gadget.id);
	}
	return result;
}
