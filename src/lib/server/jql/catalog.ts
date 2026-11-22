import { sql } from "drizzle-orm";
import { db } from "../db.ts";
import { requestCache } from "../request-context.ts";

export interface JqlCatalog {
	projects: { id: string; key: string; name: string }[];
	issueTypes: { id: string; name: string; subtask: boolean }[];
	statuses: { id: string; name: string; category: string }[];
	priorities: { id: string; name: string; sequence: number }[];
	resolutions: { id: string; name: string }[];
	versions: {
		id: string;
		name: string;
		released: boolean;
		projectId: string;
	}[];
	components: { id: string; name: string; projectId: string }[];
	linkTypes: { id: string; name: string; inward: string; outward: string }[];
	users: { id: string; username: string; displayName: string }[];
	groups: { id: string; name: string }[];
	customFields: {
		id: string;
		sourceId: string;
		name: string;
		type: string | null;
		customKey: string | null;
	}[];
	fieldOptions: {
		fieldId: string;
		value: string;
		parentOptionId: string | null;
	}[];
	sprints: {
		name: string;
		state: "ACTIVE" | "CLOSED" | "FUTURE";
		projectId: string;
	}[];
}

type Row = Record<string, unknown>;

async function rows(query: ReturnType<typeof sql>): Promise<Row[]> {
	const result = await db.execute(query);
	return result.rows as Row[];
}

const catalogKey = {};

export function loadCatalog(): Promise<JqlCatalog> {
	return requestCache(catalogKey, loadCatalogUncached);
}

async function loadCatalogUncached(): Promise<JqlCatalog> {
	const [
		projectRows,
		issueTypeRows,
		statusRows,
		priorityRows,
		resolutionRows,
		versionRows,
		componentRows,
		linkTypeRows,
		userRows,
		groupRows,
		customFieldRows,
		fieldOptionRows,
		sprintRows,
	] = await Promise.all([
		rows(sql`select id, key, name from projects order by key`),
		rows(sql`select id, name, subtask from issue_types order by name`),
		rows(sql`select id, name, category from statuses order by name`),
		rows(
			sql`select id, name, sequence from priorities order by sequence, name`,
		),
		rows(sql`select id, name from resolutions order by name`),
		rows(
			sql`select id, name, released, project_id from versions order by name`,
		),
		rows(sql`select id, name, project_id from components order by name`),
		rows(sql`select id, name, inward, outward from link_types order by name`),
		rows(
			sql`select id, username, display_name from users order by display_name`,
		),
		rows(sql`select id, name from groups order by name`),
		rows(
			sql`select id, source_id, name, type, custom_key from fields order by name`,
		),
		rows(
			sql`select field_id, value, parent_option_id from field_options order by value`,
		),
		rows(
			sql`select distinct s.name, s.state, b.project_id from sprints s join boards b on b.id = s.board_id where b.project_id is not null union select distinct s.name, s.state, b.project_id from board_sprints bs join sprints s on s.id = bs.sprint_id join boards b on b.id = bs.board_id where b.project_id is not null order by 1`,
		),
	]);

	const sprints = sprintRows.map((row) => ({
		name: String(row.name),
		state: String(row.state).toUpperCase() as "ACTIVE" | "CLOSED" | "FUTURE",
		projectId: String(row.project_id),
	}));

	return {
		projects: projectRows.map((row) => ({
			id: String(row.id),
			key: String(row.key),
			name: String(row.name),
		})),
		issueTypes: issueTypeRows.map((row) => ({
			id: String(row.id),
			name: String(row.name),
			subtask: Boolean(row.subtask),
		})),
		statuses: statusRows.map((row) => ({
			id: String(row.id),
			name: String(row.name),
			category: String(row.category),
		})),
		priorities: priorityRows.map((row) => ({
			id: String(row.id),
			name: String(row.name),
			sequence: Number(row.sequence),
		})),
		resolutions: resolutionRows.map((row) => ({
			id: String(row.id),
			name: String(row.name),
		})),
		versions: versionRows.map((row) => ({
			id: String(row.id),
			name: String(row.name),
			released: Boolean(row.released),
			projectId: String(row.project_id),
		})),
		components: componentRows.map((row) => ({
			id: String(row.id),
			name: String(row.name),
			projectId: String(row.project_id),
		})),
		linkTypes: linkTypeRows.map((row) => ({
			id: String(row.id),
			name: String(row.name),
			inward: String(row.inward),
			outward: String(row.outward),
		})),
		users: userRows.map((row) => ({
			id: String(row.id),
			username: String(row.username),
			displayName: String(row.display_name),
		})),
		groups: groupRows.map((row) => ({
			id: String(row.id),
			name: String(row.name),
		})),
		customFields: customFieldRows.map((row) => ({
			id: String(row.id),
			sourceId: String(row.source_id),
			name: String(row.name),
			type: row.type === null ? null : String(row.type),
			customKey: row.custom_key === null ? null : String(row.custom_key),
		})),
		fieldOptions: fieldOptionRows.map((row) => ({
			fieldId: String(row.field_id),
			value: String(row.value),
			parentOptionId:
				row.parent_option_id === null ? null : String(row.parent_option_id),
		})),
		sprints,
	};
}
