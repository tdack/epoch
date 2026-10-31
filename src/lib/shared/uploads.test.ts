import { describe, expect, it } from 'vitest';
import { MAX_DATASET_BYTES } from '../server/gedcom/limits';
import { MAX_TREE_MEDIA_BYTES } from './media';
import {
	GEDZIP_DATASET_BYTES,
	MAX_GEDZIP_UPLOAD_BYTES,
	UPLOAD_PART_BYTES,
	expectedPartBytes,
	uploadPartCount
} from './uploads';

describe('upload constants', () => {
	it('keeps the dataset size in step with the server limit', () => {
		expect(GEDZIP_DATASET_BYTES).toBe(MAX_DATASET_BYTES);
		expect(MAX_GEDZIP_UPLOAD_BYTES).toBe(MAX_TREE_MEDIA_BYTES + MAX_DATASET_BYTES);
	});
});

describe('part arithmetic', () => {
	it('sizes every part but the last in full', () => {
		const total = UPLOAD_PART_BYTES * 2 + 10;
		expect(uploadPartCount(total)).toBe(3);
		expect(expectedPartBytes(1, total)).toBe(UPLOAD_PART_BYTES);
		expect(expectedPartBytes(2, total)).toBe(UPLOAD_PART_BYTES);
		expect(expectedPartBytes(3, total)).toBe(10);
	});

	it('makes an exact multiple end on a full part', () => {
		expect(uploadPartCount(UPLOAD_PART_BYTES)).toBe(1);
		expect(expectedPartBytes(1, UPLOAD_PART_BYTES)).toBe(UPLOAD_PART_BYTES);
	});
});
