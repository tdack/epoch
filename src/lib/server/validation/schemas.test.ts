import { describe, it, expect } from 'vitest';
import {
	relationshipPayloadSchema,
	individualCreateSchema,
	treeCreateSchema
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