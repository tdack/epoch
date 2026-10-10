import { describe, expect, it } from 'vitest';
import { SetupError } from './errors.ts';
import {
	EXPORT_LIFECYCLE_PREFIX,
	EXPORT_RULE_MAX_AGE_SECONDS,
	exportLifecycleRule,
	isDangerousRule,
	isExportOnlyRule,
	mergeExportRule,
	overlapsReservedPrefix,
	reservedRisk,
	type R2LifecycleRule
} from './lifecycle.ts';

const ours = () => exportLifecycleRule();

/** A destructive rule scoped to `prefix`: the shape that can delete or transition live objects. */
const expiring = (prefix: string): R2LifecycleRule => ({
	conditions: { prefix },
	deleteObjectsTransition: { condition: { type: 'Age', maxAge: 3600 } }
});

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

	it('preserves the Default Multipart Abort Rule, whose empty prefix is harmless', () => {
		const abort: R2LifecycleRule = {
			id: 'Default Multipart Abort Rule',
			enabled: true,
			conditions: { prefix: '' },
			abortMultipartUploadsTransition: { condition: { type: 'Age', maxAge: 604800 } }
		};
		const rules = mergeExportRule([abort]);
		expect(rules).toContainEqual(abort);
		expect(rules.some((rule) => isExportOnlyRule(rule))).toBe(true);
	});

	it('leaves an abort-only rule that overlaps a reserved prefix alone', () => {
		const abort: R2LifecycleRule = {
			id: 'abort',
			conditions: { prefix: 'm' },
			abortMultipartUploadsTransition: { condition: { type: 'Age', maxAge: 60 } }
		};
		expect(mergeExportRule([abort])).toContainEqual(abort);
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

	it('refuses a destructive rule with no prefix, which would expire the whole bucket', () => {
		expect(() => mergeExportRule([expiring('')])).toThrow(/no prefix/);
		expect(() => mergeExportRule([{ id: 'all', deleteObjectsTransition: {} }])).toThrow(SetupError);
	});

	it.each(['m', 'me', 'med', 'medi', 'media', 'media/', 'media/photos', 'staging', 'staging/', ''])(
		'refuses to run beside a destructive rule scoped to %s',
		(prefix) => {
			expect(() => mergeExportRule([expiring(prefix)])).toThrow(SetupError);
		}
	);
});

describe('isDangerousRule', () => {
	it('is true only for delete and storage-class transitions that are enabled', () => {
		expect(isDangerousRule(ours())).toBe(true);
		expect(isDangerousRule({ conditions: { prefix: 'med' }, storageClassTransitions: [{}] })).toBe(
			true
		);
		expect(isDangerousRule({ conditions: { prefix: 'med' }, storageClassTransitions: [] })).toBe(
			false
		);
		expect(isDangerousRule({ conditions: { prefix: '' } })).toBe(false);
		expect(
			isDangerousRule({
				conditions: { prefix: '' },
				abortMultipartUploadsTransition: { condition: { type: 'Age', maxAge: 60 } }
			})
		).toBe(false);
		expect(isDangerousRule({ enabled: false, ...expiring('med') })).toBe(false);
	});
});

describe('overlapsReservedPrefix', () => {
	it.each(['', 'm', 'me', 'med', 'medi', 'media', 'media/', 'media/photos', 'staging', 'sta'])(
		'flags %s, which reaches into a protected prefix',
		(prefix) => {
			expect(overlapsReservedPrefix(prefix)).not.toBeNull();
		}
	);

	it.each(['exports/', 'logs/', 'e', 'x'])('leaves %s alone', (prefix) => {
		expect(overlapsReservedPrefix(prefix)).toBeNull();
	});
});

describe('reservedRisk', () => {
	it('says nothing about a harmless rule, even with an empty or overlapping prefix', () => {
		expect(reservedRisk({ conditions: { prefix: '' } })).toBeNull();
		expect(reservedRisk({ conditions: { prefix: 'med' } })).toBeNull();
	});

	it('says nothing about a disabled destructive rule', () => {
		expect(reservedRisk({ enabled: false, ...expiring('med') })).toBeNull();
	});

	it('reports a destructive rule with no prefix', () => {
		expect(reservedRisk(expiring(''))).toMatch(/no prefix/);
	});

	it.each(['m', 'me', 'med', 'medi', 'media', 'media/photos', 'staging', 'staging/import.ged'])(
		'reports a destructive rule overlapping %s',
		(prefix) => {
			expect(reservedRisk(expiring(prefix))).toMatch(/overlaps/);
		}
	);

	it('accepts a destructive rule that stays clear of the reserved prefixes', () => {
		expect(reservedRisk(expiring('exports/'))).toBeNull();
		expect(reservedRisk(expiring('logs/'))).toBeNull();
	});

	it('treats a storage-class transition as destructive enough to report', () => {
		expect(reservedRisk({ conditions: { prefix: 'med' }, storageClassTransitions: [{}] })).toMatch(
			/overlaps/
		);
	});
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
