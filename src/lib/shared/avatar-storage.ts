import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { detectImage } from "./images.ts";

export interface StoredAvatar {
	file: string;
	sha256: string;
}

export async function storeAvatarFile(
	directory: string,
	bytes: Buffer,
): Promise<StoredAvatar | null> {
	const image = detectImage(bytes);
	if (!image) return null;

	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const file = `${sha256}${image.extension}`;
	await mkdir(directory, { recursive: true });
	try {
		await writeFile(join(directory, file), bytes, { flag: "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	return { file, sha256 };
}
