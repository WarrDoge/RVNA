export type ImageType = "png" | "jpeg" | "webp" | "gif" | "svg";

export interface DetectedImage {
	type: ImageType;
	contentType: string;
	extension: string;
}

const TYPES: Record<ImageType, DetectedImage> = {
	png: { type: "png", contentType: "image/png", extension: ".png" },
	jpeg: { type: "jpeg", contentType: "image/jpeg", extension: ".jpg" },
	webp: { type: "webp", contentType: "image/webp", extension: ".webp" },
	gif: { type: "gif", contentType: "image/gif", extension: ".gif" },
	svg: {
		type: "svg",
		contentType: "image/svg+xml",
		extension: ".svg",
	},
};

const CONTENT_TYPES: Record<string, DetectedImage> = Object.fromEntries(
	Object.values(TYPES).map((value) => [value.contentType, value]),
);

function startsWith(bytes: Buffer, signature: number[]) {
	return signature.every((value, index) => bytes[index] === value);
}

function looksLikeSvg(bytes: Buffer) {
	const text = bytes.subarray(0, 2048).toString("utf8").trimStart();
	return /^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text);
}

export function detectImage(bytes: Buffer): DetectedImage | null {
	if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
		return TYPES.png;
	}
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return TYPES.jpeg;
	if (
		bytes.subarray(0, 6).toString("ascii") === "GIF87a" ||
		bytes.subarray(0, 6).toString("ascii") === "GIF89a"
	) {
		return TYPES.gif;
	}
	if (
		bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
		bytes.subarray(8, 12).toString("ascii") === "WEBP"
	) {
		return TYPES.webp;
	}
	if (looksLikeSvg(bytes)) return TYPES.svg;
	return null;
}

export function imageTypeForContentType(
	contentType: string | null | undefined,
): DetectedImage | null {
	const base = (contentType ?? "").split(";")[0]?.trim().toLowerCase();
	return base ? (CONTENT_TYPES[base] ?? null) : null;
}

export function imageTypeForFile(file: string): DetectedImage | null {
	const lower = file.toLowerCase();
	return (
		Object.values(TYPES).find((value) => lower.endsWith(value.extension)) ??
		null
	);
}

export function uploadImage(bytes: Buffer): DetectedImage | null {
	const detected = detectImage(bytes);
	if (!detected || detected.type === "svg") return null;
	return detected;
}
