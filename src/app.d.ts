import type { CurrentUser } from "#lib/server/auth.ts";
import type { SiteSettings } from "#lib/server/site.ts";

declare global {
	namespace App {
		interface Locals {
			user: CurrentUser | null;
		}

		/** The root layout always provides these to every page. */
		interface PageData {
			user: CurrentUser | null;
			site: SiteSettings;
			unread: number;
		}
	}
}
