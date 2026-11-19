import type { UserWithEmail } from "#lib/api-types.ts";
import { fetchUsers } from "./api.ts";

/** One debounced, cancellable user type-ahead shared by the pickers. */
export class UserSearch {
	users = $state<UserWithEmail[]>([]);
	pending = $state(false);
	failed = $state(false);
	#timer: ReturnType<typeof setTimeout> | undefined;
	#controller: AbortController | undefined;
	#version = 0;

	search(query: string, immediate = false) {
		clearTimeout(this.#timer);
		if (immediate) {
			void this.#run(query);
			return;
		}
		this.#timer = setTimeout(() => void this.#run(query), 200);
	}

	async #run(query: string) {
		this.#controller?.abort();
		const controller = new AbortController();
		this.#controller = controller;
		const version = ++this.#version;
		this.pending = true;
		this.failed = false;
		try {
			const list = await fetchUsers(query, controller.signal);
			if (version !== this.#version) return;
			this.users = list;
			this.pending = false;
		} catch {
			if (version !== this.#version || controller.signal.aborted) return;
			this.users = [];
			this.pending = false;
			this.failed = true;
		}
	}

	cancel() {
		clearTimeout(this.#timer);
		this.#controller?.abort();
		this.#controller = undefined;
		this.pending = false;
	}
}
