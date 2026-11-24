/**
 * The one rule for the content type of a file that a user uploaded. The uploader chooses the
 * declared type, so it is never sent back as it is: only the inert types below are, and every
 * other file is `application/octet-stream`. A file is therefore never a script, a style sheet
 * or an HTML document of the app's origin, whatever it was declared to be.
 */
const rasterImages = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/avif",
	"image/bmp",
	"image/x-icon",
	"image/vnd.microsoft.icon",
]);
const media = /^(?:audio|video)\/[a-z0-9][a-z0-9.-]*$/;

const baseType = (mimeType: string | null | undefined) =>
	(mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

export function isRasterImageType(mimeType: string | null | undefined) {
	return rasterImages.has(baseType(mimeType));
}

/** Inert types may be shown in the browser; everything else is a download. */
export function isInertType(mimeType: string | null | undefined) {
	const base = baseType(mimeType);
	return (
		rasterImages.has(base) ||
		media.test(base) ||
		base === "application/pdf" ||
		base === "text/plain"
	);
}

/** The `Content-Type` to send for a user's file. */
export function servedType(mimeType: string | null | undefined) {
	return isInertType(mimeType)
		? baseType(mimeType)
		: "application/octet-stream";
}
