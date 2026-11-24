import type { JSONContent } from "@tiptap/core";
import { api } from "#lib/api.ts";
import { isRasterImageType } from "#lib/shared/served-type.ts";
import type { UploadedAttachment } from "#lib/shared/wiki/index.ts";

export function uploadAttachments(
	pageId: string,
	files: File[],
): Promise<UploadedAttachment[]> {
	const body = new FormData();
	for (const file of files) body.append("file", file, file.name);
	return api<UploadedAttachment[]>(
		`/api/wiki/pages/${encodeURIComponent(pageId)}/attachments`,
		{ method: "POST", body },
	);
}

const imageName = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;

export function isImageAttachment(item: {
	mimeType: string | null;
	fileName: string;
}): boolean {
	return item.mimeType
		? isRasterImageType(item.mimeType)
		: imageName.test(item.fileName);
}

/** An image node for pictures, otherwise the file name as a link to the attachment. */
export function attachmentContent(item: UploadedAttachment): JSONContent[] {
	if (isImageAttachment(item)) {
		return [
			{
				type: "image",
				attrs: { fileName: item.fileName, src: item.url, alt: item.fileName },
			},
		];
	}
	return [
		{
			type: "text",
			text: item.fileName,
			marks: [
				{
					type: "link",
					attrs: {
						href: item.url,
						title: null,
						anchor: null,
						ref: {
							tag: "ri:attachment",
							attrs: { "ri:filename": item.fileName },
						},
					},
				},
			],
		},
		{ type: "text", text: " " },
	];
}

/**
 * Files on the clipboard that should become attachments. A rich-text copy that also carries a
 * picture of itself (Word, browsers) is pasted as text instead.
 */
export function pastedFilesToUpload(files: File[], html: string): File[] {
	if (files.length === 0) return [];
	const text = html.replace(/<[^>]*>/g, "").trim();
	const onlyImages = files.every((file) => file.type.startsWith("image/"));
	return onlyImages && text !== "" ? [] : files;
}

/** Clipboard pictures are all called "image.png"; give each paste its own name. */
export function pastedFileName(
	name: string,
	type: string,
	now = new Date(),
): string {
	if (!/^image\.\w+$/i.test(name)) return name;
	const stamp = now
		.toISOString()
		.replace(/[-:]/g, "")
		.replace("T", "-")
		.slice(0, 15);
	const extension = name.split(".").pop() ?? type.split("/")[1] ?? "png";
	return `pasted-${stamp}.${extension}`;
}
