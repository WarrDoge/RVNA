import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";

const schema = z.object({ status: z.literal("ok") });

/** Liveness only: it must not touch PostgreSQL, so a database outage does not restart the pod. */
export const GET = endpoint({ auth: "none", response: schema }, () => ({
	status: "ok" as const,
}));
