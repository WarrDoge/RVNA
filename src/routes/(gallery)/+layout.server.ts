import { error } from "@sveltejs/kit";
import { dev } from "$app/env";
import type { LayoutServerLoad } from "./$types";

/** The component galleries exist for development and the end-to-end run, never in production. */
export const load: LayoutServerLoad = () => {
	if (!dev && process.env.NODE_ENV !== "test") error(404, "Not found");
};
