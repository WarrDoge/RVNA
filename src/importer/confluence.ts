import { GetOnlyClient, type GetOnlyClientOptions } from "./client.ts";
import type {
	ConfluenceContent,
	ConfluencePaged,
	ConfluenceSpace,
	ConfluenceSpacePermissions,
	ConfluenceUserRef,
	ConfluenceVersion,
} from "./wiki-types.ts";

export const SPACE_EXPAND =
	"description.plain,description.view,homepage,metadata.labels,icon";

const CONTENT_EXPAND = [
	"body.storage",
	"body.view",
	"version",
	"ancestors",
	"history",
	"metadata.labels",
	"extensions.position",
];

const RESTRICTION_EXPAND = [
	"restrictions.read.restrictions.user",
	"restrictions.read.restrictions.group",
	"restrictions.update.restrictions.user",
	"restrictions.update.restrictions.group",
];

export const COMMENT_EXPAND = [
	"body.storage",
	"body.view",
	"version",
	"history",
	"ancestors",
	"extensions.inlineProperties",
	"extensions.resolution",
].join(",");

const PAGE_SIZE = 100;
const MAX_PAGES = 1000;

export class ConfluenceClient extends GetOnlyClient {
	constructor(options: GetOnlyClientOptions) {
		super(options);
	}

	private async all<T>(
		path: string,
		params: Record<string, string | number | boolean | undefined>,
	): Promise<T[]> {
		const collected: T[] = [];
		let start = 0;
		for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
			const page = await this.getJson<ConfluencePaged<T>>(path, {
				...params,
				start,
				limit: PAGE_SIZE,
			});
			const results = page.results ?? [];
			collected.push(...results);
			if (results.length === 0) return collected;
			if (page._links && !page._links.next) return collected;
			start += results.length;
		}
		throw new Error(
			`pagination for ${path} did not finish after ${MAX_PAGES} pages`,
		);
	}

	async listSpaces(status: "current" | "archived") {
		return this.all<ConfluenceSpace>("/rest/api/space", {
			status,
			expand: SPACE_EXPAND,
		});
	}

	async listContent(
		spaceKey: string,
		type: "page" | "blogpost",
		status: "current" | "trashed" | "draft",
	) {
		const expand = [...CONTENT_EXPAND];
		// Trashed content cannot be expanded with restrictions: the server answers 500.
		if (status !== "trashed") expand.push(...RESTRICTION_EXPAND);
		return this.all<ConfluenceContent>("/rest/api/content", {
			spaceKey,
			type,
			status,
			expand: expand.join(","),
		});
	}

	async listSpaceRootContent(spaceKey: string) {
		const collect = async (type: "page" | "blogpost") => {
			const collected: ConfluenceContent[] = [];
			let start = 0;
			for (;;) {
				const response = await this.getJson<
					Record<string, ConfluencePaged<ConfluenceContent> | undefined>
				>(`/rest/api/space/${encodeURIComponent(spaceKey)}/content`, {
					depth: "root",
					type,
					start,
					limit: PAGE_SIZE,
					expand: "version",
				});
				const results = response[type]?.results ?? [];
				collected.push(...results);
				if (results.length < PAGE_SIZE) break;
				start += results.length;
			}
			return collected;
		};
		return { page: await collect("page"), blogpost: await collect("blogpost") };
	}

	async listChildPages(contentId: string) {
		return this.all<ConfluenceContent>(
			`/rest/api/content/${encodeURIComponent(contentId)}/child/page`,
			{},
		);
	}

	async listVersions(contentId: string) {
		return this.all<ConfluenceVersion>(
			`/rest/experimental/content/${encodeURIComponent(contentId)}/version`,
			{},
		);
	}

	async getHistoricalVersion(contentId: string, version: number) {
		return this.getJson<ConfluenceContent>(
			`/rest/api/content/${encodeURIComponent(contentId)}`,
			{
				status: "historical",
				version,
				expand: "body.storage,body.view,version",
			},
		);
	}

	async listComments(contentId: string) {
		return this.all<ConfluenceContent>(
			`/rest/api/content/${encodeURIComponent(contentId)}/child/comment`,
			{ expand: COMMENT_EXPAND, depth: "all" },
		);
	}

	async listAttachments(contentId: string) {
		return this.all<ConfluenceContent>(
			`/rest/api/content/${encodeURIComponent(contentId)}/child/attachment`,
			{ expand: "version,metadata" },
		);
	}

	async getAttachment(attachmentId: string) {
		return this.getJson<ConfluenceContent>(
			`/rest/api/content/${encodeURIComponent(attachmentId)}`,
			{ expand: "version,metadata" },
		);
	}

	async listAttachmentVersions(attachmentId: string) {
		return this.all<ConfluenceVersion>(
			`/rest/experimental/content/${encodeURIComponent(attachmentId)}/version`,
			{},
		);
	}

	async listSpacePermissions(spaceKey: string) {
		return this.getJson<ConfluenceSpacePermissions[]>(
			`/rest/api/space/${encodeURIComponent(spaceKey)}/permissions`,
		);
	}

	async listUsers() {
		return this.all<ConfluenceUserRef>("/rest/api/user/list", {});
	}

	async download(path: string) {
		return this.getBytes(path);
	}
}
