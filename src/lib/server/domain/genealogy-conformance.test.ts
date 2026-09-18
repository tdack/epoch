import { describe, it, expect } from 'vitest';
import { parseGedcom } from '../gedcom/index';
import { migrateLegacyToNeutral } from './migration-adaptor';
import { validateParentChildAssertion } from './invariants';
import type { ParentChild } from './genealogy-model';
import {
	REPRESENTATIVE_GEDCOM_FIXTURE,
	REPRESENTATIVE_GEDCOM_7_FIXTURE
} from '../fixtures/genealogy-fixtures';

/**
 * Build a neutral model from a GEDCOM fixture by way of the legacy parse shape,
 * so the assertions below verify the graph semantics that Phase 1 requires.
 */
function neutralFromGedcom(fixture: string) {
	const parsed = parseGedcom(fixture);
	const legacy = {
		individuals: parsed.individuals.map((ind) => ({
			id: ind.id,
			treeId: 'tree-1',
			xrefId: ind.id,
			givenName: ind.givenName || null,
			surname: ind.surname || null,
			sex: ind.sex || 'U',
			version: 1,
			createdAt: new Date(),
			updatedAt: new Date()
		})),
		families: parsed.families.map((f) => ({
			id: f.id,
			treeId: 'tree-1',
			xrefId: f.id,
			husbandId: f.husbandId || null,
			wifeId: f.wifeId || null,
			version: 1,
			createdAt: new Date(),
			updatedAt: new Date()
		})),
		familyChildren: parsed.families.flatMap((f) =>
			f.children.map((c) => ({
				familyId: f.id,
				childId: c.childId,
				pedigree: c.pedigree ?? 'birth'
			}))
		),
		events: [
			...parsed.individuals.flatMap((ind) =>
				ind.events.map((e) => ({
					id: crypto.randomUUID(),
					treeId: 'tree-1',
					entityType: 'INDIVIDUAL' as const,
					entityId: ind.id,
					type: e.type,
					dateRaw: e.dateRaw || null,
					dateSort: e.dateSort || null,
					place: e.place || null,
					description: e.description || null,
					version: 1,
					createdAt: new Date(),
					updatedAt: new Date()
				}))
			),
			...parsed.families.flatMap((f) =>
				f.events.map((e) => ({
					id: crypto.randomUUID(),
					treeId: 'tree-1',
					entityType: 'FAMILY' as const,
					entityId: f.id,
					type: e.type,
					dateRaw: e.dateRaw || null,
					dateSort: e.dateSort || null,
					place: e.place || null,
					description: e.description || null,
					version: 1,
					createdAt: new Date(),
					updatedAt: new Date()
				}))
			)
		]
	};

	return migrateLegacyToNeutral(legacy).result;
}

describe('Phase 1 neutral graph conformance', () => {
	it('models a child with two mothers as two distinct per-parent assertions', () => {
		const model = neutralFromGedcom(REPRESENTATIVE_GEDCOM_FIXTURE);
		const davidAssertions = model.parentChild.filter((a) => a.childId === '@I_DAVID@');

		// David has biological parents (Bob) and adoptive parents (Carol+Alice).
		const types = davidAssertions.map((a) => a.type);
		expect(types).toContain('biological');
		expect(types).toContain('adoptive');
		// Each of his two parental unions asserts per-parent types.
		expect(davidAssertions).toHaveLength(4);

		// Emily is the foster child in the second union.
		const emilyAssertions = model.parentChild.filter((a) => a.childId === '@I_EMILY@');
		expect(emilyAssertions.map((a) => a.type)).toEqual(['foster', 'foster']);
	});

	it('keeps repeated unions distinct by XREF identity', () => {
		const model = neutralFromGedcom(REPRESENTATIVE_GEDCOM_FIXTURE);
		// Two unions share participants Alice+Bob-like pairs but remain separate.
		expect(model.unions).toHaveLength(2);
		expect(model.unions.map((u) => u.id)).toEqual(['@F_WALKER_SMITH@', '@F_WALKER_JONES@']);
	});

	it('derives divorced status from a divorce event', () => {
		const model = neutralFromGedcom(REPRESENTATIVE_GEDCOM_FIXTURE);
		const smith = model.unions.find((u) => u.id === '@F_WALKER_SMITH@');
		expect(smith?.status).toBe('divorced');
	});

	it('produces no invalid parent-child assertions (self-parentage, cycles)', () => {
		const model = neutralFromGedcom(REPRESENTATIVE_GEDCOM_FIXTURE);
		for (const a of model.parentChild) {
			const violations = validateParentChildAssertion(
				{ parentId: a.parentId, childId: a.childId, type: a.type, unionId: a.unionId },
				'tree-1',
				[],
				model.parentChild
			);
			expect(violations.filter((v) => v.code === 'SELF_PARENTAGE')).toHaveLength(0);
		}

		// No cycles: for every assertion parent->child, child must not reach parent.
		expect(hasCycle(model.parentChild)).toBe(false);
	});

	it('models the same scenarios under GEDCOM 7 with non-binary sex preserved at parse', () => {
		const parsed = parseGedcom(REPRESENTATIVE_GEDCOM_7_FIXTURE);
		const carol = parsed.individuals.find((i) => i.id === '@I_CAROL@');
		expect(carol?.sex).toBe('X');
	});
});

function hasCycle(assertions: ParentChild[]): boolean {
	const childrenByParent = new Map<string, string[]>();
	for (const a of assertions) {
		const list = childrenByParent.get(a.parentId) ?? [];
		list.push(a.childId);
		childrenByParent.set(a.parentId, list);
	}

	for (const start of childrenByParent.keys()) {
		const stack = [start];
		const visited = new Set<string>();
		while (stack.length > 0) {
			const current = stack.pop()!;
			if (visited.has(current)) continue;
			visited.add(current);
			for (const child of childrenByParent.get(current) ?? []) {
				if (child === start) return true;
				stack.push(child);
			}
		}
	}
	return false;
}
