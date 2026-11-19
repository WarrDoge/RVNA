/**
 * One API read with the states the form shows. A later run wins over an earlier
 * response, which is what keeps a type-ahead from showing stale users.
 */
export class Loader<T> {
	data = $state<T | null>(null);
	pending = $state(true);
	error = $state<unknown>(null);

	#version = 0;

	async run(load: () => Promise<T>): Promise<T | null> {
		const version = ++this.#version;
		this.data = null;
		this.pending = true;
		this.error = null;
		try {
			const value = await load();
			if (version !== this.#version) return null;
			this.data = value;
			this.pending = false;
			return value;
		} catch (cause) {
			if (version !== this.#version) return null;
			this.error = cause;
			this.pending = false;
			return null;
		}
	}

	reset() {
		this.#version++;
		this.data = null;
		this.pending = true;
		this.error = null;
	}
}
