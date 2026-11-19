import { getSystemInfo, systemInfoSchema } from "#lib/server/admin/system.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", response: systemInfoSchema },
	async ({ actor }) => getSystemInfo(actor),
);
