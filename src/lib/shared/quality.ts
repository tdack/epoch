/**
 * Data-quality findings (Phase 5): statements the record makes about itself that are impossible, odd
 * or worth researching. Browser-safe and pure, so the page, the API and the checks share one list.
 *
 * A finding is a prompt to look, never a verdict: an unusual history is allowed to stand, so every
 * rule only fires on what the dates *rule out* (an approximate or partial date narrows what is
 * possible and is never read as an exact day), and none of them blocks a save.
 */

import type { FindingTaskDto } from './tasks';

export type QualitySeverity = 'error' | 'warning' | 'suggestion';

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
	/**
	 * Only managers and owners are shown it: the finding names the private person it is about, so
	 * showing it to a role that cannot see them would be the leak it looks for (ADR-029).
	 */
	isManagerOnly?: boolean;
}

export const QUALITY_RULES = [
	{
		code: 'ancestor_cycle',
		severity: 'error',
		title: 'A person is their own ancestor',
		why: 'Following parent links from a person leads back to them, which no family can do.'
	},
	{
		code: 'unreadable_date',
		severity: 'warning',
		title: 'A date Epoch cannot read',
		why: 'The date is kept exactly as it was written, but Epoch cannot tell when it was, so it does not sort, and none of the other date checks can use it. It often came from another program: a mistyped month, a day that does not exist, or two dates run together. Edit it to a date such as 14 APR 1912, or put the words in brackets to keep them as a phrase.'
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
		code: 'fact_coordinates_far_from_place',
		severity: 'warning',
		title: 'A fact’s map coordinates are far from its place',
		why: 'The latitude and longitude on a fact are more than 50 km from the confirmed location of the place it names. One of them is probably wrong, or the place was set to the wrong town.'
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
		code: 'unsourced_key_fact',
		severity: 'suggestion',
		title: 'A key fact with no source',
		why: 'A birth, death or marriage has no citation. Citing the record it came from lets anyone, including you later, check it; nothing is wrong with the fact itself.'
	},
	{
		code: 'public_override_likely_living',
		severity: 'warning',
		title: 'Always public, but probably still living',
		why: 'A person is set to always public, and their dates do not show that they have died or were born long enough ago to be dead: no death, burial or cremation is recorded, and no birth or other fact is dated before the tree’s living-person cut-off. The override is yours to make; this only asks whether it was meant.',
		isManagerOnly: true
	},
	{
		code: 'probably_dead_no_death',
		severity: 'suggestion',
		title: 'Probably dead, but no death recorded',
		why: 'A person has no death, burial or cremation and no birth before the tree’s living-person cut-off, so they are kept private as possibly living, but the dates of their parents, partners, partnerships, children or grandchildren show they must have died. Recording a death, even one with no date, or setting them to always public would show them.',
		isManagerOnly: true
	},
	{
		code: 'note_names_private_person',
		severity: 'warning',
		title: 'A note others can see names a private person',
		why: 'The words of a note that viewers can read (a note on a record they may see, or a shared note one of those records uses) contain the full name of a person who is private to them, who is not what the note is on. Only the full given name and surname together, as a whole phrase, count.',
		isManagerOnly: true
	},
	{
		code: 'source_names_private_person',
		severity: 'warning',
		title: 'A source others can see names a private person',
		why: 'The title, author, publication, abbreviation or words of a source that viewers can see (it supports a record they may see) contain the full name of a person who is private to them. Only the full given name and surname together, as a whole phrase, count.',
		isManagerOnly: true
	},
	{
		code: 'one_parent_recorded',
		severity: 'suggestion',
		title: 'Only one parent recorded',
		why: 'A child has a single parent on record. The other parent may be worth finding.'
	},
	{
		code: 'unconnected_people',
		severity: 'suggestion',
		title: 'Not connected to the rest of the tree',
		why: 'No chain of parents, children or partners links these people to the largest connected family in the tree. They may be waiting for a relationship to be recorded, or have come in with an import and belong in another tree.'
	},
	{
		code: 'place_without_location',
		severity: 'suggestion',
		title: 'A place with no location',
		why: 'A place that a visible fact names has no location, so it is not on the map. Give it a location, or mark it ignored if it does not need one.'
	}
] as const satisfies readonly QualityRule[];

export type QualityRuleCode = (typeof QUALITY_RULES)[number]['code'];

export const QUALITY_RULE_BY_CODE: ReadonlyMap<string, QualityRule> = new Map(
	QUALITY_RULES.map((rule) => [rule.code, rule])
);

/** A record a finding is about, so the page can link to it. */
export interface FindingSubject {
	/** A `place` is linked by its text, not by an id: the place page finds it by name. */
	kind: 'person' | 'partnership' | 'place';
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
	/** The research task made from this finding, when there is one: the open one, else the latest. */
	task?: FindingTaskDto;
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
interface DismissedFinding extends QualityDismissal {
	finding: QualityFinding;
}

export interface QualityReport {
	findings: QualityFinding[];
	/** How many findings each rule raised before the per-rule cap, dismissed ones excluded. */
	counts: Record<string, number>;
	dismissed: DismissedFinding[];
	/** True for a rule whose list was cut at `MAX_FINDINGS_PER_RULE`. */
	truncatedRules: string[];
	/** Current members of the tree, for the assignee choice when a task is made from a finding. */
	members: Array<{ id: string; name: string }>;
}

/** A rule on a badly tangled tree can fire thousands of times; the page and the response stay readable. */
export const MAX_FINDINGS_PER_RULE = 100;
export const MAX_DISMISSAL_REASON_LENGTH = 500;
/**
 * The most findings one request may dismiss. A selection reaches only what the page lists, at most
 * `MAX_FINDINGS_PER_RULE` per rule; this bounds the request, not the page.
 */
export const MAX_BULK_DISMISSALS = 2000;

export const findingKey = (rule: QualityRuleCode, ...ids: string[]): string =>
	`${rule}:${ids.join(',')}`;
