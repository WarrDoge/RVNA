import { z } from "zod";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { attachmentUploadLimits } from "#lib/server/attachments/service.ts";
import { endpoint } from "#lib/server/http.ts";
import { readMultipart } from "#lib/server/uploads.ts";
import { attachmentSchema, pageParams } from "#lib/server/wiki/schemas.ts";
import {
	listPageAttachments,
	pageForUpload,
	uploadPageAttachments,
} from "#lib/server/wiki/service.ts";

const uploadedSchema = z.array(attachmentSchema.extend({ url: z.string() }));

export const GET = endpoint(
	{ params: pageParams, response: z.array(attachmentSchema) },
	async ({ actor, params }) => listPageAttachments(actor, params.id),
);

export const POST = endpoint(
	{ params: pageParams, response: { 201: uploadedSchema, 400: errorSchema } },
	async ({ actor, params, event }) => {
		// Permission first: nothing is read from a request that may not upload.
		await pageForUpload(actor, params.id);
		const upload = await readMultipart(event.request, attachmentUploadLimits());
		return {
			status: 201,
			body: await uploadPageAttachments(actor, params.id, upload),
		};
	},
);
