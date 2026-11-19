export const filterTabs = [
	{ id: "favourite", label: "Favourite" },
	{ id: "mine", label: "My" },
	{ id: "popular", label: "Popular" },
	{ id: "search", label: "Search" },
] as const;

export type FilterTab = (typeof filterTabs)[number]["id"];

export function isFilterTab(value: string | null): value is FilterTab {
	return filterTabs.some((tab) => tab.id === value);
}
