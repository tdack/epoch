import { describe, expect, it } from 'vitest';
import type { Sex } from '../../shared/sex';
import type { ParentChildType } from './genealogy-model';
import { findRelationships, kinLabel, type KinGraph } from './relationship-calculator';

/** `spec`: people as `id:sex`, links as `parent>child[:type]`, partners as `a+b`. */
function graph(spec: { people: string[]; links?: string[]; partners?: string[] }): KinGraph {
	const people = new Map(spec.people.map((p) => {
		const [id, sex] = p.split(':');
		return [id!, { name: id!, sex: (sex as Sex | undefined) ?? null, isPrivate: false }];
	}));
	const links = (spec.links ?? []).map((l) => {
		const [pair, type] = l.split(':');
		const [parentId, childId] = pair!.split('>');
		return { parentId: parentId!, childId: childId!, type: (type ?? 'biological') as ParentChildType };
	});
	const partners = new Map<string, string[]>();
	for (const pair of spec.partners ?? []) {
		const [a, b] = pair.split('+') as [string, string];
		partners.set(a, [...(partners.get(a) ?? []), b]);
		partners.set(b, [...(partners.get(b) ?? []), a]);
	}
	return { people, links, partners };
}
const labels = (g: KinGraph, a: string, b: string) => findRelationships(a, b, g).routes.map((r) => r.label);

describe('kinship words', () => {
	it.each([
		[1, 0, 'M', 'father'],
		[1, 0, null, 'parent'],
		[2, 0, 'F', 'grandmother'],
		[3, 0, 'M', 'great-grandfather'],
		[5, 0, null, 'great-great-great-grandparent'],
		[0, 1, 'F', 'daughter'],
		[0, 3, null, 'great-grandchild'],
		[1, 1, 'F', 'sister'],
		[1, 2, 'M', 'nephew'],
		[1, 3, 'F', 'grandniece'],
		[1, 4, 'M', 'great-grandnephew'],
		[1, 3, null, "sibling's grandchild"],
		[2, 1, 'F', 'aunt'],
		[3, 1, 'M', 'great-uncle'],
		[2, 1, null, "parent's sibling"],
		[2, 2, null, '1st cousin'],
		[3, 3, null, '2nd cousin'],
		[3, 2, null, '1st cousin once removed'],
		[4, 2, null, '1st cousin twice removed'],
		[5, 2, null, '1st cousin 3 times removed'],
		[12, 12, null, '11th cousin'],
		[22, 22, null, '21st cousin']
	] as const)('%i up and %i down, sex %s: %s', (up, down, sex, expected) => {
		expect(kinLabel(up, down, sex)).toBe(expected);
	});
	it('says half only for siblings that share one parent', () => {
		expect(kinLabel(1, 1, 'M', false)).toBe('half-brother');
	});
});

const FAMILY = graph({
	people: ['gp1:M', 'gp2:F', 'dad:M', 'unc:M', 'mum:F', 'me', 'sis:F', 'cuz', 'kid:F', 'gkid'],
	links: ['gp1>dad', 'gp2>dad', 'gp1>unc', 'gp2>unc', 'dad>me', 'mum>me', 'dad>sis', 'mum>sis', 'unc>cuz', 'me>kid', 'kid>gkid'],
	partners: ['gp1+gp2', 'dad+mum']
});

describe('blood relationships', () => {
	it('names the nearest first and says the same person for no distance', () => {
		expect(labels(FAMILY, 'me', 'me')).toEqual(['the same person']);
		expect(labels(FAMILY, 'me', 'dad')).toEqual(['father']);
		expect(labels(FAMILY, 'me', 'gp1')).toEqual(['grandfather']);
		expect(labels(FAMILY, 'me', 'kid')).toEqual(['daughter']);
		expect(labels(FAMILY, 'me', 'gkid')).toEqual(['grandchild']);
		expect(labels(FAMILY, 'gkid', 'gp2')).toEqual(['great-great-grandmother']);
	});
	it('finds siblings, aunts and uncles, cousins and nieces from either end', () => {
		expect(labels(FAMILY, 'me', 'sis')).toEqual(['sister']);
		expect(labels(FAMILY, 'me', 'unc')).toEqual(['uncle']);
		expect(labels(FAMILY, 'unc', 'me')).toEqual(["sibling's child"]);
		expect(labels(FAMILY, 'me', 'cuz')).toEqual(['1st cousin']);
		expect(labels(FAMILY, 'kid', 'cuz')).toEqual(['1st cousin once removed']);
		expect(labels(FAMILY, 'cuz', 'gkid')).toEqual(['1st cousin twice removed']);
	});
	it('lists the steps from the first person up to the ancestor and down to the second', () => {
		const [route] = findRelationships('me', 'cuz', FAMILY).routes;
		expect(route!.steps.map((s) => [s.personId, s.relation])).toEqual([['me', null], ['dad', 'parent'], ['gp1', 'parent'], ['unc', 'child'], ['cuz', 'child']]);
		expect(route!.viaIds.sort()).toEqual(['gp1', 'gp2']);
	});
	it('reports a couple as one route, and a single shared parent as a half-sibling', () => {
		expect(findRelationships('me', 'sis', FAMILY).routes).toHaveLength(1);
		const half = graph({ people: ['a', 'b:F', 'p', 'q', 'r'], links: ['p>a', 'q>a', 'p>b', 'r>b'] });
		expect(labels(half, 'a', 'b')).toEqual(['half-sister']);
	});
	it('reports every route, so a double cousin or a pedigree loop is not hidden', () => {
		const double = graph({
			people: ['g1', 'g2', 'h1', 'h2', 's1', 's2', 't1', 't2', 'x', 'y'],
			links: ['g1>s1', 'g2>s1', 'g1>s2', 'g2>s2', 'h1>t1', 'h2>t1', 'h1>t2', 'h2>t2', 's1>x', 't1>x', 's2>y', 't2>y']
		});
		const result = findRelationships('x', 'y', double).routes;
		expect(result.map((r) => r.label)).toEqual(['1st cousin', '1st cousin']);
		expect(result.map((r) => r.viaIds.sort().join('+')).sort()).toEqual(['g1+g2', 'h1+h2']);
	});
	it('says when a link is not biological', () => {
		const adopted = graph({ people: ['kid', 'mum:F'], links: ['mum>kid:adoptive'] });
		const [route] = findRelationships('kid', 'mum', adopted).routes;
		expect(route!.label).toBe('mother');
		expect(route!.nonBiologicalTypes).toEqual(['adoptive']);
		expect(route!.steps[1]!.linkType).toBe('adoptive');
	});
	it('ignores an ancestor above a lower common one', () => {
		expect(findRelationships('me', 'sis', FAMILY).routes.every((r) => !r.viaIds.includes('gp1'))).toBe(true);
	});
	it('finds nothing for unrelated people and does not say it was cut short', () => {
		const apart = graph({ people: ['a', 'b'] });
		expect(findRelationships('a', 'b', apart)).toEqual({ routes: [], isIncomplete: false });
	});
});

describe('partners', () => {
	it('lists a partnership as its own route, then any blood route as well', () => {
		expect(labels(FAMILY, 'dad', 'mum')).toEqual(['partner']);
		const cousins = graph({ people: ['gp', 'a', 'b', 'x', 'y'], links: ['gp>a', 'gp>b', 'a>x', 'b>y'], partners: ['x+y'] });
		expect(labels(cousins, 'x', 'y')).toEqual(['partner', '1st cousin']);
	});
	it('offers a relative of a partner, or a partner of a relative, only when there is no blood route', () => {
		expect(labels(FAMILY, 'me', 'mum')).toEqual(['mother']);
		expect(labels(FAMILY, 'sis', 'gp1')).toEqual(['grandfather']);
		const g = graph({
			people: ['me', 'mum:F', 'step:M', 'bro', 'wife:F', 'sibwife:F'],
			links: ['mum>me', 'mum>bro'],
			partners: ['mum+step', 'bro+wife', 'me+sibwife']
		});
		expect(labels(g, 'me', 'step')).toEqual(['step-parent']);
		expect(labels(g, 'me', 'wife')).toEqual(['sibling-in-law']);
		expect(labels(g, 'sibwife', 'mum')).toEqual(['parent-in-law']);
		expect(labels(g, 'sibwife', 'bro')).toEqual(['sibling-in-law']);
		expect(labels(g, 'mum', 'sibwife')).toEqual(['child-in-law']);
		expect(findRelationships('me', 'step', g).routes[0]!.steps.map((s) => s.relation)).toEqual([null, 'parent', 'partner']);
	});
	it('calls a partner\'s child a step-child', () => {
		const g = graph({ people: ['a', 'b', 'kid'], links: ['b>kid'], partners: ['a+b'] });
		expect(labels(g, 'a', 'kid')).toEqual(['step-child']);
	});
});
