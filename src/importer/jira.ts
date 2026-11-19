import {
	GetOnlyClient,
	GetOnlyRequestError,
	type GetOnlyRequestOptions,
} from "./client.ts";

export { GetOnlyRequestError as JiraRequestError };
export type JiraRequestOptions = GetOnlyRequestOptions;

export class JiraClient extends GetOnlyClient {}
