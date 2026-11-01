import { describe, expect, it } from 'vitest';
import { fixedLengthBody } from './fixed-length-body';

function bodyOf(bytes: number): ReadableStream<Uint8Array> {
	return new Response(new Uint8Array(bytes)).body!;
}

describe('fixedLengthBody', () => {
	it('passes a body of exactly the length', async () => {
		const out = await new Response(fixedLengthBody(bodyOf(12), 12)).arrayBuffer();
		expect(out.byteLength).toBe(12);
	});

	it('fails a body longer than the length', async () => {
		await expect(new Response(fixedLengthBody(bodyOf(13), 12)).arrayBuffer()).rejects.toThrow(
			/longer/
		);
	});

	it('fails a body shorter than the length', async () => {
		await expect(new Response(fixedLengthBody(bodyOf(11), 12)).arrayBuffer()).rejects.toThrow(
			/shorter/
		);
	});
});
