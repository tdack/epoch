/**
 * The kept 5.5.1 lines `toGedcom7Lines` rewrites into valid 7.0, one describe per rule, and the
 * way back for `toGedcom551Lines` where the rule has one.
 */

import { describe, expect, it } from 'vitest';
import { toGedcom551Lines, toGedcom7Lines } from './dialect';
import { enumValues } from './spec/lookup';
import { EXTENSION_TAG_URIS } from './tags';

describe('ASSO.RELA and ROLE', () => {
	const asso = (...children: string[]) => ['0 @I1@ INDI', '1 ASSO @I2@', ...children];

	it.each([
		['father', 'FATH'],
		['Mother', 'MOTH'],
		['godparent', 'GODP'],
		['Godfather', 'GODP'],
		['godmother', 'GODP'],
		['witness', 'WITN'],
		['priest', 'CLERGY'],
		['minister', 'CLERGY'],
		['friend', 'FRIEND'],
		['neighbour', 'NGHBR'],
		['neighbor', 'NGHBR'],
		['officiant', 'OFFICIATOR'],
		['parent', 'PARENT'],
		['spouse', 'SPOU'],
		['husband', 'HUSB'],
		['wife', 'WIFE'],
		['son', 'CHIL'],
		['daughter', 'CHIL'],
		['child', 'CHIL'],
		['multiple', 'MULTIPLE'],
		['WITN', 'WITN']
	])('writes RELA %s as ROLE %s', (word, role) => {
		expect(toGedcom7Lines(asso(`2 RELA ${word}`))[2]).toBe(`2 ROLE ${role}`);
	});

	it("keeps a word that is not the value's own as the PHRASE, and no more", () => {
		expect(toGedcom7Lines(asso('2 RELA father'))).toEqual(asso('2 ROLE FATH'));
		expect(toGedcom7Lines(asso('2 RELA Godfather'))).toEqual(
			asso('2 ROLE GODP', '3 PHRASE Godfather')
		);
	});

	it('writes a role 7.0 has no word for as OTHER with the word as the PHRASE', () => {
		expect(toGedcom7Lines(asso('2 RELA nanny'))).toEqual(asso('2 ROLE OTHER', '3 PHRASE nanny'));
	});

	it('only ever writes a value the spec lists', () => {
		const roles = enumValues('https://gedcom.io/terms/v7/enumset-ROLE') ?? [];
		for (const word of ['nurse', 'nanny', 'cousin', 'OTHER', 'constructor']) {
			const value = toGedcom7Lines(asso(`2 RELA ${word}`))[2].replace('2 ROLE ', '');
			expect(roles).toContain(value);
		}
	});

	it('leaves a 7.0 ROLE alone, and puts RELA back for 5.5.1', () => {
		const sevenLines = asso('2 ROLE FATH');
		expect(toGedcom7Lines(sevenLines)).toEqual(sevenLines);
		expect(toGedcom551Lines(sevenLines)).toEqual(asso('2 RELA father'));
		expect(toGedcom551Lines(asso('2 ROLE OTHER', '3 PHRASE nanny'))).toEqual(asso('2 RELA nanny'));
		expect(toGedcom551Lines(asso('2 ROLE GODP', '3 PHRASE Godfather'))).toEqual(
			asso('2 RELA Godfather')
		);
	});

	it('trips 5.5.1 to 7.0 and back to the same word', () => {
		for (const word of ['Godfather', 'father', 'nanny']) {
			expect(toGedcom551Lines(toGedcom7Lines(asso(`2 RELA ${word}`)))).toEqual(
				asso(`2 RELA ${word}`)
			);
		}
	});
});

describe('tags 7.0 has no place for', () => {
	it('writes URL as WWW where WWW is allowed', () => {
		expect(toGedcom7Lines(['0 @R1@ REPO', '1 NAME Archive', '1 URL https://a.example'])).toEqual([
			'0 @R1@ REPO',
			'1 NAME Archive',
			'1 WWW https://a.example'
		]);
	});

	it('writes URL as _URL where WWW is not allowed', () => {
		expect(toGedcom7Lines(['0 @I1@ INDI', '1 NAME A /B/', '2 URL https://a.example'])).toEqual([
			'0 @I1@ INDI',
			'1 NAME A /B/',
			'2 _URL https://a.example'
		]);
	});

	it('prefixes any other unknown tag, at any level, and leaves what is inside it alone', () => {
		expect(
			toGedcom7Lines(['0 @I1@ INDI', '1 CEME', '2 PLAC Hill', '2 URL x', '0 SUBN', '1 FOO bar'])
		).toEqual(['0 @I1@ INDI', '1 _CEME', '2 PLAC Hill', '2 URL x', '0 _SUBN', '1 FOO bar']);
	});

	it('leaves tags the spec has in that context, extensions and damaged lines', () => {
		const lines = [
			'0 @I1@ INDI',
			'1 NAME A /B/',
			'2 NOTE x',
			'2 _OWN y',
			'1 BIRT',
			'2 DATE 1900',
			'1 @bad tag@ x'
		];
		expect(toGedcom7Lines(lines)).toEqual(lines);
	});

	it('keeps an embedded OBJE, where 7.0 allows only a pointer, whole as an extension', () => {
		expect(
			toGedcom7Lines(['0 @I1@ INDI', '1 OBJE', '2 FILE a.png', '3 FORM png', '1 OBJE @M1@'])
		).toEqual(['0 @I1@ INDI', '1 _OBJE', '2 FILE a.png', '3 FORM image/png', '1 OBJE @M1@']);
	});
});

describe('FILE and FORM', () => {
	const file = (...children: string[]) => ['0 @M1@ OBJE', ...children];

	it.each([
		['a.JPG', 'image/jpeg'],
		['a.jpeg', 'image/jpeg'],
		['a.png', 'image/png'],
		['a.gif', 'image/gif'],
		['a.tif', 'image/tiff'],
		['a.tiff', 'image/tiff'],
		['a.pdf', 'application/pdf'],
		['a.mp3', 'audio/mpeg'],
		['a.ogg', 'audio/ogg'],
		['a.oga', 'audio/ogg'],
		['a.mp4', 'video/mp4'],
		['a.vtt', 'text/vtt'],
		['a.txt', 'text/plain'],
		['a.html', 'text/html'],
		['https://x.example/a.png?size=2', 'image/png'],
		['a.unknown', 'application/octet-stream'],
		['archive', 'application/octet-stream'],
		['dir.v2/archive', 'application/octet-stream']
	])('infers the media type of %s as %s, for an empty FORM', (path, type) => {
		expect(toGedcom7Lines(file(`1 FILE ${path}`, '2 FORM'))).toEqual(
			file(`1 FILE ${path}`, `2 FORM ${type}`)
		);
	});

	it('writes a FORM for a FILE that has none, before the rest of its lines', () => {
		expect(toGedcom7Lines(file('1 FILE a.png', '2 TITL Face'))).toEqual(
			file('1 FILE a.png', '2 FORM image/png', '2 TITL Face')
		);
	});

	it('leaves a media type that is already there', () => {
		const lines = file('1 FILE a.png', '2 FORM image/webp');
		expect(toGedcom7Lines(lines)).toEqual(lines);
	});

	it('does not add a FORM to the FILE of a header', () => {
		expect(toGedcom7Lines(['0 HEAD', '1 FILE out.ged'])).toEqual(['0 HEAD', '1 _FILE out.ged']);
	});
});

describe('shared notes', () => {
	it('writes a 5.5.1 NOTE record and its pointers as SNOTE', () => {
		expect(
			toGedcom7Lines([
				'0 @N1@ NOTE Shared',
				'1 CONT more',
				'0 @I1@ INDI',
				'1 NOTE @N1@',
				'1 NOTE inline',
				'2 CONT more',
				'1 BIRT',
				'2 NOTE @N1@'
			])
		).toEqual([
			'0 @N1@ SNOTE Shared',
			'1 CONT more',
			'0 @I1@ INDI',
			'1 SNOTE @N1@',
			'1 NOTE inline',
			'2 CONT more',
			'1 BIRT',
			'2 SNOTE @N1@'
		]);
	});

	it('leaves an inline note that starts with an escaped @ and the header note', () => {
		const lines = ['0 HEAD', '1 NOTE header', '0 @I1@ INDI', '1 NOTE @@handle'];
		expect(toGedcom7Lines(lines)).toEqual(lines);
	});
});

describe('inline SOUR', () => {
	it('points at a new SOUR record whose TITL is the text, placed before the trailer', () => {
		const out = toGedcom7Lines([
			'0 @I1@ INDI',
			'1 SOUR Parish book',
			'2 CONT page 2',
			'2 PAGE 5',
			'0 TRLR'
		]);
		const xref = out[1].replace('1 SOUR ', '');
		expect(xref).toMatch(/^@SOUR_[0-9A-F]{8}@$/);
		expect(out).toEqual([
			'0 @I1@ INDI',
			`1 SOUR ${xref}`,
			'2 PAGE 5',
			`0 ${xref} SOUR`,
			'1 TITL Parish book',
			'2 CONT page 2',
			'0 TRLR'
		]);
	});

	it('is deterministic, shares a record between the same words and avoids an xref in use', () => {
		const lines = [
			'0 @I1@ INDI',
			'1 SOUR Same',
			'0 @I2@ INDI',
			'1 SOUR Same',
			'1 SOUR Other',
			'0 TRLR'
		];
		const first = toGedcom7Lines(lines);
		expect(toGedcom7Lines(lines)).toEqual(first);
		expect(first.filter((l) => /^0 @SOUR_\w+@ SOUR$/.test(l))).toHaveLength(2);
		const taken = first[1].replace('1 SOUR ', '');
		const clash = toGedcom7Lines([`0 ${taken} INDI`, ...lines]);
		expect(clash.filter((l) => l.startsWith(`0 ${taken}`))).toHaveLength(1);
	});

	it('leaves a pointer, the header source and a source record alone', () => {
		const lines = [
			'0 HEAD',
			'1 SOUR EPOCH',
			'2 VERS 1.0',
			'0 @S1@ SOUR',
			'1 TITL T',
			'0 @I1@ INDI',
			'1 SOUR @S1@',
			'1 SOUR @VOID@',
			'0 TRLR'
		];
		expect(toGedcom7Lines(lines)).toEqual(lines);
	});
});

describe('SOUR under FAMC', () => {
	it('is written as the extension _SOUR, which is left alone', () => {
		expect(
			toGedcom7Lines(['0 @I1@ INDI', '1 FAMC @F1@', '2 SOUR @S1@', '3 PAGE 4', '2 PEDI birth'])
		).toEqual(['0 @I1@ INDI', '1 FAMC @F1@', '2 _SOUR @S1@', '3 PAGE 4', '2 PEDI BIRTH']);
	});

	it('is documented in SCHMA by Epoch', () => {
		expect(EXTENSION_TAG_URIS['_SOUR']).toContain('gedcom-extensions.md#_sour');
	});
});

describe('FONE and ROMN', () => {
	const name = (...children: string[]) => ['0 @I1@ INDI', '1 NAME 王 /李/', ...children];
	const place = (...children: string[]) => ['0 @I1@ INDI', '1 BIRT', '2 PLAC Tokyo', ...children];

	it.each([
		['pinyin', 'zh-Latn-pinyin'],
		['romanji', 'ja-Latn'],
		['romaji', 'ja-Latn'],
		['wadegiles', 'zh-Latn-wadegile'],
		['PINYIN', 'zh-Latn-pinyin']
	])('writes a name ROMN of type %s as TRAN with LANG %s', (type, language) => {
		expect(
			toGedcom7Lines(name('2 ROMN Wang /Li/', `3 TYPE ${type}`, '3 GIVN Wang')).slice(2)
		).toEqual(['2 TRAN Wang /Li/', `3 LANG ${language}`, '3 GIVN Wang']);
	});

	it('writes a ROMN with no TYPE as und-Latn, under a name and a place', () => {
		expect(toGedcom7Lines(name('2 ROMN Wang /Li/')).slice(2)).toEqual([
			'2 TRAN Wang /Li/',
			'3 LANG und-Latn'
		]);
		expect(toGedcom7Lines(place('3 ROMN Toukyou')).slice(3)).toEqual([
			'3 TRAN Toukyou',
			'4 LANG und-Latn'
		]);
	});

	it.each([
		['hangul', 'ko-Hang'],
		['kana', 'ja-Kana']
	])('writes a FONE of type %s as TRAN with LANG %s', (type, language) => {
		expect(toGedcom7Lines(place('3 FONE Tokyo', `4 TYPE ${type}`)).slice(3)).toEqual([
			'3 TRAN Tokyo',
			`4 LANG ${language}`
		]);
		expect(toGedcom7Lines(name('2 FONE x', `3 TYPE ${type}`)).slice(2)).toEqual([
			'2 TRAN x',
			`3 LANG ${language}`
		]);
	});

	it('keeps a FONE with no language to stand for it as _FONE, and an unknown ROMN type as _ROMN', () => {
		expect(toGedcom7Lines(name('2 FONE x')).slice(2)).toEqual(['2 _FONE x']);
		expect(toGedcom7Lines(name('2 FONE x', '3 TYPE other')).slice(2)).toEqual([
			'2 _FONE x',
			'3 TYPE other'
		]);
		expect(toGedcom7Lines(name('2 ROMN x', '3 TYPE iso')).slice(2)).toEqual([
			'2 _ROMN x',
			'3 TYPE iso'
		]);
	});

	it('puts FONE and ROMN back for 5.5.1', () => {
		expect(
			toGedcom551Lines(name('2 TRAN Wang /Li/', '3 LANG zh-Latn-pinyin', '3 GIVN Wang')).slice(2)
		).toEqual(['2 ROMN Wang /Li/', '3 TYPE pinyin', '3 GIVN Wang']);
		expect(toGedcom551Lines(name('2 TRAN x', '3 LANG und-Latn')).slice(2)).toEqual(['2 ROMN x']);
		expect(toGedcom551Lines(place('3 TRAN Tokyo', '4 LANG ko-Hang')).slice(3)).toEqual([
			'3 FONE Tokyo',
			'4 TYPE hangul'
		]);
		expect(toGedcom551Lines(name('2 _FONE x', '3 TYPE other')).slice(2)).toEqual([
			'2 FONE x',
			'3 TYPE other'
		]);
		expect(toGedcom551Lines(name('2 _ROMN x', '3 TYPE iso')).slice(2)).toEqual([
			'2 ROMN x',
			'3 TYPE iso'
		]);
	});

	it('leaves a TRAN in a language 5.5.1 has no type for, and a TRAN under a note', () => {
		const lines = name('2 TRAN x', '3 LANG de');
		expect(toGedcom551Lines(lines)).toEqual(lines);
		const note = ['0 @N1@ SNOTE a', '1 TRAN b', '2 LANG und-Latn'];
		expect(toGedcom551Lines(note)).toEqual(note);
	});

	it('trips 5.5.1 to 7.0 and back', () => {
		for (const lines of [
			name('2 ROMN Wang', '3 TYPE pinyin'),
			name('2 ROMN Wang'),
			name('2 FONE x', '3 TYPE hangul'),
			place('3 FONE x', '4 TYPE kana'),
			name('2 FONE x'),
			name('2 ROMN x', '3 TYPE iso')
		]) {
			expect(toGedcom551Lines(toGedcom7Lines(lines))).toEqual(lines);
		}
	});
});

describe('FILE paths of a media record', () => {
	const file = (path: string) => ['0 @M1@ OBJE', `1 FILE ${path}`, '2 FORM image/jpeg'];
	const filePayload = (lines: string[]) => lines[1].slice('1 FILE '.length);

	it.each([
		['C:\\Photos\\a b.jpg', 'file:///C:/Photos/a%20b.jpg'],
		['c:/Photos/a.jpg', 'file:///c:/Photos/a.jpg'],
		['\\\\server\\share\\a.jpg', 'file://server/share/a.jpg'],
		['photos\\2020\\a.jpg', 'photos/2020/a.jpg'],
		['a b.jpg', 'a%20b.jpg'],
		['100%.jpg', '100%25.jpg'],
		['Brontë.jpg', 'Bront%C3%AB.jpg']
	])('writes the 5.5.1 path %s as the reference %s in 7.0', (path, written) => {
		expect(filePayload(toGedcom7Lines(file(path)))).toBe(written);
	});

	it.each([
		'media/a%20b.jpg',
		'file:///C:/a.jpg',
		'https://x.org/Brontë.jpg?s=1#f',
		'https%3a//not.a.url/x'
	])('leaves %s alone in 7.0', (path) => {
		expect(filePayload(toGedcom7Lines(file(path)))).toBe(path);
	});

	it('percent-decodes only a relative reference for 5.5.1', () => {
		expect(filePayload(toGedcom551Lines(file('media/Bront%C3%AB%20x.jpg')))).toBe(
			'media/Brontë x.jpg'
		);
		for (const path of ['file:///C:/a%20b.jpg', 'C:\\a%20b.jpg', 'https://x.org/a%20b.jpg'])
			expect(filePayload(toGedcom551Lines(file(path)))).toBe(path);
	});
});
