import { browser } from "$app/env";

/**
 * True in the browser while the server-rendered document is being hydrated; the root layout
 * marks the document once that is done. A `<select>` binding adopts the option chosen before
 * hydration only when its state starts undefined, so a select starts undefined while this is
 * true and with its loaded value on a later client-side mount.
 */
export function hydratingPage() {
	return browser && document.documentElement.dataset.hydrated === undefined;
}
