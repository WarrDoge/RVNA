import { getContext, setContext } from "svelte";

const key = Symbol("shell");

export type ShellContext = {
	setAvatarUrl(url: string): void;
};

export function setShellContext(context: ShellContext) {
	setContext(key, context);
}

export function getShellContext(): ShellContext | undefined {
	return getContext<ShellContext | undefined>(key);
}
