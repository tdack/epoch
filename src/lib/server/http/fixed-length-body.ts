import { ValidationError } from '../domain/errors';

/**
 * The request body as a stream whose length R2 knows. `uploadPart` refuses a stream of unknown
 * length, and a request body only counts as known on the Workers runtime when it is sized by a
 * `FixedLengthStream`. Nothing is buffered: bytes pass through, and the runtime fails the write if
 * the body is shorter or longer than `length`.
 *
 * Where `FixedLengthStream` does not exist (Node, under unit tests) a counting stream enforces the
 * same length, so a wrong `Content-Length` is refused the same way in both places.
 */
export function fixedLengthBody(body: ReadableStream<Uint8Array>, length: number) {
	if (typeof FixedLengthStream !== 'undefined') {
		const fixed = new FixedLengthStream(length);
		// The pipe's rejection surfaces through the readable side that R2 is reading.
		void body.pipeTo(fixed.writable).catch(() => undefined);
		return fixed.readable;
	}
	let seen = 0;
	return body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				seen += chunk.byteLength;
				if (seen > length) throw new ValidationError('The part is longer than its Content-Length');
				controller.enqueue(chunk);
			},
			flush() {
				if (seen !== length) throw new ValidationError('The part is shorter than its Content-Length');
			}
		})
	);
}
