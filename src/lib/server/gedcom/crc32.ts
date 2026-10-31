/**
 * CRC-32 (IEEE 802.3, the polynomial zip uses), computed a chunk at a time so a stream can be
 * checked without holding it. The zip reader verifies entries with it and the zip writer can reuse
 * it for entries whose stored checksum is missing.
 */

const TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

/**
 * Folds `bytes` into a running CRC. Start from 0 and feed each chunk the previous result; the
 * return value is always the finished, unsigned CRC of everything so far, so no separate
 * finalisation step exists to forget.
 */
export function crc32Update(crc: number, bytes: Uint8Array): number {
	let c = ~crc >>> 0;
	for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
	return ~c >>> 0;
}

/** The CRC-32 of `bytes` as an unsigned 32-bit integer. */
export function crc32(bytes: Uint8Array): number {
	return crc32Update(0, bytes);
}
