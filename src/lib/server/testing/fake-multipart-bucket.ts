import { FakeMediaBucket } from './fake-bucket';

interface FakeUpload {
	key: string;
	parts: Map<number, { etag: string; bytes: Uint8Array }>;
	state: 'open' | 'completed' | 'aborted';
}

async function readAll(body: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array) {
	if (body instanceof Uint8Array) return body;
	if (body instanceof ArrayBuffer) return new Uint8Array(body);
	const chunks: Uint8Array[] = [];
	const reader = body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}
	const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.byteLength;
	}
	return out;
}

/**
 * A fake bucket with the multipart calls the upload service makes. Local R2 does support
 * multipart, but its binding refuses a Node stream of unknown length (there is no
 * `FixedLengthStream` outside workerd), so the service is tested against this and the real
 * lifecycle against local R2 separately.
 */
export class FakeMultipartBucket extends FakeMediaBucket {
	readonly uploads = new Map<string, FakeUpload>();
	private counter = 0;

	async createMultipartUpload(key: string) {
		const uploadId = `upload-${++this.counter}`;
		this.uploads.set(uploadId, { key, parts: new Map(), state: 'open' });
		return this.handle(key, uploadId);
	}

	resumeMultipartUpload(key: string, uploadId: string) {
		return this.handle(key, uploadId);
	}

	private handle(key: string, uploadId: string) {
		const find = () => {
			const upload = this.uploads.get(uploadId);
			if (!upload || upload.key !== key || upload.state !== 'open')
				throw new Error('The specified multipart upload does not exist');
			return upload;
		};
		return {
			key,
			uploadId,
			uploadPart: async (
				partNumber: number,
				body: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array
			) => {
				const upload = find();
				const bytes = await readAll(body);
				const etag = `etag-${partNumber}-${++this.counter}`;
				upload.parts.set(partNumber, { etag, bytes });
				return { partNumber, etag };
			},
			abort: async () => {
				find().state = 'aborted';
			},
			complete: async (parts: Array<{ partNumber: number; etag: string }>) => {
				const upload = find();
				const buffers = parts.map((part) => {
					const stored = upload.parts.get(part.partNumber);
					if (!stored || stored.etag !== part.etag) throw new Error('A part etag does not match');
					return stored.bytes;
				});
				const body = new Uint8Array(buffers.reduce((n, b) => n + b.byteLength, 0));
				let at = 0;
				for (const buffer of buffers) {
					body.set(buffer, at);
					at += buffer.byteLength;
				}
				upload.state = 'completed';
				await this.put(key, body);
				return { key, size: body.byteLength };
			}
		};
	}
}
