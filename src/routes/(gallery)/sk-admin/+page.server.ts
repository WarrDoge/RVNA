import { adminLoad } from "#lib/server/http-svelte.ts";
import type { PageServerLoad } from "./$types";

export const load = adminLoad(() => ({})) satisfies PageServerLoad;
