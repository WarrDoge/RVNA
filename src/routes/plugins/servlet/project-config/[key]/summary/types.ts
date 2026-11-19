export type ComponentRow = {
	id: string;
	name: string;
	description: string | null;
};

export type VersionRow = {
	id: string;
	name: string;
	description: string | null;
	startDate: string | null;
	releaseDate: string | null;
	released: boolean;
};
