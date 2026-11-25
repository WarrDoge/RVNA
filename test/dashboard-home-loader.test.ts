import { expect, test, vi } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { HttpError } from "../src/lib/server/http.ts";
import { load } from "../src/routes/secure/Dashboard.jspa/+page.server.ts";

const service = vi.hoisted(() => ({
	listDashboards: vi.fn(),
	defaultDashboard: vi.fn(),
	getDashboard: vi.fn(),
	getGadgetData: vi.fn(),
}));

vi.mock("#lib/server/dashboards/service.ts", () => service);

const user = {
	id: "00000000-0000-4000-8000-000000000001",
	username: "home-user",
	displayName: "Home User",
	email: null,
	avatarUrl: null,
	groups: [],
	isAdmin: false,
	mustChangePassword: false,
	hasPassword: true,
} satisfies CurrentUser;

function homeEvent(path = "/secure/Dashboard.jspa") {
	return {
		locals: { user },
		url: new URL(`http://localhost${path}`),
		params: {},
		route: { id: "/secure/Dashboard.jspa" },
		depends: () => undefined,
	} as never;
}

test("a user who can see no dashboard gets the welcome page", async () => {
	service.listDashboards.mockResolvedValue([]);
	service.defaultDashboard.mockRejectedValue(
		new HttpError(404, "No dashboard"),
	);
	const data = await load(homeEvent());
	expect(data).toMatchObject({ dashboard: null, empty: true, missing: false });
	expect(service.defaultDashboard).not.toHaveBeenCalled();
});

test("a dashboard that disappears between the list and the default read is the welcome page too", async () => {
	service.listDashboards.mockResolvedValue([{ id: "d1" }]);
	service.defaultDashboard.mockRejectedValue(
		new HttpError(404, "No dashboard"),
	);
	const data = await load(homeEvent());
	expect(data).toMatchObject({ dashboard: null, empty: true });
});

test("a gadget keeps domain messages and rethrows unknown errors", async () => {
	const dashboard = {
		id: "d1",
		gadgets: [{ id: "g1" }],
	};
	service.listDashboards.mockResolvedValue([{ id: "d1" }]);
	service.defaultDashboard.mockResolvedValue(dashboard);

	service.getGadgetData.mockRejectedValueOnce(
		new HttpError(400, "The filter is invalid"),
	);
	const data = await load(homeEvent());
	expect(data.gadgetData).toEqual({
		g1: { error: "The filter is invalid" },
	});

	service.getGadgetData.mockRejectedValueOnce(new Error("database secret"));
	await expect(load(homeEvent())).rejects.toThrow("database secret");
});
