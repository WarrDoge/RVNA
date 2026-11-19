import { acceptGitlabWebhook } from "#lib/server/gitlab/routes.ts";
import { BodyParseError, endpoint, parseBodyText } from "#lib/server/http.ts";

const MAX_WEBHOOK_BYTES = 5 * 1024 * 1024;

class WebhookBodyError extends Error {
	readonly status: number;
	readonly body: unknown;

	constructor(status: number, body: unknown) {
		super("Webhook body error");
		this.status = status;
		this.body = body;
	}
}

function tooLarge() {
	return new WebhookBodyError(413, {
		statusCode: 413,
		code: "FST_ERR_CTP_BODY_TOO_LARGE",
		error: "Payload Too Large",
		message: "Request body is too large",
	});
}

async function readPayload(request: Request): Promise<unknown> {
	const length = request.headers.get("content-length");
	if (length !== null && Number(length) > MAX_WEBHOOK_BYTES) {
		throw tooLarge();
	}
	const chunks: Uint8Array[] = [];
	let total = 0;
	if (request.body) {
		const reader = request.body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_WEBHOOK_BYTES) {
				await reader.cancel();
				throw tooLarge();
			}
			chunks.push(value);
		}
	}
	try {
		return parseBodyText(
			new TextDecoder().decode(Buffer.concat(chunks)),
			request.headers.get("content-type"),
		);
	} catch (error) {
		if (error instanceof BodyParseError) {
			throw new WebhookBodyError(error.status, error.body);
		}
		throw error;
	}
}

export const POST = endpoint(
	{ auth: "none", rawBody: true },
	async ({ event }) => {
		let payload: unknown;
		try {
			payload = await readPayload(event.request);
		} catch (error) {
			if (error instanceof WebhookBodyError) {
				return { status: error.status, body: error.body };
			}
			throw error;
		}
		const headers = event.request.headers;
		return acceptGitlabWebhook(null, {
			token: headers.get("x-gitlab-token"),
			event: headers.get("x-gitlab-event") ?? "Unknown Hook",
			providedKey:
				headers.get("idempotency-key") ?? headers.get("x-gitlab-event-uuid"),
			payload,
		});
	},
);
