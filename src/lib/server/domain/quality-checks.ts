/**
 * The data-quality rules over a tree's rows (Phase 5). Pure and deterministic: the same rows give
 * the same findings in the same order, so a dismissal keyed on a finding keeps matching.
 *
 * Every rule fires only on what the dates rule out. A date is taken as the range of days it could
 * mean (`boundsOf`), a person with several births or deaths is taken at the widest span, and a rule
 * that needs a date nobody has simply stays quiet. Unusual histories are never rejected for being
 * unlikely: the thresholds (12 years, 120 years, a year after a death) are far outside what happens.
 *
 * Callers pass the rows the viewer may see, so a finding can name nobody they cannot.
 */

import { boundsOf, isCertainlyBefore, type DateBounds } from '../../shared/union-warnings';
import { factTypeInfo, FACT_KINDS } from '../../shared/fact-types';
import {
	findingKey,
	QUALITY_RULE_BY_CODE,
	type FindingSubject,
	type QualityFinding,
	type QualityRuleCode
} from '../../shared/quality';
import { KEY_FACT_TYPES } from '../../shared/evidence';
import type { EventRow, IndividualRow, TreeRows } from './change-log';
import { personName } from './tree-ops';

/** A group of namesakes is listed up to this many people; the finding still counts them all. */
const MAX_DUPLICATE_SUBJECTS = 10;
const MIN_PARENT_AGE_YEARS = 12;
const MAX_LIFESPAN_YEARS = 120;
/** A father can die before a child is born; a year is well past any pregnancy, and a late record is still odd. */
const LATE_BIRTH_GRACE_YEARS = 1;
/** Burial, cremation and probate follow a death by design, however long after. */
const POSTHUMOUS_TYPES: ReadonlySet<string> = new Set(['DEAT', 'BURI', 'CREM', 'PROB']);

/** `YYYY-MM-DD` plus whole years, by the year only; a 29 February moves to a day that compares the same way. */
export function addYears(day: string, years: number): string {
	return `${String(Number(day.slice(0, 4)) + years).padStart(4, '0')}${day.slice(4)}`;
}

/** The widest span of days the person's facts of one type allow; null when any of them is undated. */
function spanOf(events: readonly EventRow[]): DateBounds | null {
	const bounds = events.map((e) => boundsOf(e.dateRaw));
	if (bounds.length === 0 || bounds.some((b) => b === null)) return null;
	const earliest = bounds.map((b) => b!.earliest);
	const latest = bounds.map((b) => b!.latest);
	return {
		earliest: earliest.some((d) => d === null)
			? null
			: earliest.reduce((a, b) => (a! < b! ? a : b)),
		latest: latest.some((d) => d === null) ? null : latest.reduce((a, b) => (a! > b! ? a : b))
	};
}

const isCertainlyAfter = (a: DateBounds | null, limit: string): boolean =>
	a?.earliest != null && a.earliest > limit;

export function checkQuality(rows: TreeRows): QualityFinding[] {
	const findings: QualityFinding[] = [];
	const people = new Map<string, IndividualRow>(rows.individuals.map((p) => [p.id, p]));
	const unionIds = new Set(rows.unions.map((u) => u.id));
	const name = (id: string) => (people.has(id) ? personName(people.get(id)!) : 'Someone');
	const person = (id: string): FindingSubject => ({ kind: 'person', id, name: name(id) });
	const partnerIdsOfUnion = new Map<string, string[]>();
	for (const p of rows.unionPartners)
		partnerIdsOfUnion.set(p.unionId, [...(partnerIdsOfUnion.get(p.unionId) ?? []), p.personId]);
	const partnersLabel = (unionId: string) =>
		(partnerIdsOfUnion.get(unionId) ?? []).map(name).join(' and ') || 'a partnership';

	function add(
		rule: QualityRuleCode,
		keyIds: string[],
		message: string,
		subjects: FindingSubject[]
	) {
		findings.push({
			key: findingKey(rule, ...keyIds),
			rule,
			severity: QUALITY_RULE_BY_CODE.get(rule)!.severity,
			message,
			subjects
		});
	}

	// A key fact nobody cites is a prompt to research, not a fault; "cited" is any citation at all.
	const citedEvents = new Set(
		rows.citations.filter((c) => c.subjectKind === 'event').map((c) => c.subjectId)
	);
	const keyFactTypes: ReadonlySet<string> = new Set(KEY_FACT_TYPES);

	const eventsOfPerson = new Map<string, EventRow[]>();
	for (const e of rows.events) {
		if (e.entityType === 'INDIVIDUAL') {
			const list = eventsOfPerson.get(e.entityId) ?? [];
			list.push(e);
			eventsOfPerson.set(e.entityId, list);
		}
		const isOrphan =
			e.entityType === 'INDIVIDUAL' ? !people.has(e.entityId) : !unionIds.has(e.entityId);
		if (isOrphan)
			add(
				'orphan_fact',
				[e.id],
				`A ${e.type} fact belongs to ${e.entityType === 'INDIVIDUAL' ? 'a person' : 'a partnership'} who is not in the tree.`,
				[]
			);
		else if (keyFactTypes.has(e.type) && !citedEvents.has(e.id)) {
			// A person's birth or death, or a partnership's marriage: the type decides which, so a
			// marriage recorded on a person, or a birth on a partnership, is nobody's key fact.
			const isOfPerson = e.entityType === 'INDIVIDUAL';
			if (isOfPerson === (e.type !== 'MARR')) {
				const label = factTypeInfo(e.type)?.label ?? e.type;
				add(
					'unsourced_key_fact',
					[e.id],
					isOfPerson
						? `The ${label.toLowerCase()} of ${name(e.entityId)} has no citation.`
						: `The marriage of ${partnersLabel(e.entityId)} has no citation.`,
					isOfPerson
						? [person(e.entityId)]
						: [{ kind: 'partnership', id: e.entityId, name: partnersLabel(e.entityId) }]
				);
			}
		}
	}

	const birthOf = new Map<string, DateBounds | null>();
	const deathOf = new Map<string, DateBounds | null>();
	for (const p of rows.individuals) {
		const facts = eventsOfPerson.get(p.id) ?? [];
		const births = facts.filter((e) => e.type === 'BIRT');
		const deaths = facts.filter((e) => e.type === 'DEAT');
		const birth = spanOf(births);
		const death = spanOf(deaths);
		birthOf.set(p.id, birth);
		deathOf.set(p.id, death);

		if (isCertainlyBefore(death, birth)) {
			add(
				'death_before_birth',
				[p.id],
				`${name(p.id)} is recorded as dying before they were born.`,
				[person(p.id)]
			);
		}
		if (
			death?.earliest &&
			birth?.latest &&
			death.earliest > addYears(birth.latest, MAX_LIFESPAN_YEARS)
		) {
			add(
				'lifespan_over_120',
				[p.id],
				`${name(p.id)} would have been over ${MAX_LIFESPAN_YEARS} at death.`,
				[person(p.id)]
			);
		}
		for (const fact of facts) {
			const info = factTypeInfo(fact.type);
			if (info?.kind !== FACT_KINDS.EVENT) continue;
			const when = boundsOf(fact.dateRaw);
			// A death before the birth is its own finding; saying it again as a fact would count it twice.
			if (fact.type !== 'BIRT' && fact.type !== 'DEAT' && isCertainlyBefore(when, birth)) {
				add(
					'fact_before_birth',
					[fact.id],
					`${info.label} of ${name(p.id)} is dated before their birth.`,
					[person(p.id)]
				);
			}
			if (
				!POSTHUMOUS_TYPES.has(fact.type) &&
				death?.latest &&
				isCertainlyAfter(when, addYears(death.latest, LATE_BIRTH_GRACE_YEARS))
			) {
				add(
					'fact_after_death',
					[fact.id],
					`${info.label} of ${name(p.id)} is dated more than a year after their death.`,
					[person(p.id)]
				);
			}
		}
		if (births.length > 1 && new Set(births.map((e) => e.dateRaw ?? '')).size > 1) {
			add(
				'conflicting_births',
				[p.id],
				`${name(p.id)} has ${births.length} births with different dates.`,
				[person(p.id)]
			);
		}
		if (deaths.length > 1 && new Set(deaths.map((e) => e.dateRaw ?? '')).size > 1) {
			add(
				'conflicting_deaths',
				[p.id],
				`${name(p.id)} has ${deaths.length} deaths with different dates.`,
				[person(p.id)]
			);
		}
	}

	// ---- Parent and child ----
	const seenLinks = new Map<string, number>();
	const parentsOfChild = new Map<string, Set<string>>();
	for (const link of rows.parentChild) {
		if (!people.has(link.parentId) || !people.has(link.childId)) continue;
		const linkKey = `${link.parentId}>${link.childId}>${link.type}`;
		seenLinks.set(linkKey, (seenLinks.get(linkKey) ?? 0) + 1);
		if (seenLinks.get(linkKey) === 2) {
			add(
				'duplicate_parent_link',
				[link.parentId, link.childId, link.type],
				`${name(link.parentId)} is recorded as the ${link.type} parent of ${name(link.childId)} more than once.`,
				[person(link.parentId), person(link.childId)]
			);
		}
		parentsOfChild.set(
			link.childId,
			(parentsOfChild.get(link.childId) ?? new Set()).add(link.parentId)
		);

		// An adoptive, foster or guardian link can start long after a birth, so only birth parents are measured by age.
		if (link.type !== 'biological') continue;
		const parentBirth = birthOf.get(link.parentId) ?? null;
		const childBirth = birthOf.get(link.childId) ?? null;
		const subjects = [person(link.parentId), person(link.childId)];
		const keyIds = [link.parentId, link.childId];
		if (isCertainlyBefore(childBirth, parentBirth)) {
			add(
				'child_before_parent',
				keyIds,
				`${name(link.childId)} was born before their parent ${name(link.parentId)}.`,
				subjects
			);
		} else if (
			childBirth?.latest &&
			parentBirth?.earliest &&
			childBirth.latest < addYears(parentBirth.earliest, MIN_PARENT_AGE_YEARS)
		) {
			add(
				'parent_too_young',
				keyIds,
				`${name(link.parentId)} was under ${MIN_PARENT_AGE_YEARS} when ${name(link.childId)} was born.`,
				subjects
			);
		}
		const parentDeath = deathOf.get(link.parentId) ?? null;
		if (
			parentDeath?.latest &&
			isCertainlyAfter(childBirth, addYears(parentDeath.latest, LATE_BIRTH_GRACE_YEARS))
		) {
			add(
				'child_after_parent_death',
				keyIds,
				`${name(link.childId)} was born more than a year after their parent ${name(link.parentId)} died.`,
				subjects
			);
		}
	}
	for (const [childId, parents] of parentsOfChild) {
		if (parents.size === 1)
			add('one_parent_recorded', [childId], `${name(childId)} has only one parent recorded.`, [
				person(childId)
			]);
	}

	// ---- Possible duplicates ----
	// A finding for a group of people sharing a name, not one for every pair: twenty people called
	// "John Smith" would otherwise be 190 findings. Only people with a dated birth that could match
	// another's are included, so a name alone never raises one.
	const byName = new Map<string, string[]>();
	for (const p of rows.individuals) {
		const key = `${(p.givenName ?? '').trim().toLowerCase()}|${(p.surname ?? '').trim().toLowerCase()}`;
		if (key === '|' || !p.givenName?.trim() || !p.surname?.trim()) continue;
		byName.set(key, [...(byName.get(key) ?? []), p.id]);
	}
	for (const ids of byName.values()) {
		if (ids.length < 2) continue;
		const matched = new Set<string>();
		for (let i = 0; i < ids.length; i++) {
			for (let j = i + 1; j < ids.length; j++) {
				const [a, b] = [birthOf.get(ids[i]!) ?? null, birthOf.get(ids[j]!) ?? null];
				if (!a || !b || isCertainlyBefore(a, b) || isCertainlyBefore(b, a)) continue;
				matched.add(ids[i]!);
				matched.add(ids[j]!);
			}
		}
		if (matched.size < 2) continue;
		const members = [...matched].sort();
		add(
			'possible_duplicate_person',
			members,
			`${members.length} people are called ${name(members[0]!)} and could have been born together.`,
			members.slice(0, MAX_DUPLICATE_SUBJECTS).map(person)
		);
	}

	// ---- Partnerships ----
	const partnersOfUnion = new Map<string, string[]>();
	for (const partner of rows.unionPartners) {
		partnersOfUnion.set(partner.unionId, [
			...(partnersOfUnion.get(partner.unionId) ?? []),
			partner.personId
		]);
	}
	const unionsByPartners = new Map<string, string[]>();
	for (const union of rows.unions) {
		const partners = [...new Set(partnersOfUnion.get(union.id) ?? [])].sort();
		if (partners.length < 2 || !partners.every((id) => people.has(id))) continue;
		const key = partners.join(',');
		unionsByPartners.set(key, [...(unionsByPartners.get(key) ?? []), union.id]);
	}
	for (const [key, ids] of unionsByPartners) {
		if (ids.length < 2) continue;
		const partners = key.split(',');
		add(
			'duplicate_partnership',
			[...ids].sort(),
			`${partners.map(name).join(' and ')} have ${ids.length} partnerships recorded.`,
			ids.map((id) => ({
				kind: 'partnership' as const,
				id,
				name: partners.map(name).join(' and ')
			}))
		);
	}

	// ---- Cycles ----
	for (const cycle of cyclesOf(
		rows.parentChild
			.filter((l) => people.has(l.parentId) && people.has(l.childId))
			.map((l) => [l.parentId, l.childId])
	)) {
		const shown = cycle.slice(0, 5).map(name).join(', ');
		const message =
			cycle.length === 1
				? `${shown} is recorded as their own parent.`
				: `${shown}${cycle.length > 5 ? ` and ${cycle.length - 5} more` : ''} are each other's ancestors.`;
		add('ancestor_cycle', [...cycle].sort(), message, cycle.map(person));
	}

	return findings.sort((a, b) => a.key.localeCompare(b.key));
}

/** Strongly connected sets of parent→child links with more than one person, or one person who is their own parent (Tarjan, iterative). */
export function cyclesOf(edges: ReadonlyArray<readonly [string, string]>): string[][] {
	const next = new Map<string, string[]>();
	for (const [from, to] of edges) next.set(from, [...(next.get(from) ?? []), to]);
	const nodes = new Set(edges.flat());

	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const found: string[][] = [];
	let counter = 0;

	for (const root of [...nodes].sort()) {
		if (index.has(root)) continue;
		const work: Array<{ node: string; children: string[]; at: number }> = [
			{ node: root, children: next.get(root) ?? [], at: 0 }
		];
		index.set(root, counter);
		low.set(root, counter++);
		stack.push(root);
		onStack.add(root);
		while (work.length > 0) {
			const frame = work[work.length - 1]!;
			if (frame.at < frame.children.length) {
				const child = frame.children[frame.at++]!;
				if (!index.has(child)) {
					index.set(child, counter);
					low.set(child, counter++);
					stack.push(child);
					onStack.add(child);
					work.push({ node: child, children: next.get(child) ?? [], at: 0 });
				} else if (onStack.has(child)) {
					low.set(frame.node, Math.min(low.get(frame.node)!, index.get(child)!));
				}
				continue;
			}
			work.pop();
			const parent = work[work.length - 1];
			if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
			if (low.get(frame.node) === index.get(frame.node)) {
				const members: string[] = [];
				let member: string;
				do {
					member = stack.pop()!;
					onStack.delete(member);
					members.push(member);
				} while (member !== frame.node);
				const isSelfLoop =
					members.length === 1 && (next.get(members[0]!) ?? []).includes(members[0]!);
				if (members.length > 1 || isSelfLoop) found.push(members.sort());
			}
		}
	}
	return found.sort((a, b) => a[0]!.localeCompare(b[0]!));
}
