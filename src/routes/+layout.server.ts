import { unreadNotifications } from "#lib/server/notifications.ts";
import { dateContext } from "#lib/server/request-context.ts";
import { readSiteSettings } from "#lib/server/site.ts";
import type { LayoutServerLoad } from "./$types";

export const trailingSlash = "ignore";

export const load: LayoutServerLoad = async ({ depends, locals }) => {
	depends("app:shell");
	depends("app:notifications");

	const user = locals.user;
	const dates = dateContext();
	const [site, unread] = await Promise.all([
		readSiteSettings(),
		user ? unreadNotifications(user) : Promise.resolve({ unread: 0 }),
	]);

	// A signed-out visitor needs only the title, for the sign-in page.
	const visible = user
		? site
		: {
				title: site.title,
				baseUrl: "",
				defaultIssueTypeId: null,
				defaultPriorityId: null,
			};

	return {
		user,
		site: visible,
		unread: unread.unread,
		timeZone: dates.timeZone,
		locale: dates.locale,
		now: dates.now,
	};
};
