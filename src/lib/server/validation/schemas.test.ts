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
		expect(treeCreateSchema.safeParse({ name: '  Simpsons  ' }).success).toBe(true);
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
