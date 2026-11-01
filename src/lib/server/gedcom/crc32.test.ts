import { describe, expect, it } from 'vitest';
import { crc32, crc32Combine, crc32Update } from './crc32';

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

describe('crc32Combine', () => {
	const bytesOf = (length: number, seed: number) =>
		Uint8Array.from({ length }, (_, i) => (i * 31 + seed) & 0xff);

	it('equals the CRC of the concatenation, for any split including odd and empty parts', () => {
		for (const [a, b] of [
			[0, 0],
			[0, 7],
			[9, 0],
			[1, 1],
			[13, 255],
			[1024, 4097],
			[70_001, 3]
		] as const) {
			const left = bytesOf(a, 3);
			const right = bytesOf(b, 11);
			const whole = new Uint8Array(a + b);
			whole.set(left);
			whole.set(right, a);
			expect(crc32Combine(crc32(left), crc32(right), b)).toBe(crc32(whole));
		}
	});

	it('folds many parts in order', () => {
		const parts = [5, 64, 1, 300, 17].map((n, i) => bytesOf(n, i));
		let combined = 0;
		for (const part of parts) combined = crc32Combine(combined, crc32(part), part.length);
		const whole = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
		let at = 0;
		for (const part of parts) {
			whole.set(part, at);
			at += part.length;
		}
		expect(combined).toBe(crc32(whole));
	});
});
