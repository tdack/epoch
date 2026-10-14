import type { R2Bucket } from '@cloudflare/workers-types';
import { parseMediaKey } from './media-key';

/**
 * The bytes stored under a key prefix, summed from R2's own listing. `isCounted` narrows the keys
 * further when a prefix alone could also match something that is not ours.
 *
 * D1 is not the source: `media_items.size_bytes` is null on every row written before migration 0029
 * until the backfill runs, so summing it would undercount the trees that predate it. R2 also counts
 * objects no row points at, which is what the bill charges for. A listing returns at most 1,000
 * objects, so a large tree costs one Class A operation per thousand objects.
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

/**
 * The bytes stored under `media/`, in total and per tree, from one pass over R2's listing. Objects
 * whose key names no tree count toward the total only. One pass matters: asking `sumStoredBytes`
 * once per tree would list the whole prefix once for each.
 */
export async function storedBytesByTree(
	bucket: R2Bucket
): Promise<{ total: number; byTree: Map<string, number> }> {
	let total = 0;
	const byTree = new Map<string, number>();
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix: 'media/', cursor });
		for (const object of page.objects) {
			total += object.size;
			const treeId = parseMediaKey(object.key)?.treeId;
			if (treeId !== undefined) byTree.set(treeId, (byTree.get(treeId) ?? 0) + object.size);
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor !== undefined);
	return { total, byTree };
}
