import { api } from "#lib/api.ts";
import type { Attachment } from "#lib/api-types.ts";

export function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : "Something went wrong";
}

/** Uploads an inline editor image through the issue attachment endpoint. */
export async function uploadImageToIssue(issueKey: string, file: File) {
	const form = new FormData();
	form.append("file", file, file.name);
	const [attachment] = await api<Attachment[]>(
		`/api/issues/${encodeURIComponent(issueKey)}/attachments`,
		{ method: "POST", body: form },
	);
	return `/api/attachments/${attachment.id}`;
}
