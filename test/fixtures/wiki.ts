import type {
	WikiAttachment,
	WikiComment,
	WikiPage,
	WikiSpaceData,
	WikiUser,
	WikiVersion,
} from "../../src/importer/wiki-types.ts";

const day = (value: number) => new Date(Date.UTC(2026, 0, value, 10, 0, 0));

export const fixtureUsers: WikiUser[] = [
	{
		userKey: "uk-alice",
		username: "alice",
		displayName: "Alice Anderson",
		email: "alice@example.test",
		avatarUrl: "/images/icons/profilepics/default.svg",
		active: true,
	},
	{
		userKey: "uk-bob",
		username: "bob",
		displayName: "Bob Brown",
		email: "bob@example.test",
		avatarUrl: null,
		active: true,
	},
];

function version(
	number: number,
	title: string,
	storage: string,
	view: string,
	total: number,
): WikiVersion {
	return {
		number,
		title,
		storage,
		view,
		authorUserKey: number === total ? "uk-bob" : "uk-alice",
		created: day(number),
		message: number === 1 ? "created" : "rewritten",
		minorEdit: number !== total,
	};
}

function attachment(
	sourceId: string,
	fileName: string,
	versionNumber: number,
	size: number,
	sha256: string,
): WikiAttachment {
	return {
		sourceId,
		attachmentId: sourceId.split(":")[0],
		fileName,
		mimeType: "image/png",
		size,
		version: versionNumber,
		authorUserKey: "uk-alice",
		created: day(versionNumber),
		comment: null,
		storagePath: `${sha256}/${sourceId.replace(":", "-")}`,
		sha256,
	};
}

function comment(
	sourceId: string,
	parentSourceId: string | null,
	inline: boolean,
): WikiComment {
	return {
		sourceId,
		parentSourceId,
		authorUserKey: "uk-alice",
		storage: `<p>comment ${sourceId}</p>`,
		view: `<p>comment ${sourceId}</p>`,
		created: day(3),
		updated: day(4),
		inline,
		inlineOriginalSelection: inline ? "highlighted text" : null,
		inlineMarkerRef: inline ? `marker-${sourceId}` : null,
		resolved: false,
	};
}

const homePageView = [
	'<p>Owner <a class="confluence-userlink user-mention" data-username="alice" href="/display/~alice">Alice Anderson</a></p>',
	'<p>Read <a href="/display/FIX/Child+One">Child One</a> and <a href="/pages/viewpage.action?pageId=102">Child Two</a></p>',
	'<p>Issue <a class="issue-link" href="https://jira.example.test/browse/ABC-12?src=confmacro">ABC-12</a></p>',
	'<p><img src="https://confluence.example.test/download/attachments/100/diagram.png?version=2" alt="diagram" /></p>',
	'<p><a href="/download/attachments/100/notes.txt">notes</a></p>',
].join("");

const homePageStorage = [
	'<p>Owner <ac:link><ri:user ri:userkey="uk-alice" /></ac:link></p>',
	'<p>Read <ac:link><ri:page ri:content-title="Child One" ri:space-key="FIX" /></ac:link></p>',
	'<p><ac:image ac:alt="diagram"><ri:attachment ri:filename="diagram.png" /></ac:image></p>',
	'<p><ac:structured-macro ac:name="jira" ac:schema-version="1"><ac:parameter ac:name="key">ABC-12</ac:parameter></ac:structured-macro></p>',
	'<p><ac:structured-macro ac:name="toc" ac:schema-version="1"></ac:structured-macro></p>',
].join("");

function page(
	sourceId: string,
	title: string,
	status: WikiPage["status"],
	parentSourceId: string | null,
	position: number,
	extra: Partial<WikiPage> = {},
): WikiPage {
	return {
		sourceId,
		spaceKey: "FIX",
		parentSourceId,
		position,
		title,
		type: "page",
		status,
		versionNumber: 1,
		storage: `<p>${title}</p>`,
		view: `<p>${title}</p>`,
		creatorUserKey: "uk-alice",
		created: day(1),
		lastModifierUserKey: "uk-bob",
		updated: day(2),
		versions: [version(1, title, `<p>${title}</p>`, `<p>${title}</p>`, 1)],
		comments: [],
		attachments: [],
		labels: [],
		restrictions: [],
		watchers: [],
		likes: [],
		...extra,
	};
}

export function wikiFixture(): { users: WikiUser[]; spaces: WikiSpaceData[] } {
	const home = page("100", "Home", "current", null, 0, {
		versionNumber: 2,
		storage: homePageStorage,
		view: homePageView,
		versions: [
			version(1, "Home", "<p>Home v1</p>", "<p>Home v1</p>", 2),
			version(2, "Home", homePageStorage, homePageView, 2),
		],
		comments: [
			comment("200", null, false),
			comment("201", "200", false),
			comment("202", null, true),
			{
				...comment("203", null, true),
				resolved: true,
				inlineOriginalSelection: "second highlight",
				inlineMarkerRef: "marker-203",
			},
		],
		attachments: [
			attachment("300:1", "diagram.png", 1, 12, "aa11"),
			attachment("300:2", "diagram.png", 2, 34, "bb22"),
			attachment("301:1", "notes.txt", 1, 7, "cc33"),
		],
		labels: ["spec", "howto"],
		restrictions: [
			{ operation: "read", userKey: "uk-alice", groupName: null },
			{ operation: "update", userKey: null, groupName: "confluence-admins" },
		],
	});

	const childOne = page("101", "Child One", "current", "100", 0);
	const childTwo = page("102", "Child Two", "current", "100", 1);
	const draft = page("103", "Draft Page", "draft", "100", 2, {
		view: "",
		versions: [],
	});
	const trashed = page("104", "Old Page", "trashed", null, 0, { versions: [] });
	const blogpost = page("105", "News", "current", null, 0, {
		type: "blogpost",
	});

	const fix: WikiSpaceData = {
		space: {
			sourceId: "1",
			key: "FIX",
			name: "Fixture Space",
			type: "global",
			status: "current",
			descriptionHtml: "<p>fixture space</p>",
			homePageSourceId: "100",
			creatorUserKey: "uk-alice",
			created: day(1),
			iconPath: "/images/logo/default-space-logo.svg",
		},
		permissions: [
			{
				permission: "read",
				userKey: "uk-bob",
				groupName: null,
				anonymous: false,
			},
			{
				permission: "read",
				userKey: null,
				groupName: "confluence-users",
				anonymous: false,
			},
			{ permission: "read", userKey: null, groupName: null, anonymous: true },
		],
		templates: [],
		pages: [home, childOne, childTwo, draft, trashed, blogpost],
		spaceWatchers: [],
	};

	const personal: WikiSpaceData = {
		space: {
			sourceId: "2",
			key: "~alice",
			name: "Alice Anderson",
			type: "personal",
			status: "archived",
			descriptionHtml: null,
			homePageSourceId: null,
			creatorUserKey: "uk-alice",
			created: day(1),
			iconPath: null,
		},
		permissions: [
			{
				permission: "read",
				userKey: "uk-alice",
				groupName: null,
				anonymous: false,
			},
		],
		templates: [],
		pages: [],
		spaceWatchers: [],
	};

	return { users: fixtureUsers, spaces: [fix, personal] };
}
