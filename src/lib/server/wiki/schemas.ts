import { z } from "zod";
import { userRefSchema } from "../api-schemas.ts";
import { offsetQuery } from "../paging.ts";

export const pageParams = z.object({ id: z.string().min(1) });
export const spaceParams = z.object({ key: z.string().min(1) });
export const commentParams = z.object({ id: z.uuid() });
export const attachmentParams = z.object({ id: z.uuid() });
/** The download answers 404 for an id that is not a UUID, so the schema only needs a value. */
export const attachmentDownloadParams = z.object({ id: z.string().min(1) });

export const spaceSummarySchema = z.object({
	id: z.uuid(),
	key: z.string(),
	name: z.string(),
	type: z.enum(["global", "personal"]),
	descriptionHtml: z.string().nullable(),
	iconPath: z.string().nullable(),
	homePage: z
		.object({ id: z.uuid(), sourceId: z.string(), title: z.string() })
		.nullable(),
	pageCount: z.number().int(),
	created: z.iso.datetime().nullable(),
});

export const pageRefSchema = z.object({
	id: z.uuid(),
	sourceId: z.string(),
	title: z.string(),
	hasChildren: z.boolean(),
});

export const pageVersionSchema = z.object({
	number: z.number().int(),
	title: z.string().nullable(),
	created: z.iso.datetime().nullable(),
	message: z.string().nullable(),
	minorEdit: z.boolean(),
	author: userRefSchema.nullable(),
	current: z.boolean(),
});

export const attachmentSchema = z.object({
	id: z.uuid(),
	fileName: z.string(),
	mimeType: z.string().nullable(),
	size: z.number().int(),
	version: z.number().int(),
	author: userRefSchema.nullable(),
	created: z.iso.datetime().nullable(),
	comment: z.string().nullable(),
	versions: z
		.array(
			z.object({
				version: z.number().int(),
				size: z.number().int(),
				created: z.iso.datetime().nullable(),
				author: userRefSchema.nullable(),
			}),
		)
		.optional(),
});

export const commentSchema = z.object({
	id: z.uuid(),
	parentId: z.uuid().nullable(),
	author: userRefSchema.nullable(),
	bodyHtml: z.string().nullable(),
	created: z.iso.datetime().nullable(),
	updated: z.iso.datetime().nullable(),
	inline: z.boolean(),
	inlineMarkerRef: z.string().nullable(),
	inlineSelection: z.string().nullable(),
	resolved: z.boolean(),
	canEdit: z.boolean(),
});

export const pageWatchSchema = z.object({
	count: z.number().int(),
	watching: z.boolean(),
});

export const likeSchema = z.object({
	count: z.number().int(),
	liked: z.boolean(),
});

export const labelSchema = z.object({ id: z.uuid(), label: z.string() });

export const pageDetailSchema = z.object({
	id: z.uuid(),
	sourceId: z.string(),
	title: z.string(),
	type: z.enum(["page", "blogpost"]),
	status: z.enum(["current", "draft", "trashed"]),
	versionNumber: z.number().int(),
	space: z.object({
		id: z.uuid(),
		key: z.string(),
		name: z.string(),
		type: spaceSummarySchema.shape.type,
		iconPath: z.string().nullable(),
	}),
	ancestors: z.array(
		z.object({ id: z.uuid(), sourceId: z.string(), title: z.string() }),
	),
	creator: userRefSchema.nullable(),
	lastModifier: userRefSchema.nullable(),
	created: z.iso.datetime().nullable(),
	updated: z.iso.datetime().nullable(),
	bodyHtml: z.string().nullable(),
	labels: z.array(labelSchema),
	attachments: z.array(attachmentSchema),
	comments: z.array(commentSchema),
	children: z.array(pageRefSchema),
	watchers: pageWatchSchema,
	likes: likeSchema,
	restricted: z.boolean(),
	spaceWatching: z.boolean(),
});

export const spaceWatchSchema = z.object({ watching: z.boolean() });

export const restrictionSchema = z.object({
	space: z.array(
		z.object({
			id: z.uuid(),
			permission: z.string(),
			user: userRefSchema.nullable(),
			groupName: z.string().nullable(),
			anonymous: z.boolean(),
		}),
	),
	page: z.array(
		z.object({
			id: z.uuid(),
			operation: z.enum(["read", "update"]),
			user: userRefSchema.nullable(),
			groupName: z.string().nullable(),
		}),
	),
});

export const pageLinkSchema = z.object({
	id: z.uuid(),
	sourceId: z.string(),
	title: z.string(),
	spaceKey: z.string(),
	spaceName: z.string(),
	updated: z.iso.datetime().nullable(),
	author: z.string().nullable(),
});

export const pageLinkRefSchema = pageLinkSchema.omit({
	updated: true,
	author: true,
});

export const searchHitSchema = z.object({
	id: z.uuid(),
	sourceId: z.string(),
	title: z.string(),
	spaceKey: z.string(),
	spaceName: z.string(),
	excerpt: z.string(),
	updated: z.iso.datetime().nullable(),
	author: z.string().nullable(),
	rank: z.number(),
});

export const searchResultSchema = z.object({
	total: z.number().int(),
	offset: z.number().int(),
	limit: z.number().int(),
	hits: z.array(searchHitSchema),
});

export const suggestSchema = z.array(
	z.object({
		id: z.uuid(),
		sourceId: z.string(),
		title: z.string(),
		spaceKey: z.string(),
		spaceName: z.string(),
	}),
);

export const homeSchema = z.object({
	recent: z.array(pageLinkSchema),
	spaces: z.array(spaceSummarySchema),
	created: z.array(pageLinkRefSchema),
	watched: z.array(pageLinkRefSchema),
});

export const resolveSchema = z.object({
	id: z.uuid(),
	sourceId: z.string(),
	spaceKey: z.string(),
});

export const versionDetailSchema = z.object({
	number: z.number().int(),
	title: z.string().nullable(),
	created: z.iso.datetime().nullable(),
	message: z.string().nullable(),
	minorEdit: z.boolean(),
	author: userRefSchema.nullable(),
	bodyHtml: z.string().nullable(),
	current: z.boolean(),
});

export const templateSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	description: z.string().nullable(),
	spaceKey: z.string().nullable(),
	bodyStorage: z.string().nullable(),
});

export const attachmentByNameSchema = z.object({
	id: z.uuid(),
	fileName: z.string(),
	mimeType: z.string().nullable(),
	size: z.number().int(),
	version: z.number().int(),
	url: z.string(),
});

export const excerptSchema = z.object({ excerpt: z.string() });

export const spaceListQuery = z.object({
	type: z.enum(["global", "personal"]).optional(),
	query: z.string().trim().max(200).default(""),
});

export const pageQuery = z.object({
	version: z.coerce.number().int().positive().optional(),
});

export const versionParams = pageParams.extend({
	number: z.coerce.number().int().positive(),
});

export const diffQuery = z.object({
	from: z.coerce.number().int().positive(),
	to: z.coerce.number().int().positive(),
});

export const createCommentBody = z.object({
	bodyHtml: z.string().min(1).max(100_000),
	parentId: z.uuid().nullable().optional(),
	inline: z.boolean().optional(),
	marker: z.string().max(200).nullable().optional(),
	selection: z.string().max(2000).nullable().optional(),
});

export const updateCommentBody = z.object({
	bodyHtml: z.string().min(1).max(100_000),
});

export const resolveCommentBody = z.object({ resolved: z.boolean() });

export const addLabelBody = z.object({
	label: z.string().trim().min(1).max(255),
});

export const watchBody = z.object({ watching: z.boolean() });

export const labelNameParams = z.object({
	name: z.string().min(1).max(255),
});

function isDateValue(value: string) {
	if (value === "") return true;
	const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
	if (!parts) return false;
	const year = Number(parts[1]);
	const month = Number(parts[2]);
	const day = Number(parts[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return false;
	}
	return !Number.isNaN(Date.parse(value));
}

const dateValue = z
	.string()
	.trim()
	.max(40)
	.refine(isDateValue, { message: "Expected a date" })
	.optional();

export const searchQuery = z.object({
	query: z.string().trim().max(500).default(""),
	space: z.string().trim().max(100).optional(),
	contributor: z.string().trim().max(200).optional(),
	from: dateValue,
	to: dateValue,
	offset: offsetQuery,
	limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const suggestQuery = z.object({
	query: z.string().trim().max(500).default(""),
	limit: z.coerce.number().int().min(1).max(20).default(8),
});

export const recentQuery = z.object({
	limit: z.coerce.number().int().min(1).max(50).default(10),
	space: z.string().trim().max(100).optional(),
});

export const resolveQuery = z.object({
	pageId: z.string().trim().max(200).optional(),
	spaceKey: z.string().trim().max(100).optional(),
	title: z.string().trim().max(1000).optional(),
});

export const templatesQuery = z.object({
	space: z.string().trim().max(100).optional(),
});

export const excerptQuery = z.object({
	query: z.string().max(500).default(""),
});

export const attachmentNameParams = pageParams.extend({
	name: z.string().min(1).max(1000),
});

export const downloadParams = z.object({
	pageId: z.string().min(1),
	fileName: z.string().min(1).max(1000),
});

/** A repeated query key is accepted, as it was before; an array never matches a value. */
const singleValue = z.union([z.string(), z.array(z.string())]).optional();

export const downloadQuery = z.object({
	version: singleValue.transform((value) =>
		Array.isArray(value) ? undefined : value,
	),
	inline: singleValue.transform((value) => (Array.isArray(value) ? "" : value)),
});

export const attachmentInlineQuery = z.object({
	inline: singleValue.transform((value) => (Array.isArray(value) ? "" : value)),
});

export type CreateCommentInput = z.infer<typeof createCommentBody>;
export type SearchInput = z.infer<typeof searchQuery>;
export type ResolveInput = z.infer<typeof resolveQuery>;
