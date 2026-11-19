import { z } from "zod";
import { health } from "#lib/server/health/service.ts";
import { endpoint } from "#lib/server/http.ts";

const schema = z.object({ status: z.enum(["ok", "error"]) });

export const GET = endpoint({ auth: "none", response: schema }, async () => {
	const result = await health();
	return { status: result.status === "ok" ? 200 : 503, body: result };
});
