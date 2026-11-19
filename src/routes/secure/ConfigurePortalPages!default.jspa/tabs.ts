export const dashboardTabs = [
	{ id: "favourite", label: "Favourite" },
	{ id: "mine", label: "My" },
	{ id: "popular", label: "Popular" },
	{ id: "search", label: "Search" },
] as const;

export type DashboardTab = (typeof dashboardTabs)[number]["id"];

export function isDashboardTab(value: string | null): value is DashboardTab {
	return dashboardTabs.some((tab) => tab.id === value);
}
