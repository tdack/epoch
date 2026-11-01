import { describe, expect, it } from 'vitest';
import { crc32, crc32Update } from './crc32';

const text = (s: string) => new TextEncoder().encode(s);

describe('crc32', () => {
	it('matches the standard check value', () => {
		expect(crc32(text('123456789'))).toBe(0xcbf43926);
	});

	it('is 0 for empty input', () => {
		expect(crc32(new Uint8Array(0))).toBe(0);
	});

	it('gives the same result when fed in chunks', () => {
		const data = text('The quick brown fox jumps over the lazy dog');
		expect(crc32(data)).toBe(0x414fa339);
		let running = 0;
		for (let i = 0; i < data.length; i += 5)
			running = crc32Update(running, data.subarray(i, i + 5));
		expect(running).toBe(0x414fa339);
	});

	it('is unsigned', () => {
		expect(crc32(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).toBeGreaterThan(0x7fffffff);
	});
});
