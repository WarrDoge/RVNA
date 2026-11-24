import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

/** Keep server modules as source imports so Node, Vite and Vitest share one copy. */
const externalServer = {
	name: "external-server",
	enforce: "pre" as const,
	apply: "build" as const,
	resolveId(id: string) {
		if (id.startsWith("#lib/server")) return { id, external: true };
	},
};

export default defineConfig({
	plugins: [
		externalServer,
		sveltekit({
			adapter: adapter(),
			csrf: { trustedOrigins: ["*"] },
			// Stored HTML is sanitized on write; this stops a script that slips through from running.
			// Only the inline start script, which carries the response's nonce, and the modules it loads
			// run (`strict-dynamic`): the app's own address is not a script source, so an uploaded
			// file cannot be a script even if it is served from the same origin.
			// The hash is Svelte's server-rendered `onload`/`onerror` attribute, `this.__e=event`.
			csp: {
				directives: {
					"script-src": [
						"strict-dynamic",
						"unsafe-hashes",
						"sha256-7dQwUgLau1NFCCGjfn9FsYptB6ZtWxJin6VohGIu20I=",
					],
					"object-src": ["none"],
					"base-uri": ["self"],
					"frame-ancestors": ["self"],
				},
			},
		}),
	],
	ssr: {
		external: ["#lib/server"],
		noExternal: ["@atlaskit/pragmatic-drag-and-drop"],
	},
	server: { host: "127.0.0.1", port: 6460, strictPort: true },
});
