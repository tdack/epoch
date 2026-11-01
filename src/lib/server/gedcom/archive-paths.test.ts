import { describe, expect, it } from 'vitest';
import { planArchiveFiles, type ArchiveFile } from './archive-paths';

const file = (id: string, gedcomPath: string | null, extra: Partial<ArchiveFile> = {}) => ({
	id,
	gedcomPath,
	title: 'Portrait',
	mimeType: 'image/jpeg',
	r2ObjectKey: `media/${id}`,
	sizeBytes: 3,
	crc32: null,
	...extra
});

describe('planArchiveFiles', () => {
	it('keeps a valid stored path, percent-encoded in the FILE text', () => {
		const { entries, fileTexts } = planArchiveFiles([file('aaaaaaaa-1', 'photos/a%20b.jpg')]);
		expect(entries[0].name).toBe('photos/a b.jpg');
		expect(fileTexts.get('aaaaaaaa-1')).toBe('photos/a%20b.jpg');
	});

	it('falls back to media/ for none, taken, unsafe and reserved paths', () => {
		const { entries } = planArchiveFiles([
			file('aaaaaaaa-1', 'x/y.jpg'),
			file('bbbbbbbb-2', 'X/Y.jpg'),
			file('cccccccc-3', null),
			file('dddddddd-4', '../evil.jpg'),
			file('eeeeeeee-5', 'gedcom.ged'),
			file('ffffffff-6', 'META-INF/x.jpg'),
			file('gggggggg-7', 'https://e.com/a.jpg'),
			file('hhhhhhhh-8', 'C:\\a.jpg')
		]);
		expect(entries.map((e) => e.name)).toEqual([
			'x/y.jpg',
			'media/portrait-bbbbbbbb.jpg',
			'media/portrait-cccccccc.jpg',
			'media/portrait-dddddddd.jpg',
			'media/portrait-eeeeeeee.jpg',
			'media/portrait-ffffffff.jpg',
			'media/portrait-gggggggg.jpg',
			'media/portrait-hhhhhhhh.jpg'
		]);
	});

	it('makes a colliding fallback unique', () => {
		const { entries } = planArchiveFiles([file('aaaaaaaa-1', null), file('aaaaaaaa-2', null)]);
		expect(entries.map((e) => e.name)).toEqual([
			'media/portrait-aaaaaaaa.jpg',
			'media/portrait-aaaaaaaa-2.jpg'
		]);
	});
});
