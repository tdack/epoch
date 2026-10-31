import { describe, expect, it } from 'vitest';
import { buildGedcom551String, buildGedcom7String, type GedcomExportPayload } from './serializer';
import { validateGedcom7 } from './validate7';

/** Two people in a family, as a tree made in Epoch holds them: every id a UUID. */
function payload(extra: Partial<GedcomExportPayload> = {}): GedcomExportPayload {
	return {
		treeName: 'Xrefs',
		individuals: [
			{
				id: '52d1e0bc-aaaa-4bbb-8ccc-000000000001',
				givenName: 'Ann',
				surname: 'Able',
				sex: 'F',
				fams: ['0b1c-family-1']
			},
			{
				id: '52d1e0bc-aaaa-4bbb-8ccc-000000000002',
				givenName: 'Bo',
				surname: 'Able',
				sex: 'M',
				famc: ['0b1c-family-1']
			}
		],
		families: [
			{
				id: '0b1c-family-1',
				husbandId: null,
				wifeId: '52d1e0bc-aaaa-4bbb-8ccc-000000000001',
				children: [{ childId: '52d1e0bc-aaaa-4bbb-8ccc-000000000002', pedigree: 'birth' }]
			}
		],
		...extra
	};
}

const lines = (text: string) => text.split('\r\n');

describe('xrefs are written as short 7.0-legal ids', () => {
	it('numbers each record kind and rewrites every pointer through the same map', () => {
		const text = buildGedcom7String(
			payload({
				sources: [{ xref: '@src-uuid@', title: 'A book', repositories: [] }],
				notes: [{ xref: '@note-uuid@', tag: 'SNOTE', text: 'Shared' }]
			})
		);
		const out = lines(text);
		expect(out).toContain('0 @I1@ INDI');
		expect(out).toContain('0 @I2@ INDI');
		expect(out).toContain('0 @F1@ FAM');
		expect(out).toContain('0 @S1@ SOUR');
		expect(out).toContain('0 @N1@ SNOTE Shared');
		expect(out).toContain('1 WIFE @I1@');
		expect(out).toContain('1 CHIL @I2@');
		expect(out).toContain('1 FAMS @F1@');
		expect(out).toContain('1 FAMC @F1@');
		expect(validateGedcom7(text).errors).toEqual([]);
	});

	it('keeps an xref that is already legal and numbers around it', () => {
		const text = buildGedcom7String(
			payload({
				individuals: [
					{ id: '@I500@', givenName: 'Ann', surname: 'Able', sex: 'F' },
					{ id: 'a-uuid', givenName: 'Bo', surname: 'Able', sex: 'M' },
					{ id: '@I1@', givenName: 'Cy', surname: 'Able', sex: 'M' }
				],
				families: []
			})
		);
		const out = lines(text).filter((l) => l.endsWith(' INDI'));
		// `@I1@` is held by Cy, so the UUID takes the next free number.
		expect(out).toEqual(['0 @I500@ INDI', '0 @I2@ INDI', '0 @I1@ INDI']);
	});

	it('exports the same ids every time', () => {
		expect(buildGedcom7String(payload())).toBe(buildGedcom7String(payload()));
	});

	it('uses the same ids in 5.5.1', () => {
		const out = lines(buildGedcom551String(payload()));
		expect(out).toContain('0 @I1@ INDI');
		expect(out).toContain('0 @F1@ FAM');
		expect(out).toContain('1 CHIL @I2@');
	});

	it('rewrites a pointer inside a retained line and the family a name note names', () => {
		const data = payload({
			preserved: [
				{
					xref: '@52d1e0bc-aaaa-4bbb-8ccc-000000000001@',
					lines: ['1 ASSO @52d1e0bc-aaaa-4bbb-8ccc-000000000002@', '2 ROLE GODP']
				}
			]
		});
		data.individuals[0].names = [
			{
				type: 'married',
				givenName: 'Ann',
				surname: 'Baker',
				dateText: '1990',
				unionXref: '0b1c-family-1'
			}
		];
		const out = lines(buildGedcom7String(data));
		expect(out).toContain('1 ASSO @I2@');
		expect(out).toContain('2 NOTE Name in use from 1990, through family @F1@.');
	});
});

describe('a pointer at a record the export lacks', () => {
	const withDangling = () =>
		payload({
			preserved: [
				{ xref: '@52d1e0bc-aaaa-4bbb-8ccc-000000000001@', lines: ['1 ASSO @GONE@', '2 ROLE GODP'] },
				{ xref: '@52d1e0bc-aaaa-4bbb-8ccc-000000000001@', lines: ['1 _LINK @GONE@'] }
			]
		});

	it('is @VOID@ in 7.0, except behind an extension tag, which is left as it was', () => {
		const out = lines(buildGedcom7String(withDangling()));
		expect(out).toContain('1 ASSO @VOID@');
		expect(out).toContain('1 _LINK @GONE@');
	});

	it('is left as it was in 5.5.1, which has no @VOID@', () => {
		expect(lines(buildGedcom551String(withDangling()))).toContain('1 ASSO @GONE@');
	});

	it('leaves @VOID@ itself alone', () => {
		const text = buildGedcom7String(
			payload({
				preserved: [
					{
						xref: '@52d1e0bc-aaaa-4bbb-8ccc-000000000001@',
						lines: ['1 FAMS @VOID@', '2 NOTE Aside']
					}
				]
			})
		);
		expect(text).toContain('1 FAMS @VOID@\r\n2 NOTE Aside');
	});
});

describe('a retained FAMC with no link to sit in', () => {
	it('is written under its person, beside the links that exist', () => {
		const data = payload({
			preserved: [
				{
					xref: '@52d1e0bc-aaaa-4bbb-8ccc-000000000002@',
					lines: ['1 FAMC @VOID@', '2 PEDI ADOPTED', '3 PHRASE By the vicar']
				},
				{
					xref: '@52d1e0bc-aaaa-4bbb-8ccc-000000000002@',
					lines: ['1 FAMC @0b1c-family-1@', '2 STAT PROVEN']
				}
			]
		});
		const text = buildGedcom7String(data);
		// The one under the real link stays inside it; the void one is written once, after.
		expect(text).toContain('1 FAMC @F1@\r\n2 STAT PROVEN');
		expect(text.match(/^1 FAMC @VOID@\r?$/gm)).toHaveLength(1);
		expect(text).toContain('1 FAMC @VOID@\r\n2 PEDI ADOPTED\r\n3 PHRASE By the vicar');
		expect(text.match(/STAT PROVEN/g)).toHaveLength(1);
	});
});

describe('@ escaping', () => {
	it('doubles a leading @ only', () => {
		const text = buildGedcom7String(
			payload({
				notes: [{ xref: '@n@', tag: 'SNOTE', text: '@start and mid@dle and end@' }]
			})
		);
		expect(text).toContain('0 @N1@ SNOTE @@start and mid@dle and end@');
	});
});
