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

function gf2Times(mat: Uint32Array, vec: number): number {
	let sum = 0;
	for (let i = 0; vec !== 0; i++, vec >>>= 1) if (vec & 1) sum ^= mat[i]!;
	return sum >>> 0;
}

function gf2Square(square: Uint32Array, mat: Uint32Array): void {
	for (let n = 0; n < 32; n++) square[n] = gf2Times(mat, mat[n]!);
}

/**
 * The CRC-32 of `A` followed by `B`, from the CRC of each and the length of `B` alone (zlib's
 * `crc32_combine`: appending `lengthB` zero bytes is a linear map over GF(2), applied by repeated
 * squaring). This is what lets parts that arrive out of order each be checksummed as they stream,
 * with no pass over the assembled file.
 */
export function crc32Combine(crcA: number, crcB: number, lengthB: number): number {
	if (lengthB <= 0) return crcA >>> 0;
	let crc = crcA >>> 0;
	const even = new Uint32Array(32);
	const odd = new Uint32Array(32);
	odd[0] = 0xedb88320;
	for (let n = 1, row = 1; n < 32; n++, row <<= 1) odd[n] = row;
	gf2Square(even, odd);
	gf2Square(odd, even);
	// Not `>>=`: a length past 2^31 would go negative.
	let remaining = lengthB;
	do {
		gf2Square(even, odd);
		if (remaining % 2 === 1) crc = gf2Times(even, crc);
		remaining = Math.floor(remaining / 2);
		if (remaining === 0) break;
		gf2Square(odd, even);
		if (remaining % 2 === 1) crc = gf2Times(odd, crc);
		remaining = Math.floor(remaining / 2);
	} while (remaining !== 0);
	return (crc ^ crcB) >>> 0;
}
