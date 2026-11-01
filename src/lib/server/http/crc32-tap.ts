import { crc32Update } from '../gedcom/crc32';

/**
 * A pass-through of `body` that checksums the bytes as they go by. Read `crc32()` only after the
 * stream has been fully consumed. It sits before `fixedLengthBody`, not after: R2 needs the final
 * stream to be the length-bearing one, and a transform placed behind it would hide the length.
 */
export function crc32Tap(body: ReadableStream<Uint8Array>): {
	body: ReadableStream<Uint8Array>;
	crc32: () => number;
} {
	let crc = 0;
	return {
		body: body.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					crc = crc32Update(crc, chunk);
					controller.enqueue(chunk);
				}
			})
		),
		crc32: () => crc
	};
}
