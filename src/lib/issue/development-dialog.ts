export type DevelopmentCell = {
	text: string;
	href?: string;
	title?: string;
	lozenge?: "default" | "success" | "moved" | "new" | "removed" | "inprogress";
};

export type DevelopmentRow = {
	id: string;
	cells: DevelopmentCell[];
};
