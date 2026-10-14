import { describe, it, expect } from 'vitest';
import {
	citationCreateSchema,
	factCreateSchema,
	factUpdateSchema,
	individualCreateSchema,
	nameCreateSchema,
	nameUpdateSchema,
	noteLinkCreateSchema,
	relationshipPayloadSchema,
	sharedNoteCreateSchema,
	sourceRepositoryLinkSchema,
	treeCreateSchema,
	treeRenameSchema
} from './schemas';

describe('transport validation schemas', () => {
	it('accepts a valid add_parent intent', () => {
		const result = relationshipPayloadSchema.safeParse({
			intent: {
				kind: 'add_parent',
				child: { id: '@I1@', givenName: 'Sam', surname: 'Walker' },
				parent: { id: '@I2@', givenName: 'Alex', surname: null },
				type: 'adoptive',
				role: 'mother',
				unionLabel: null
			}
		});
		expect(result.success).toBe(true);
	});

	it('rejects an intent with an unknown kind', () => {
		const result = relationshipPayloadSchema.safeParse({
			intent: { kind: 'marry', person: {} }
		});
		expect(result.success).toBe(false);
	});

	it('rejects an add_parent intent with an invalid relationship type', () => {
		const result = relationshipPayloadSchema.safeParse({
			intent: {
				kind: 'add_parent',
				child: { id: '@I1@', givenName: null, surname: null },
				parent: { id: '@I2@', givenName: null, surname: null },
				type: 'step',
				role: 'parent',
				unionLabel: null
			}
		});
		expect(result.success).toBe(false);
	});

	it('requires a name on tree creation', () => {
		expect(treeCreateSchema.safeParse({ name: '' }).success).toBe(false);
		expect(treeCreateSchema.safeParse({ name: '  Does  ' }).success).toBe(true);
	});

	it('accepts X and rejects anything else for sex', () => {
		expect(individualCreateSchema.parse({ givenName: 'Sam', sex: 'X' }).sex).toBe('X');
		expect(individualCreateSchema.safeParse({ givenName: 'Sam', sex: 'N' }).success).toBe(false);
	});

	it('defaults individual sex to U', () => {
		const result = individualCreateSchema.parse({ givenName: 'Jae' });
		expect(result.sex).toBe('U');
	});
});

describe('line terminators at the write boundary', () => {
	const lf = 'first\nsecond';
	const cr = 'first\rsecond';

	it('rejects a terminator in every single-line fact field', () => {
		for (const field of ['dateText', 'place', 'value', 'cause', 'age'] as const) {
			expect(factCreateSchema.safeParse({ type: 'BIRT', [field]: lf }).success).toBe(false);
			expect(factUpdateSchema.safeParse({ version: 1, [field]: cr }).success).toBe(false);
		}
	});

	it('keeps a fact note multi-line', () => {
		expect(factCreateSchema.safeParse({ type: 'BIRT', notes: lf }).success).toBe(true);
	});

	it('rejects a terminator in every name part', () => {
		const parts = [
			'givenName',
			'surname',
			'prefix',
			'suffix',
			'nickname',
			'surnamePrefix',
			'dateText'
		] as const;
		for (const field of parts) {
			expect(nameCreateSchema.safeParse({ type: 'birth', [field]: lf }).success).toBe(false);
			expect(nameUpdateSchema.safeParse({ version: 1, [field]: cr }).success).toBe(false);
		}
	});

	it('rejects a terminator in a tree name', () => {
		expect(treeCreateSchema.safeParse({ name: lf }).success).toBe(false);
		expect(treeRenameSchema.safeParse({ name: cr, version: 1 }).success).toBe(false);
	});

	it('rejects a terminator in a citation entry date and a call number', () => {
		expect(
			citationCreateSchema.safeParse({
				subject: { kind: 'person', id: 'p1' },
				sourceId: 's1',
				entryDate: lf
			}).success
		).toBe(false);
		expect(
			sourceRepositoryLinkSchema.safeParse({ repositoryId: 'r1', callNumber: cr }).success
		).toBe(false);
	});

	it('rejects a terminator in a shared note MIME or LANG', () => {
		expect(sharedNoteCreateSchema.safeParse({ text: 'hi', mime: lf }).success).toBe(false);
		expect(sharedNoteCreateSchema.safeParse({ text: 'hi', language: cr }).success).toBe(false);
	});

	it('keeps a note and a shared note multi-line', () => {
		expect(sharedNoteCreateSchema.safeParse({ text: lf }).success).toBe(true);
		expect(
			noteLinkCreateSchema.safeParse({ subject: { kind: 'person', id: 'p1' }, text: lf }).success
		).toBe(true);
	});
});

describe('imported fact details at the write boundary', () => {
	const agency130 = 'A'.repeat(130);

	it('accepts the values an import can bring, so editing an imported fact cannot fail on a spec limit', () => {
		const imported = {
			type: 'BAPM',
			address: '12 High Street\nYork',
			agency: agency130,
			phone: '0113 000\n0113 111\n0113 222\n0113 333',
			latitude: '51.5',
			longitude: 'W1.5'
		};
		expect(factCreateSchema.safeParse(imported).success).toBe(true);
		expect(factUpdateSchema.safeParse({ version: 1, ...imported }).success).toBe(true);
	});

	it('keeps line breaks out of the one-line detail fields only', () => {
		expect(factCreateSchema.safeParse({ type: 'BIRT', agency: 'a\nb' }).success).toBe(false);
		expect(factCreateSchema.safeParse({ type: 'BIRT', latitude: '51\n5' }).success).toBe(false);
		expect(factCreateSchema.safeParse({ type: 'BIRT', address: 'a\nb' }).success).toBe(true);
		expect(factCreateSchema.safeParse({ type: 'BIRT', email: 'a@x.test\nb@x.test' }).success).toBe(
			true
		);
	});

	it('refuses only values past the safety caps', () => {
		expect(factCreateSchema.safeParse({ type: 'BIRT', agency: 'A'.repeat(501) }).success).toBe(
			false
		);
		expect(factCreateSchema.safeParse({ type: 'BIRT', agency: 'A'.repeat(500) }).success).toBe(
			true
		);
		expect(factCreateSchema.safeParse({ type: 'BIRT', address: 'A'.repeat(2001) }).success).toBe(
			false
		);
		expect(factUpdateSchema.safeParse({ version: 1, web: 'w'.repeat(2001) }).success).toBe(false);
	});

	it('leaves the file-owned layout and extra lines out of what a request can write', () => {
		const parsed = factUpdateSchema.parse({
			version: 1,
			address: '1 Road',
			addressLayout: ['2 ADDR forged'],
			placeExtra: ['2 FORM forged']
		});
		expect(parsed).not.toHaveProperty('addressLayout');
		expect(parsed).not.toHaveProperty('placeExtra');
		expect(parsed.address).toBe('1 Road');
	});

	it('treats an absent detail as left alone on update, and null as a clear', () => {
		expect(factUpdateSchema.parse({ version: 1 })).not.toHaveProperty('agency');
		expect(factUpdateSchema.parse({ version: 1, agency: null }).agency).toBeNull();
	});
});
