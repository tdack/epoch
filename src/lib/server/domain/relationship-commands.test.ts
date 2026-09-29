import { describe, it, expect } from 'vitest';
import { ValidationError } from './errors';
import { planRelationshipCommand, type PlanContext } from './relationship-commands';
import { sequentialIds, treeRows, type RowsSpec } from '../testing/rows';

const alex = { id: 'p-alex', givenName: 'Alex', surname: 'Walker' };
const sam = { id: 'p-sam', givenName: 'Sam', surname: 'Smith' };
const other = { id: 'p-other', givenName: 'Robin', surname: 'Reed' };

function context(spec: RowsSpec = {}, overrides: Partial<PlanContext> = {}): PlanContext {
	const people = [alex, sam, other].map((p) => ({ ...p, sex: 'U' as const }));
	return { rows: treeRows({ people, ...spec }), hasDuplicateName: false, newId: sequentialIds(), ...overrides };
}

describe('planRelationshipCommand', () => {
	it('plans an add_parent as an assert_parent_child command', () => {
		const plan = planRelationshipCommand(
			{ kind: 'add_parent', child: sam, parent: alex, type: 'adoptive', role: 'mother', unionLabel: null },
			context()
		);
		expect(plan.commands).toEqual([
			{ kind: 'assert_parent_child', parentId: 'p-alex', childId: 'p-sam', type: 'adoptive', unionId: null }
		]);
		expect(plan.sentence).toBe("Alex Walker will be recorded as Sam Smith's adoptive mother.");
	});

	it('creates a new parent in the same plan and links to them', () => {
		const plan = planRelationshipCommand(
			{
				kind: 'add_parent',
				child: sam,
				parent: { id: 'new', givenName: 'Nia', surname: 'Novak', isNew: true },
				type: 'biological',
				role: 'parent',
				unionLabel: null
			},
			context()
		);
		expect(plan.commands).toMatchObject([
			{ kind: 'create_person', personId: 'id-1', givenName: 'Nia', surname: 'Novak' },
			{ kind: 'assert_parent_child', parentId: 'id-1', childId: 'p-sam' }
		]);
	});

	it('plans an add_partner as a create_union command when no union exists', () => {
		const plan = planRelationshipCommand({ kind: 'add_partner', person: alex, partner: sam, unionLabel: null }, context());
		expect(plan.commands).toEqual([{ kind: 'create_union', unionId: 'id-1', personIds: ['p-alex', 'p-sam'] }]);
	});

	it('completes a partnership that is waiting for its other partner', () => {
		const plan = planRelationshipCommand(
			{ kind: 'add_partner', person: alex, partner: sam, unionLabel: null },
			context({ unions: [{ id: 'u1', partners: ['p-alex'] }] })
		);
		expect(plan.commands).toEqual([{ kind: 'add_partner_to_union', unionId: 'u1', personId: 'p-sam' }]);
	});

	it('starts a new partnership rather than adding a third person to a full one', () => {
		const plan = planRelationshipCommand(
			{ kind: 'add_partner', person: alex, partner: sam, unionLabel: null },
			context({ unions: [{ id: 'u1', partners: ['p-alex', 'p-other'] }] })
		);
		expect(plan.commands).toEqual([{ kind: 'create_union', unionId: 'id-1', personIds: ['p-alex', 'p-sam'] }]);
	});

	it('warns when the two people are already partners', () => {
		const plan = planRelationshipCommand(
			{ kind: 'add_partner', person: alex, partner: sam, unionLabel: null },
			context({ unions: [{ id: 'u1', partners: ['p-alex', 'p-sam'] }] })
		);
		expect(plan.commands).toHaveLength(0);
		expect(plan.warnings.some((w) => w.code === 'ALREADY_PARTNERS')).toBe(true);
	});

	it('lets a pair whose partnership ended partner again, as a second partnership', () => {
		const intent = { kind: 'add_partner', person: alex, partner: sam, unionLabel: null } as const;
		for (const status of ['divorced', 'separated', 'annulled', 'ended'] as const) {
			const plan = planRelationshipCommand(intent, context({ unions: [{ id: 'u1', partners: ['p-alex', 'p-sam'], status }] }));
			expect(plan.commands, status).toEqual([{ kind: 'create_union', unionId: 'id-1', personIds: ['p-alex', 'p-sam'] }]);
			expect(plan.warnings.map((w) => w.code)).not.toContain('ALREADY_PARTNERS');
		}
	});

	it('still refuses a second partnership while the first is active', () => {
		const plan = planRelationshipCommand(
			{ kind: 'add_partner', person: alex, partner: sam, unionLabel: null },
			context({ unions: [{ id: 'u1', partners: ['p-alex', 'p-sam'], status: 'active' }] })
		);
		expect(plan.commands).toHaveLength(0);
	});

	it('reuses the parent’s existing union when adding a child and names the family', () => {
		const plan = planRelationshipCommand(
			{ kind: 'add_child', parent: alex, child: sam, type: 'biological', unionLabel: null },
			context({ unions: [{ id: 'u1', partners: ['p-alex', 'p-other'] }] })
		);
		expect(plan.commands[0]).toMatchObject({ kind: 'assert_parent_child', unionId: 'u1' });
		expect(plan.sentence).toBe("Sam Smith will be recorded as Alex Walker's biological child in the Alex Walker–Robin Reed family.");
	});

	describe('changing the type of a parent link', () => {
		const withLink = (type = 'biological' as const) => context({ links: [{ parentId: 'p-alex', childId: 'p-sam', type }] });
		const change = (toType: 'biological' | 'adoptive' | 'foster' | 'guardian' | 'unknown', fromType: 'biological' | 'adoptive' = 'biological') =>
			({ kind: 'change_link_type', parent: alex, child: sam, fromType, toType }) as const;

		it('plans one command and says what changes', () => {
			const plan = planRelationshipCommand(change('adoptive'), withLink());
			expect(plan.commands).toEqual([{ kind: 'change_parent_child_type', parentId: 'p-alex', childId: 'p-sam', fromType: 'biological', toType: 'adoptive' }]);
			expect(plan.sentence).toBe("Alex Walker will be recorded as Sam Smith's adoptive parent instead of biological parent.");
		});

		it('plans nothing, with a reason, when the type is unchanged or already recorded', () => {
			expect(planRelationshipCommand(change('biological'), withLink()).warnings.map((w) => w.code)).toEqual(['TYPE_UNCHANGED']);
			const both = context({
				links: [
					{ parentId: 'p-alex', childId: 'p-sam', type: 'biological' },
					{ parentId: 'p-alex', childId: 'p-sam', type: 'adoptive' }
				]
			});
			const plan = planRelationshipCommand(change('adoptive'), both);
			expect(plan.commands).toHaveLength(0);
			expect(plan.warnings.map((w) => w.code)).toEqual(['TYPE_ALREADY_RECORDED']);
		});

		it('refuses a link that is not there', () => {
			expect(() => planRelationshipCommand(change('adoptive'), context())).toThrow(ValidationError);
		});
	});

	describe('choosing among several partnerships', () => {
		const third = { id: 'p-third', givenName: 'Third', surname: 'Thorn' };
		const two = context({
			people: [alex, sam, other, third],
			unions: [
				{ id: 'u1', partners: ['p-alex', 'p-other'] },
				{ id: 'u2', partners: ['p-alex', 'p-third'] }
			],
			links: [{ parentId: 'p-alex', childId: 'p-third', unionId: 'u2' }]
		});
		const addChild = (unionId?: string | null) =>
			planRelationshipCommand({ kind: 'add_child', parent: alex, child: sam, type: 'biological', unionLabel: null, unionId }, two);

		it('defaults to the fullest partnership and says why', () => {
			const plan = addChild();
			expect(plan.commands[0]).toMatchObject({ unionId: 'u2' });
			expect(plan.unionChoice).toMatchObject({ unionId: 'u2', isDefault: true });
			expect(plan.unionChoice?.reason).toContain('most children');
			expect(plan.warnings.some((w) => w.code === 'MULTIPLE_UNIONS')).toBe(false);
		});

		it('honours a named partnership, even an empty one, without a reason', () => {
			const plan = addChild('u1');
			expect(plan.commands[0]).toMatchObject({ unionId: 'u1' });
			expect(plan.unionChoice).toEqual({ unionId: 'u1', isDefault: false, reason: null });
		});

		it('refuses a partnership the parent is not in', () => {
			const foreign = context({
				unions: [
					{ id: 'u1', partners: ['p-alex', 'p-other'] },
					{ id: 'u2', partners: ['p-sam', 'p-other'] }
				]
			});
			expect(() =>
				planRelationshipCommand({ kind: 'add_child', parent: alex, child: sam, type: 'biological', unionLabel: null, unionId: 'u2' }, foreign)
			).toThrow(/does not include this parent/);
			expect(() =>
				planRelationshipCommand({ kind: 'add_child', parent: alex, child: sam, type: 'biological', unionLabel: null, unionId: 'nope' }, foreign)
			).toThrow(ValidationError);
		});

		it('names a repeated partnership by chronology in the sentence', () => {
			const twins = context({
				unions: [
					{ id: 'u1', partners: ['p-alex', 'p-other'], marriage: '1990' },
					{ id: 'u2', partners: ['p-alex', 'p-other'], marriage: '2005' }
				]
			});
			const plan = planRelationshipCommand(
				{ kind: 'add_child', parent: alex, child: sam, type: 'biological', unionLabel: null, unionId: 'u2' },
				twins
			);
			expect(plan.sentence).toBe(
				"Sam Smith will be recorded as Alex Walker's biological child in the 2nd partnership of Alex Walker and Robin Reed."
			);
		});

		it('treats an explicit null as a single-parent record', () => {
			const plan = addChild(null);
			expect(plan.commands[0]).toMatchObject({ unionId: null });
		});

		it('lets add_parent pick among the child’s parental families and refuses others', () => {
			const parental = context({
				people: [alex, sam, other, third],
				unions: [
					{ id: 'u1', partners: ['p-other'] },
					{ id: 'u2', partners: ['p-third'] },
					{ id: 'u3', partners: ['p-alex'] }
				],
				links: [
					{ parentId: 'p-other', childId: 'p-sam', unionId: 'u1' },
					{ parentId: 'p-third', childId: 'p-sam', unionId: 'u2' }
				]
			});
			const intent = { kind: 'add_parent', child: sam, parent: alex, type: 'biological', role: 'parent', unionLabel: null } as const;
			expect(planRelationshipCommand({ ...intent, unionId: 'u2' }, parental).commands[0]).toMatchObject({ unionId: 'u2' });
			expect(planRelationshipCommand(intent, parental).unionChoice?.isDefault).toBe(true);
			expect(() => planRelationshipCommand({ ...intent, unionId: 'u3' }, parental)).toThrow(/parental families/);
		});

		it('lets add_partner fill a chosen waiting partnership, or start a new one', () => {
			const waiting = context({
				people: [alex, sam, other, third],
				unions: [
					{ id: 'u1', partners: ['p-alex'] },
					{ id: 'u2', partners: ['p-alex'] }
				],
				links: [{ parentId: 'p-alex', childId: 'p-third', unionId: 'u2' }]
			});
			const intent = { kind: 'add_partner', person: alex, partner: sam, unionLabel: null } as const;
			expect(planRelationshipCommand(intent, waiting).commands).toEqual([{ kind: 'add_partner_to_union', unionId: 'u2', personId: 'p-sam' }]);
			expect(planRelationshipCommand({ ...intent, unionId: 'u1' }, waiting).commands).toEqual([{ kind: 'add_partner_to_union', unionId: 'u1', personId: 'p-sam' }]);
			expect(planRelationshipCommand({ ...intent, unionId: null }, waiting).commands).toMatchObject([{ kind: 'create_union' }]);
			expect(() => planRelationshipCommand({ ...intent, unionId: 'u9' }, waiting)).toThrow(/waiting for a partner/);
		});
	});

	it('reuses the child’s existing union when adding a parent', () => {
		const plan = planRelationshipCommand(
			{ kind: 'add_parent', child: sam, parent: alex, type: 'adoptive', role: 'mother', unionLabel: null },
			context({ unions: [{ id: 'u1', partners: ['p-other'] }], links: [{ parentId: 'p-other', childId: 'p-sam', unionId: 'u1' }] })
		);
		expect(plan.commands[0]).toMatchObject({ kind: 'assert_parent_child', unionId: 'u1' });
	});

	it('flags a duplicate-name warning', () => {
		const plan = planRelationshipCommand(
			{ kind: 'add_parent', child: sam, parent: alex, type: 'biological', role: 'parent', unionLabel: null },
			context({}, { hasDuplicateName: true })
		);
		expect(plan.warnings.some((w) => w.code === 'DUPLICATE_PERSON')).toBe(true);
	});

	it('flags a cycle warning when the assertion would close a loop', () => {
		const plan = planRelationshipCommand(
			{ kind: 'add_parent', child: alex, parent: sam, type: 'biological', role: 'parent', unionLabel: null },
			context({ links: [{ parentId: 'p-alex', childId: 'p-sam' }] })
		);
		expect(plan.warnings.some((w) => w.code === 'CYCLE')).toBe(true);
	});

	describe('record_death', () => {
		const death = { kind: 'record_death', person: alex, dateText: '3 MAR 2001', place: 'Brisbane' } as const;

		it('plans one record_death command carrying the date and place', () => {
			const plan = planRelationshipCommand(death, context());
			expect(plan.commands).toEqual([
				{ kind: 'record_death', personId: 'p-alex', dateText: '3 MAR 2001', place: 'Brisbane', expectedVersion: undefined }
			]);
		});

		it('says who becomes widowed, per union that has not ended', () => {
			const plan = planRelationshipCommand(
				death,
				context({
					unions: [
						{ id: 'u1', partners: ['p-alex', 'p-sam'] },
						{ id: 'u2', partners: ['p-alex', 'p-other'], status: 'divorced' }
					]
				})
			);
			expect(plan.sentence).toBe(
				'Alex Walker will be recorded as deceased (3 MAR 2001, Brisbane). Sam Smith will be shown as widowed in their partnership with Alex Walker.'
			);
		});

		it('does not widow a partner who has already died', () => {
			const plan = planRelationshipCommand(
				death,
				context({ people: [alex, { ...sam, death: '1990' }], unions: [{ id: 'u1', partners: ['p-alex', 'p-sam'] }] })
			);
			expect(plan.sentence).not.toContain('widowed');
		});

		it('warns, without blocking, about an existing death and a death before the birth', () => {
			const plan = planRelationshipCommand(
				{ ...death, dateText: '1950' },
				context({ people: [{ ...alex, birth: '1960', death: '1970' }] })
			);
			expect(plan.commands).toHaveLength(1);
			expect(plan.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['ALREADY_DECEASED', 'DEATH_BEFORE_BIRTH']));
		});
	});

	describe('end_union', () => {
		const divorce = {
			kind: 'end_union',
			person: alex,
			unionId: 'u1',
			status: 'divorced',
			event: { type: 'DIV', dateText: '12 MAR 1999', place: 'Sydney' }
		} as const;

		it('plans an end_union command for the chosen partnership', () => {
			const plan = planRelationshipCommand(divorce, context({ unions: [{ id: 'u1', partners: ['p-alex', 'p-sam'] }] }));
			expect(plan.commands).toEqual([
				{
					kind: 'end_union',
					unionId: 'u1',
					status: 'divorced',
					event: { type: 'DIV', dateText: '12 MAR 1999', place: 'Sydney' },
					expectedVersion: undefined
				}
			]);
			expect(plan.sentence).toBe(
				'The partnership between Alex Walker and Sam Smith will be recorded as divorced (12 MAR 1999, Sydney).'
			);
		});

		it('asks for a choice, and plans nothing, when the person has several partnerships and none was chosen', () => {
			const plan = planRelationshipCommand(
				{ ...divorce, unionId: null },
				context({
					unions: [
						{ id: 'u1', partners: ['p-alex', 'p-sam'] },
						{ id: 'u2', partners: ['p-alex', 'p-other'] }
					]
				})
			);
			expect(plan.commands).toHaveLength(0);
			expect(plan.warnings.some((w) => w.code === 'MULTIPLE_UNIONS')).toBe(true);
		});

		it('picks the only partnership without asking', () => {
			const plan = planRelationshipCommand({ ...divorce, unionId: null }, context({ unions: [{ id: 'u9', partners: ['p-alex', 'p-sam'] }] }));
			expect(plan.commands[0]).toMatchObject({ unionId: 'u9' });
		});

		it('refuses a partnership the person is not in', () => {
			const plan = planRelationshipCommand(divorce, context({ unions: [{ id: 'u1', partners: ['p-sam', 'p-other'] }] }));
			expect(plan.commands).toHaveLength(0);
			expect(plan.warnings.some((w) => w.code === 'NO_UNION')).toBe(true);
		});

		it('warns, without blocking, when the end is dated before the marriage or the union already ended', () => {
			const plan = planRelationshipCommand(
				{ ...divorce, event: { type: 'DIV', dateText: '1990', place: null } },
				context({ unions: [{ id: 'u1', partners: ['p-alex', 'p-sam'], status: 'divorced', marriage: '1995' }] })
			);
			expect(plan.commands).toHaveLength(1);
			expect(plan.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['END_BEFORE_START', 'UNION_ALREADY_ENDED']));
		});
	});
});
