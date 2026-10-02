/**
 * Data-quality findings (Phase 5): statements the record makes about itself that are impossible, odd
 * or worth researching. Browser-safe and pure, so the page, the API and the checks share one list.
 *
 * A finding is a prompt to look, never a verdict: an unusual history is allowed to stand, so every
 * rule only fires on what the dates *rule out* (an approximate or partial date narrows what is
 * possible and is never read as an exact day), and none of them blocks a save.
 */

export const QUALITY_SEVERITIES = {
	ERROR: 'error',
	WARNING: 'warning',
	SUGGESTION: 'suggestion'
} as const;
export type QualitySeverity = (typeof QUALITY_SEVERITIES)[keyof typeof QUALITY_SEVERITIES];

/** Most serious first, which is the order the report lists them in. */
export const QUALITY_SEVERITY_ORDER: readonly QualitySeverity[] = [
	'error',
	'warning',
	'suggestion'
];

export const QUALITY_SEVERITY_LABELS: Record<QualitySeverity, string> = {
	error: 'Errors',
	warning: 'Warnings',
	suggestion: 'Research suggestions'
};

export interface QualityRule {
	code: string;
	severity: QualitySeverity;
	title: string;
	/** Why this is flagged, so a finding can be judged without reading the code. */
	why: string;
}

export const QUALITY_RULES = [
	{
		code: 'ancestor_cycle',
		severity: 'error',
		title: 'A person is their own ancestor',
		why: 'Following parent links from a person leads back to them, which no family can do.'
	},
	{
		code: 'orphan_fact',
		severity: 'error',
		title: 'A fact belongs to nobody',
		why: 'The fact names a person or partnership that is not in the tree.'
	},
	{
		code: 'death_before_birth',
		severity: 'warning',
		title: 'Death before birth',
		why: 'The death is certainly dated before the birth.'
	},
	{
		code: 'child_before_parent',
		severity: 'warning',
		title: 'Child born before a parent',
		why: 'The child was certainly born before the parent.'
	},
	{
		code: 'parent_too_young',
		severity: 'warning',
		title: 'Parent under 12 at the birth',
		why: 'The parent was certainly under 12 years old when the child was born.'
	},
	{
		code: 'child_after_parent_death',
		severity: 'warning',
		title: 'Child born long after a parent died',
		why: 'The child was certainly born more than a year after the parent died.'
	},
	{
		code: 'lifespan_over_120',
		severity: 'warning',
		title: 'A lifespan over 120 years',
		why: 'The death was certainly more than 120 years after the birth.'
	},
	{
		code: 'fact_before_birth',
		severity: 'warning',
		title: 'A fact dated before the birth',
		why: 'An event in the person’s life is certainly dated before their birth.'
	},
	{
		code: 'fact_after_death',
		severity: 'warning',
		title: 'A fact dated long after the death',
		why: 'An event is certainly dated more than a year after the death, and it is not a burial, cremation or probate.'
	},
	{
		code: 'duplicate_partnership',
		severity: 'suggestion',
		title: 'The same partners recorded twice',
		why: 'Two partnerships have exactly the same partners. That is often one partnership imported twice, and sometimes a couple who parted and reunited; they are never merged for you, and can be merged from either partnership.'
	},
	{
		code: 'duplicate_parent_link',
		severity: 'warning',
		title: 'The same parent recorded twice',
		why: 'Two links say the same person is the same kind of parent of the same child.'
	},
	{
		code: 'conflicting_births',
		severity: 'suggestion',
		title: 'More than one birth',
		why: 'A person has two or more births with different dates. Both are kept; a source would say which is right.'
	},
	{
		code: 'conflicting_deaths',
		severity: 'suggestion',
		title: 'More than one death',
		why: 'A person has two or more deaths with different dates. Both are kept; a source would say which is right.'
	},
	{
		code: 'possible_duplicate_person',
		severity: 'suggestion',
		title: 'Possibly the same person',
		why: 'Two or more people have the same name and birth dates that could be the same. A name and a date are never enough to merge on: compare the records, and merge from either person’s page if they are one.'
	},
	{
		code: 'one_parent_recorded',
		severity: 'suggestion',
		title: 'Only one parent recorded',
		why: 'A child has a single parent on record. The other parent may be worth finding.'
	}
] as const satisfies readonly QualityRule[];

export type QualityRuleCode = (typeof QUALITY_RULES)[number]['code'];

export const QUALITY_RULE_BY_CODE: ReadonlyMap<string, QualityRule> = new Map(
	QUALITY_RULES.map((rule) => [rule.code, rule])
);

/** A record a finding is about, so the page can link to it. */
export interface FindingSubject {
	kind: 'person' | 'partnership';
	id: string;
	/** The name shown for it; "Private" for a placeholder. */
	name: string;
}

export interface QualityFinding {
	/** Stable across reloads and edits that do not change the finding, so a dismissal keeps matching. */
	key: string;
	rule: QualityRuleCode;
	severity: QualitySeverity;
	message: string;
	subjects: FindingSubject[];
}

export interface QualityDismissal {
	key: string;
	reason: string;
	dismissedBy: string;
	/** Epoch milliseconds. */
	dismissedAt: number;
}

/**
 * A dismissed finding, listed with its reason. Only a dismissal whose finding still fires, and that
 * the viewer may see, is listed: one left behind by an edit says nothing, and an id in it could
 * belong to someone the viewer may not see.
 */
export interface DismissedFinding extends QualityDismissal {
	finding: QualityFinding;
}

export interface QualityReport {
	findings: QualityFinding[];
	/** How many findings each rule raised before the per-rule cap, dismissed ones excluded. */
	counts: Record<string, number>;
	dismissed: DismissedFinding[];
	/** True for a rule whose list was cut at `MAX_FINDINGS_PER_RULE`. */
	truncatedRules: string[];
}

/** A rule on a badly tangled tree can fire thousands of times; the page and the response stay readable. */
export const MAX_FINDINGS_PER_RULE = 100;
export const MAX_DISMISSAL_REASON_LENGTH = 500;

export const findingKey = (rule: QualityRuleCode, ...ids: string[]): string =>
	`${rule}:${ids.join(',')}`;
