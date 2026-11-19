import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { authConfig } from "#lib/server/local-auth.ts";

const schema = z.object({
	sso: z.boolean(),
	ssoAutoRedirect: z.boolean(),
	devLogin: z.boolean(),
});

export const GET = endpoint(
	{ auth: "none", response: schema },
	async ({ event }) => {
		event.setHeaders({ "cache-control": "no-store" });
		return authConfig();
	},
);
