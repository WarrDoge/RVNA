import { randomUUID } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import { HttpError } from "./http.ts";

export type UploadedFile = {
	field: string;
	path: string;
	/** The parsed original name; the caller sanitizes it before storing it. */
	fileName: string;
	mimeType: string;
	size: number;
};

export type UploadedForm = {
	fields: Record<string, string>;
	files: UploadedFile[];
};

export type UploadLimits = {
	/** Directory for the temporary files; the caller moves them on success. */
	directory: string;
	maxFileBytes: number;
	maxFiles: number;
	maxTotalBytes: number;
	fileTooLargeMessage?: string;
	totalTooLargeMessage?: string;
	tooManyFilesMessage?: string;
};

function megabytes(bytes: number) {
	return Math.floor(bytes / (1024 * 1024));
}

function invalidContentType() {
	return new HttpError(406, "the request is not multipart", {
		details: {
			statusCode: 406,
			code: "FST_INVALID_MULTIPART_CONTENT_TYPE",
			error: "Not Acceptable",
			message: "the request is not multipart",
		},
	});
}

function malformedBody() {
	return new HttpError(400, "Malformed multipart body");
}

/** The body of the upload limit error: `error` is the status text. */
export function tooManyParts() {
	return new HttpError(413, "reach parts limit", {
		details: {
			statusCode: 413,
			code: "FST_PARTS_LIMIT",
			error: "Payload Too Large",
			message: "reach parts limit",
		},
	});
}

export function tooManyFiles(message = "reach files limit") {
	return new HttpError(413, message, {
		details: {
			statusCode: 413,
			code: "FST_FILES_LIMIT",
			error: "Payload Too Large",
			message,
		},
	});
}

type ActiveFile = { file: Readable; sink: WriteStream };

/**
 * Parses one multipart/form-data request with busboy, streams every file to a
 * temporary file and enforces the byte and file-count limits while reading.
 * On success the caller owns the temporary files; on every error they are gone.
 */
export async function readMultipart(
	request: Request,
	limits: UploadLimits,
): Promise<UploadedForm> {
	const contentType = request.headers.get("content-type") ?? "";
	if (!/^multipart\/form-data\b/i.test(contentType)) {
		throw invalidContentType();
	}
	if (!request.body) throw malformedBody();

	let parser: ReturnType<typeof Busboy>;
	try {
		parser = Busboy({
			headers: { "content-type": contentType },
			defParamCharset: "utf8",
			preservePath: true,
			limits: {
				// The meter rejects a size over the cap; busboy must not reject the exact cap.
				fileSize: limits.maxFileBytes + 1,
				files: limits.maxFiles,
				fields: 0,
				parts: 1000,
			},
		});
	} catch {
		throw invalidContentType();
	}

	const directory = resolve(limits.directory);
	await mkdir(directory, { recursive: true });

	const fields: Record<string, string> = Object.create(null);
	const files: UploadedFile[] = [];
	const pending: Promise<void>[] = [];
	const active = new Set<ActiveFile>();
	const source = Readable.fromWeb(
		request.body as import("node:stream/web").ReadableStream<Uint8Array>,
	);
	let failure: unknown;
	let total = 0;

	const fileTooLarge = () =>
		new HttpError(
			413,
			limits.fileTooLargeMessage ??
				`File is larger than ${megabytes(limits.maxFileBytes)} MB`,
		);
	const totalTooLarge = () =>
		new HttpError(
			413,
			limits.totalTooLargeMessage ??
				`Upload is larger than ${megabytes(limits.maxTotalBytes)} MB`,
		);

	function fail(error: unknown) {
		if (!failure) failure = error;
		source.destroy();
		parser.destroy();
		for (const current of active) {
			current.file.destroy();
			current.sink.destroy();
		}
	}

	parser.on("field", (name, value) => {
		if (failure) return;
		fields[name] = value;
	});

	parser.on("file", (name, file, info) => {
		if (failure) {
			file.resume();
			return;
		}

		const path = join(directory, `.upload-${randomUUID()}`);
		const entry: UploadedFile = {
			field: name,
			path,
			fileName: info.filename ?? "",
			mimeType: info.mimeType || "application/octet-stream",
			size: 0,
		};
		files.push(entry);
		const sink = createWriteStream(path, { flags: "wx" });
		const current = { file, sink };
		active.add(current);
		let size = 0;

		const meter = new Transform({
			transform(chunk: Buffer, _encoding, callback) {
				size += chunk.length;
				total += chunk.length;
				if (size > limits.maxFileBytes) {
					callback(fileTooLarge());
					return;
				}
				if (total > limits.maxTotalBytes) {
					callback(totalTooLarge());
					return;
				}
				entry.size = size;
				callback(null, chunk);
			},
		});

		file.on("limit", () => fail(fileTooLarge()));
		pending.push(
			pipeline(file, meter, sink)
				.then(() => undefined)
				.catch((error: unknown) => {
					fail(error);
				})
				.finally(() => {
					active.delete(current);
				}),
		);
	});

	parser.on("fieldsLimit", () => fail(tooManyParts()));
	parser.on("filesLimit", () => fail(tooManyFiles(limits.tooManyFilesMessage)));
	parser.on("partsLimit", () => fail(tooManyParts()));
	parser.on("error", () => fail(malformedBody()));

	try {
		await pipeline(source, parser);
		await Promise.all(pending);
	} catch (error) {
		if (!failure) {
			failure = error instanceof HttpError ? error : malformedBody();
		}
		fail(failure);
		// The writers must be gone before the caller unlinks their temp files.
		await Promise.allSettled(pending);
	}

	if (failure) {
		await Promise.all(
			files.map((file) => unlink(file.path).catch(() => undefined)),
		);
		throw failure;
	}

	return { fields, files };
}
