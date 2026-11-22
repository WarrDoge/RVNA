import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
	attachmentUploadLimits,
	safeFileName,
} from "../src/lib/server/attachments/service.ts";
import { env } from "../src/lib/server/env.ts";
import { readMultipart, type UploadLimits } from "../src/lib/server/uploads.ts";

let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "rvna-upload-"));
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

function multipart(files: { name: string; bytes: Buffer }[]) {
	const boundary = `----rvna${randomUUID()}`;
	const chunks: Buffer[] = [];
	for (const file of files) {
		chunks.push(
			Buffer.from(
				`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
			),
			file.bytes,
			Buffer.from("\r\n"),
		);
	}
	chunks.push(Buffer.from(`--${boundary}--\r\n`));
	return {
		body: Buffer.concat(chunks),
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
}

function request(files: { name: string; bytes: Buffer }[]) {
	const payload = multipart(files);
	return new Request("http://127.0.0.1:3000/upload", {
		method: "POST",
		headers: { "content-type": payload.contentType },
		body: payload.body,
	});
}

function limits(overrides: Partial<UploadLimits> = {}): UploadLimits {
	return {
		directory,
		maxFileBytes: 1024,
		maxFiles: 20,
		maxTotalBytes: 1024 * 1024,
		...overrides,
	};
}

test("more than the file cap is a 413 and removes every temp file", async () => {
	const response = readMultipart(
		request([
			{ name: "a.txt", bytes: Buffer.from("a") },
			{ name: "b.txt", bytes: Buffer.from("b") },
			{ name: "c.txt", bytes: Buffer.from("c") },
		]),
		limits({ maxFiles: 2, tooManyFilesMessage: "reach files limit" }),
	);
	await expect(response).rejects.toMatchObject({
		status: 413,
		message: "reach files limit",
		details: {
			statusCode: 413,
			code: "FST_FILES_LIMIT",
			error: "Payload Too Large",
			message: "reach files limit",
		},
	});
	expect(await readdir(directory)).toEqual([]);
});

test("the default size text never says 0 MB for a sub-megabyte limit", async () => {
	await expect(
		readMultipart(
			request([{ name: "big.bin", bytes: Buffer.alloc(600 * 1024, 1) }]),
			limits({ maxFileBytes: 512 * 1024, maxTotalBytes: 2 * 1024 * 1024 }),
		),
	).rejects.toMatchObject({
		status: 413,
		message: "File is larger than 1 MB",
	});
	expect(await readdir(directory)).toEqual([]);
});

test("a file over the per-file limit is cut short and removes temp files", async () => {
	let cancelled = false;
	const payload = multipart([
		{ name: "big.bin", bytes: Buffer.alloc(4096, 1) },
	]);
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array(payload.body));
		},
		cancel() {
			cancelled = true;
		},
	});
	const streamed = new Request("http://127.0.0.1:3000/upload", {
		method: "POST",
		headers: { "content-type": payload.contentType },
		body: stream,
		duplex: "half",
	} as RequestInit);

	await expect(
		readMultipart(
			streamed,
			limits({
				maxFileBytes: 16,
				fileTooLargeMessage: "Attachment is larger than 1 MB",
			}),
		),
	).rejects.toMatchObject({
		status: 413,
		message: "Attachment is larger than 1 MB",
	});
	expect(cancelled).toBe(true);
	expect(await readdir(directory)).toEqual([]);
});

test("a file of exactly the per-file limit is accepted", async () => {
	const form = await readMultipart(
		request([{ name: "exact.bin", bytes: Buffer.alloc(16, 1) }]),
		limits({ maxFileBytes: 16 }),
	);
	expect(form.files[0]?.size).toBe(16);
	await Promise.all(
		form.files.map((file) => unlink(file.path).catch(() => undefined)),
	);
});

test("a form field is rejected before its value is buffered", async () => {
	const boundary = `----rvna${randomUUID()}`;
	const chunks = [
		Buffer.from(
			`--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\n`,
		),
		Buffer.alloc(2 * 1024 * 1024, 1),
		Buffer.from(`\r\n--${boundary}--\r\n`),
	];
	const response = new Request("http://127.0.0.1:3000/upload", {
		method: "POST",
		headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
		body: Buffer.concat(chunks),
	});
	await expect(readMultipart(response, limits())).rejects.toMatchObject({
		status: 413,
		message: "reach parts limit",
	});
	expect(await readdir(directory)).toEqual([]);
});

test("the total limit is enforced across files and removes temp files", async () => {
	await expect(
		readMultipart(
			request([
				{ name: "a.txt", bytes: Buffer.alloc(60, 1) },
				{ name: "b.txt", bytes: Buffer.alloc(60, 2) },
			]),
			limits({
				maxFileBytes: 1000,
				maxTotalBytes: 100,
				totalTooLargeMessage: "Upload is larger than 1 MB",
			}),
		),
	).rejects.toMatchObject({
		status: 413,
		message: "Upload is larger than 1 MB",
	});
	expect(await readdir(directory)).toEqual([]);
});

test("a malformed body is a 400 and removes temp files", async () => {
	const payload = multipart([{ name: "a.txt", bytes: Buffer.from("abc") }]);
	const cut = payload.body.subarray(0, payload.body.length - 20);
	const response = new Request("http://127.0.0.1:3000/upload", {
		method: "POST",
		headers: { "content-type": payload.contentType },
		body: cut,
	});
	await expect(readMultipart(response, limits())).rejects.toMatchObject({
		status: 400,
		message: "Malformed multipart body",
	});
	expect(await readdir(directory)).toEqual([]);
});

test("a non-multipart content type is the old 406", async () => {
	const response = new Request("http://127.0.0.1:3000/upload", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
	await expect(readMultipart(response, limits())).rejects.toMatchObject({
		status: 406,
		message: "the request is not multipart",
		details: {
			statusCode: 406,
			code: "FST_INVALID_MULTIPART_CONTENT_TYPE",
			error: "Not Acceptable",
			message: "the request is not multipart",
		},
	});
});

test("more than 1000 parts is a 413 with the old body", async () => {
	const boundary = `----rvna${randomUUID()}`;
	const chunks: Buffer[] = [];
	for (let index = 0; index < 1001; index += 1) {
		chunks.push(
			Buffer.from(
				`--${boundary}\r\nContent-Disposition: form-data; name="field${index}"\r\n\r\nvalue\r\n`,
			),
		);
	}
	chunks.push(Buffer.from(`--${boundary}--\r\n`));
	const request = new Request("http://127.0.0.1:3000/upload", {
		method: "POST",
		headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
		body: Buffer.concat(chunks),
	});
	await expect(readMultipart(request, limits())).rejects.toMatchObject({
		status: 413,
		message: "reach parts limit",
		details: {
			statusCode: 413,
			code: "FST_PARTS_LIMIT",
			error: "Payload Too Large",
			message: "reach parts limit",
		},
	});
	expect(await readdir(directory)).toEqual([]);
});

test("path separators are removed from filenames and non-ASCII names survive", async () => {
	const form = await readMultipart(
		request([
			{ name: "nested/evil.txt", bytes: Buffer.from("a") },
			{ name: "..\\evil.txt", bytes: Buffer.from("b") },
			{ name: "résumé-测试.txt", bytes: Buffer.from("c") },
		]),
		limits(),
	);
	expect(form.files.map((file) => file.fileName)).toEqual([
		"nested/evil.txt",
		"..\\evil.txt",
		"résumé-测试.txt",
	]);
	expect(form.files.map((file) => safeFileName(file.fileName))).toEqual([
		"evil.txt",
		"evil.txt",
		"résumé-测试.txt",
	]);
	await Promise.all(
		form.files.map((file) => unlink(file.path).catch(() => undefined)),
	);
});

test("the attachment limits keep the current size texts", () => {
	const current = attachmentUploadLimits();
	expect(current.fileTooLargeMessage).toBe(
		`Attachment is larger than ${env.MAX_ATTACHMENT_MB} MB`,
	);
	expect(current.totalTooLargeMessage).toBe(
		`Upload is larger than ${env.MAX_UPLOAD_REQUEST_MB} MB`,
	);
	expect(current.tooManyFilesMessage).toBe("reach files limit");
});
