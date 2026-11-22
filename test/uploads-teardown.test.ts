import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const sinks: Writable[] = [];

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		createWriteStream: () => {
			const sink = new Writable({
				write(_chunk, _encoding, callback) {
					setTimeout(callback, 30);
				},
				destroy(_error, callback) {
					setTimeout(callback, 80);
				},
			});
			sinks.push(sink);
			return sink;
		},
	};
});

let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "rvna-teardown-"));
	sinks.length = 0;
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

test("a parser failure stops the file writers before the request is answered", async () => {
	const boundary = `----rvna${randomUUID()}`;
	const payload = Buffer.concat([
		Buffer.from(
			`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\n`,
		),
		Buffer.alloc(64 * 1024, 1),
	]);
	const request = new Request("http://127.0.0.1:3000/upload", {
		method: "POST",
		headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
		body: payload,
	});
	const { readMultipart } = await import("../src/lib/server/uploads.ts");
	await expect(
		readMultipart(request, {
			directory,
			maxFileBytes: 1024 * 1024,
			maxFiles: 2,
			maxTotalBytes: 1024 * 1024,
		}),
	).rejects.toMatchObject({ status: 400 });
	expect(sinks).toHaveLength(1);
	expect(sinks[0]?.destroyed).toBe(true);
	expect(sinks[0]?.closed).toBe(true);
});
