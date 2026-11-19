import { env } from "./env.ts";

export function maxAttachmentBytes() {
	return env.MAX_ATTACHMENT_MB * 1024 * 1024;
}

export function maxUploadRequestBytes() {
	return env.MAX_UPLOAD_REQUEST_MB * 1024 * 1024;
}
