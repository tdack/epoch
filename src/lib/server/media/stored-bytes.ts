import type { R2Bucket } from '@cloudflare/workers-types';

/**
 * The bytes stored under a key prefix, summed from R2's own listing. `isCounted` narrows the keys
 * further when a prefix alone could also match something that is not ours.
 *
 * D1 is not the source: `media_items` records no byte size. Adding one would be a new column whose
 * existing rows read as null, undercounting every tree that predates it. R2 also counts objects no
 * row points at, which is what the bill charges for. A listing returns at most 1,000 objects, so a
 * large tree costs one Class A operation per thousand objects.
 */
export async function sumStoredBytes(
	bucket: R2Bucket,
	prefix: string,
	isCounted: (object: { key: string; uploaded?: Date }) => boolean = () => true
): Promise<number> {
	let total = 0;
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, cursor });
		for (const object of page.objects) {
			if (isCounted(object)) total += object.size;
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor !== undefined);
	return total;
}
