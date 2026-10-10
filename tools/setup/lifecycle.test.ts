import { describe, expect, it } from 'vitest';
import { SetupError } from './errors.ts';
import {
	EXPORT_LIFECYCLE_PREFIX,
	EXPORT_RULE_MAX_AGE_SECONDS,
	exportLifecycleRule,
	isExportOnlyRule,
	mergeExportRule,
	type R2LifecycleRule
} from './lifecycle.ts';

const ours = () => exportLifecycleRule();

describe('mergeExportRule', () => {
	it('adds the export rule when the bucket has none', () => {
		const rules = mergeExportRule([]);
		expect(rules).toEqual([ours()]);
	});

	it('keeps every unrelated rule untouched and appends ours', () => {
		const other: R2LifecycleRule = { id: 'logs', conditions: { prefix: 'logs/' }, enabled: true };
		const rules = mergeExportRule([other]);
		expect(rules[0]).toEqual(other);
		expect(rules.some((rule) => isExportOnlyRule(rule))).toBe(true);
	});

	it('replaces an existing export rule rather than adding a second', () => {
		const stale: R2LifecycleRule = {
			conditions: { prefix: EXPORT_LIFECYCLE_PREFIX },
			enabled: false
		};
		const rules = mergeExportRule([stale]);
		expect(rules).toHaveLength(1);
		expect(rules[0]!.enabled).toBe(true);
	});

	it('refuses a rule with no prefix, which would expire the whole bucket', () => {
		expect(() => mergeExportRule([{ id: 'all' }])).toThrow(SetupError);
		expect(() => mergeExportRule([{ conditions: { prefix: '' } }])).toThrow(/no prefix/);
	});

	it.each(['media', 'media/', 'media/photos', 'staging', 'staging/import.ged'])(
		'refuses to run beside a rule scoped to %s',
		(prefix) => {
			expect(() => mergeExportRule([{ conditions: { prefix } }])).toThrow(SetupError);
		}
	);
});

describe('isExportOnlyRule', () => {
	it('accepts our rule', () => {
		expect(isExportOnlyRule(ours())).toBe(true);
	});

	it.each([
		['an empty prefix', { conditions: { prefix: '' } }],
		['a disabled rule', { conditions: { prefix: EXPORT_LIFECYCLE_PREFIX }, enabled: false }],
		[
			'a longer age',
			{
				conditions: { prefix: EXPORT_LIFECYCLE_PREFIX },
				deleteObjectsTransition: {
					condition: { type: 'Age', maxAge: EXPORT_RULE_MAX_AGE_SECONDS * 2 }
				}
			}
		],
		['no delete transition', { conditions: { prefix: EXPORT_LIFECYCLE_PREFIX } }]
	])('rejects %s', (_label, rule) => {
		expect(isExportOnlyRule(rule as R2LifecycleRule)).toBe(false);
	});

	it('accepts a shorter age, which only expires exports sooner', () => {
		expect(
			isExportOnlyRule({
				conditions: { prefix: EXPORT_LIFECYCLE_PREFIX },
				deleteObjectsTransition: { condition: { type: 'Age', maxAge: 60 } }
			})
		).toBe(true);
	});
});
