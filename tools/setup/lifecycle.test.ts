import { describe, expect, it } from 'vitest';
import { STAGED_IMPORT_MAX_AGE_MS } from '../../src/lib/server/gedcom/limits.ts';
import { SetupError } from './errors.ts';
import {
	EXPORT_LIFECYCLE_PREFIX,
	EXPORT_RULE_MAX_AGE_SECONDS,
	exportLifecycleRule,
	isDangerousRule,
	isExportOnlyRule,
	isOwnStagingRule,
	mergeLifecycleRules,
	overlapsReservedPrefix,
	reservedRisk,
	STAGING_LIFECYCLE_PREFIX,
	STAGING_RULE_MAX_AGE_SECONDS,
	stagingLifecycleRule,
	type R2LifecycleRule
} from './lifecycle.ts';

const ours = () => exportLifecycleRule();

/** A destructive rule scoped to `prefix`: the shape that can delete or transition live objects. */
const expiring = (prefix: string): R2LifecycleRule => ({
	conditions: { prefix },
	deleteObjectsTransition: { condition: { type: 'Age', maxAge: 3600 } }
});

describe('mergeLifecycleRules', () => {
	it('adds the export rule when the bucket has none', () => {
		const rules = mergeLifecycleRules([]);
		expect(rules).toEqual([ours(), stagingLifecycleRule()]);
	});

	it('keeps every unrelated rule untouched and appends ours', () => {
		const other: R2LifecycleRule = { id: 'logs', conditions: { prefix: 'logs/' }, enabled: true };
		const rules = mergeLifecycleRules([other]);
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
		const rules = mergeLifecycleRules([abort]);
		expect(rules).toContainEqual(abort);
		expect(rules.some((rule) => isExportOnlyRule(rule))).toBe(true);
	});

	it('leaves an abort-only rule that overlaps a reserved prefix alone', () => {
		const abort: R2LifecycleRule = {
			id: 'abort',
			conditions: { prefix: 'm' },
			abortMultipartUploadsTransition: { condition: { type: 'Age', maxAge: 60 } }
		};
		expect(mergeLifecycleRules([abort])).toContainEqual(abort);
	});

	it('replaces an existing export rule rather than adding a second', () => {
		const stale: R2LifecycleRule = {
			conditions: { prefix: EXPORT_LIFECYCLE_PREFIX },
			enabled: false
		};
		const rules = mergeLifecycleRules([stale]);
		expect(rules).toEqual([ours(), stagingLifecycleRule()]);
	});

	it('is idempotent: merging its own output changes nothing', () => {
		const other: R2LifecycleRule = { id: 'logs', conditions: { prefix: 'logs/' } };
		const once = mergeLifecycleRules([other]);
		expect(mergeLifecycleRules(once)).toEqual(once);
	});

	it('replaces a shortened copy of our staging rule instead of refusing it', () => {
		const shortened: R2LifecycleRule = {
			...stagingLifecycleRule(),
			deleteObjectsTransition: { condition: { type: 'Age', maxAge: 3600 } }
		};
		expect(mergeLifecycleRules([shortened])).toEqual([ours(), stagingLifecycleRule()]);
	});

	it('refuses a foreign destructive rule over staging/ even with our id on another prefix', () => {
		expect(() => mergeLifecycleRules([expiring(STAGING_LIFECYCLE_PREFIX)])).toThrow(SetupError);
		expect(() =>
			mergeLifecycleRules([{ ...expiring('staging/gedcom-'), id: 'epoch-staging-expiry' }])
		).toThrow(SetupError);
	});

	it('refuses a foreign rule over staging/ that borrows our id only in name', () => {
		expect(() =>
			mergeLifecycleRules([{ ...expiring('staging'), id: 'epoch-staging-expiry' }])
		).toThrow(SetupError);
	});

	it('refuses a destructive rule with no prefix, which would expire the whole bucket', () => {
		expect(() => mergeLifecycleRules([expiring('')])).toThrow(/no prefix/);
		expect(() => mergeLifecycleRules([{ id: 'all', deleteObjectsTransition: {} }])).toThrow(
			SetupError
		);
	});

	it.each(['m', 'me', 'med', 'medi', 'media', 'media/', 'media/photos', 'staging', 'staging/', ''])(
		'refuses to run beside a destructive rule scoped to %s',
		(prefix) => {
			expect(() => mergeLifecycleRules([expiring(prefix)])).toThrow(SetupError);
		}
	);
});

describe('staging rule', () => {
	it('expires staged imports strictly later than the app stops counting them', () => {
		expect(STAGING_RULE_MAX_AGE_SECONDS).toBeGreaterThan(STAGED_IMPORT_MAX_AGE_MS / 1000);
	});

	it('is recognised, and exempt from the reserved-prefix guard', () => {
		expect(isOwnStagingRule(stagingLifecycleRule())).toBe(true);
		expect(reservedRisk(stagingLifecycleRule())).toBeNull();
	});

	it.each([
		[
			'too short',
			{
				...stagingLifecycleRule(),
				deleteObjectsTransition: {
					condition: { type: 'Age', maxAge: STAGED_IMPORT_MAX_AGE_MS / 1000 }
				}
			}
		],
		['another prefix', { ...stagingLifecycleRule(), conditions: { prefix: 'staging' } }],
		['another id', { ...stagingLifecycleRule(), id: 'other' }]
	])('is not recognised when %s, so the guard reports it', (_label, rule) => {
		expect(isOwnStagingRule(rule as R2LifecycleRule)).toBe(false);
		expect(reservedRisk(rule as R2LifecycleRule)).toMatch(/overlaps/);
	});
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
