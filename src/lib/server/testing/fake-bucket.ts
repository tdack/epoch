export interface FakeObject {
	body: Uint8Array;
	/** What a listing reports; a test sets it directly to fill a quota without allocating bytes. */
	size: number;
	contentType?: string;
	httpEtag?: string;
	uploaded?: Date;
}

/**
 * An in-memory R2 bucket for route and service tests. `list` pages at `pageSize` so a test can
 * prove every page is read. Only the calls the app makes are implemented; the rest would throw
 * rather than pretend to work.
 */
export class FakeMediaBucket {
	readonly objects = new Map<string, FakeObject>();

	constructor(private readonly pageSize = 1000) {}

	async put(
		key: string,
		value: Uint8Array | ArrayBuffer,
		options?: { httpMetadata?: { contentType?: string } }
	) {
		const body = value instanceof Uint8Array ? value : new Uint8Array(value);
		this.objects.set(key, {
			body,
			size: body.byteLength,
			contentType: options?.httpMetadata?.contentType,
			uploaded: new Date()
		});
		return { key, size: body.byteLength };
	}

	async get(key: string) {
		const object = this.objects.get(key);
		if (!object) return null;
		const bytes = object.body;
		return {
			key,
			size: object.size,
			httpEtag: object.httpEtag ?? `"${key.length}-${object.size}"`,
			httpMetadata: { contentType: object.contentType },
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(bytes);
					controller.close();
				}
			})
		};
	}

	async head(key: string) {
		const object = this.objects.get(key);
		if (!object) return null;
		return { key, size: object.size };
	}

	async delete(keys: string | string[]) {
		for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
	}

	async list(options: { prefix?: string; cursor?: string } = {}) {
		const keys = [...this.objects.keys()]
			.filter((key) => key.startsWith(options.prefix ?? ''))
			.sort();
		const start = options.cursor ? Number(options.cursor) : 0;
		const end = start + this.pageSize;
		const isTruncated = end < keys.length;
		return {
			objects: keys.slice(start, end).map((key) => {
				const object = this.objects.get(key)!;
				return { key, size: object.size, uploaded: object.uploaded };
			}),
			truncated: isTruncated,
			...(isTruncated ? { cursor: String(end) } : {})
		};
	}
}
