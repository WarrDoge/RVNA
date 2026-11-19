import { z } from "zod";
import { attachmentSchema, errorSchema } from "#lib/server/api-schemas.ts";
import {
	attachmentUploadLimits,
	issueParams,
	prepareAttachmentUpload,
	saveAttachmentUpload,
} from "#lib/server/attachments/service.ts";
import { endpoint } from "#lib/server/http.ts";
import { readMultipart } from "#lib/server/uploads.ts";

export const POST = endpoint(
	{
		params: issueParams,
		response: { 201: z.array(attachmentSchema), 400: errorSchema },
	},
	async ({ actor, params, event }) => {
		await prepareAttachmentUpload(actor, params.key);
		const upload = await readMultipart(event.request, attachmentUploadLimits());
		return {
			status: 201,
			body: await saveAttachmentUpload(actor, params.key, upload),
		};
	},
);
