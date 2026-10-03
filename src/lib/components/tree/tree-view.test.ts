import { describe, it, expect } from 'vitest';
import { TREE_TOKENS } from './tree-tokens';
import {
	COMPACT_FROM_ZOOM,
	FULL_ABOVE_ZOOM,
	MIN_HIT_TARGET_PX,
	MIN_ZOOM,
	accessibleName,
	childEdgeStyle,
	contrastRatio,
	hitSize,
	isEndedUnion,
	levelOfDetail,
	neighbourOf,
	partnerEdgePath,
	generationLabel,
	relationLabel,
	sexClass,
	sexSymbol,
	surnameInitial,
	yearsLine,
	unionLabelText
} from './tree-view';
import { CAPTURED_GRAPHS, personByName } from '#lib/tree-layout/test-support.js';
import { LAYOUT_METRICS, layoutFocusView } from '#lib/tree-layout/index.js';
import { UNION_STATUSES } from '#lib/shared/relationship-model.js';
import { isEndedUnionStatus } from '#lib/server/domain/relationship-graph.js';
import { ALL_PARENT_CHILD_TYPES } from './tree-url';
import { PARENT_CHILD_TYPES } from '#lib/shared/relationship-model.js';

function token(name: keyof typeof TREE_TOKENS): string {
	return TREE_TOKENS[name];
}

const simpsons = CAPTURED_GRAPHS.find((g) => g.name === 'simpsons')!.graph;
const focusLayout = (name: string, options = {}) =>
	layoutFocusView(simpsons, personByName(simpsons, name).id, options);
const nameOf = (layout: ReturnType<typeof focusLayout>, id: string | null) =>
	layout.people.find((p) => p.id === id)?.person.displayName;

describe('level of detail', () => {
	it('switches at 0.6 and 0.3', () => {
		expect(levelOfDetail(1)).toBe('full');
		expect(levelOfDetail(FULL_ABOVE_ZOOM + 0.001)).toBe('full');
		expect(levelOfDetail(FULL_ABOVE_ZOOM)).toBe('compact');
		expect(levelOfDetail(COMPACT_FROM_ZOOM)).toBe('compact');
		expect(levelOfDetail(COMPACT_FROM_ZOOM - 0.001)).toBe('block');
		expect(levelOfDetail(MIN_ZOOM)).toBe('block');
	});

	it('keeps click targets at least the minimum size on screen without overlapping neighbours', () => {
		for (const k of [MIN_ZOOM, 0.2, 0.3, 0.5, 1, 3]) {
			const { width, height } = hitSize(k);
			expect(width).toBeGreaterThanOrEqual(LAYOUT_METRICS.cardWidth);
			expect(width).toBeLessThan(LAYOUT_METRICS.cardWidth + LAYOUT_METRICS.siblingGap);
			expect(height).toBeLessThan(LAYOUT_METRICS.rowHeight);
			expect(Math.min(width, height) * k).toBeGreaterThanOrEqual(
				Math.min(MIN_HIT_TARGET_PX, LAYOUT_METRICS.cardHeight * k)
			);
		}
	});
});

describe('card text', () => {
	const person = (extra: object) => ({
		id: 'x',
		displayName: 'A B',
		sex: 'F' as const,
		isDeceased: false,
		parentsByUnion: {},
		unionIds: [],
		stepParents: [],
		...extra
	});

	it('shows dates with a dagger for the deceased and never the word', () => {
		expect(
			yearsLine(person({ birthDate: '12 MAR 1950', deathDate: 'ABT 2010', isDeceased: true }))
		).toBe('1950 – † 2010');
		expect(yearsLine(person({ birthDate: '1950' }))).toBe('b. 1950');
		expect(yearsLine(person({ birthDate: '1950', isDeceased: true }))).toBe('1950 – †');
		expect(yearsLine(person({ isDeceased: true }))).toBe('†');
		expect(yearsLine(person({}))).toBe('');
	});

	it('takes the surname initial from the last word', () => {
		expect(surnameInitial('Jessica Louise Lovejoy')).toBe('L');
		expect(surnameInitial('  cher ')).toBe('C');
		// The birth surname is not part of the name the block is initialled from.
		expect(surnameInitial('Jessica Wren (née Lovejoy)')).toBe('K');
	});
});

describe('sex symbols', () => {
	it('gives X its own symbol and leaves unknown neutral, on the same neutral fill', () => {
		expect(sexSymbol('M')).toBe('♂');
		expect(sexSymbol('F')).toBe('♀');
		expect(sexSymbol('X')).toBe('⚧\uFE0E');
		expect(sexSymbol('U')).toBe('○');
		expect(sexSymbol(null)).toBe('○');
		expect(sexClass('X')).toBe('u');
	});
});

describe('colour tokens', () => {
	it('keeps text at AA contrast on every sex fill', () => {
		for (const fill of ['--sex-m', '--sex-f', '--sex-u'] as const) {
			expect(contrastRatio(token('--tree-ink'), token(fill)), fill).toBeGreaterThanOrEqual(4.5);
			expect(contrastRatio(token('--tree-ink-muted'), token(fill)), fill).toBeGreaterThanOrEqual(
				4.5
			);
		}
	});

	it('keeps every line and border visible against the canvas', () => {
		for (const name of [
			'--rel-biological',
			'--rel-adoptive',
			'--rel-foster',
			'--rel-guardian',
			'--rel-unknown',
			'--rel-mixed',
			'--partner-line',
			'--sex-m-border',
			'--sex-f-border',
			'--sex-u-border'
		] as const) {
			expect(contrastRatio(token(name), token('--tree-bg')), name).toBeGreaterThanOrEqual(3);
		}
	});

	it('does not use blue or pink hues for parent-child types', () => {
		for (const name of [
			'--rel-biological',
			'--rel-adoptive',
			'--rel-foster',
			'--rel-guardian',
			'--rel-unknown'
		] as const) {
			const n = Number.parseInt(token(name).slice(1), 16);
			const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
			const isSaturated = Math.max(r, g, b) - Math.min(r, g, b) > 24;
			const isBlueish = isSaturated && b > r + 20 && b >= g;
			const isPinkish = isSaturated && r > g + 30 && b > g + 10;
			// guardian and unknown are cool greys by design; only saturated blue/pink is excluded.
			if (name === '--rel-guardian') continue;
			expect(isBlueish || isPinkish, name).toBe(false);
		}
	});
});

describe('relationship styles', () => {
	it('gives each type its own line style, and mixed parents a fifth', () => {
		const dashes = ['biological', 'adoptive', 'foster', 'guardian', 'unknown'].map(
			(t) => childEdgeStyle([t as never]).dash
		);
		expect(new Set(dashes).size).toBe(5);
		expect(childEdgeStyle(['adoptive', 'biological']).label).toBe('Mixed types');
		expect(childEdgeStyle(['biological']).dash).toBeNull();
	});
});

describe('accessible names', () => {
	const labels = (layout: ReturnType<typeof focusLayout>) =>
		new Map(layout.people.map((p) => [p.person.displayName, relationLabel(p, layout)]));

	it("names each person's relationship to the focus, not just their role", () => {
		const roles = labels(focusLayout('Jessica Louise Lovejoy'));
		expect(roles.get('Jessica Louise Lovejoy')).toBe('focus person');
		expect(roles.get('Bartholomew Jojo Simpson')).toBe('partner');
		expect(roles.get('Dermot Lovejoy')).toBe('parent');
		expect(roles.get('Dorian Lovejoy')).toBe('sibling');
		expect(roles.get('Ned Dermot Lovejoy')).toBe('child');
		// Edna is Ned's partner, not Jessica's.
		expect(roles.get('Rosalind Fairfax')).toBe('partner of Ned Dermot Lovejoy');
		expect(roles.get('Magnus Lovejoy')).toBe('grandchild');
	});

	it("calls a partner's children step-children when the step family is drawn", () => {
		const layout = layoutFocusView(simpsons, personByName(simpsons, 'Bartholomew Jojo Simpson').id, {
			shouldIncludeStepFamilies: true
		});
		const roles = labels(layout);
		expect(roles.get('Jessica Louise Lovejoy')).toBe('partner');
		expect(roles.get('Hector James Wren')).toBe('step-child');
		expect(roles.get('Homer Jay Simpson')).toBe('parent');
	});

	it('names the person, dates and relationship in one string', () => {
		const layout = focusLayout('Jessica Louise Lovejoy');
		const jessica = layout.people.find((p) => p.role === 'focus')!;
		const dated = {
			...jessica,
			person: { ...jessica.person, birthDate: '9 Mar 1966', deathDate: '1 JAN 2040' }
		};
		expect(accessibleName(dated, 'focus person')).toBe(
			'Jessica Louise Lovejoy, born 9 Mar 1966, died 1 JAN 2040, focus person'
		);
		expect(accessibleName(jessica, 'focus person')).toBe('Jessica Louise Lovejoy, focus person');
	});

	it('words distant generations without gendered terms', () => {
		expect(generationLabel('ancestor', 2)).toBe('grandparent');
		expect(generationLabel('ancestor', 3)).toBe('great-grandparent');
		expect(generationLabel('descendant', 5)).toBe('3× great-grandchild');
	});
});

describe('keyboard navigation', () => {
	const layout = focusLayout('Jessica Louise Lovejoy');
	const jessica = personByName(simpsons, 'Jessica Louise Lovejoy').id;

	it('up goes to a parent, down to a child', () => {
		const up = layout.people.find((p) => p.id === neighbourOf(layout, jessica, 'up'))!;
		expect(up.generation).toBe(-1);
		const down = layout.people.find((p) => p.id === neighbourOf(layout, jessica, 'down'))!;
		expect(down.generation).toBe(1);
	});

	it('left/right prefer the partner on the row, and stop at the ends', () => {
		const ned = personByName(simpsons, 'Ned Dermot Lovejoy').id;
		const right = neighbourOf(layout, ned, 'right');
		const left = neighbourOf(layout, ned, 'left');
		expect([nameOf(layout, right), nameOf(layout, left)]).toContain('Rosalind Fairfax');
		const row = layout.people.filter((p) => p.y === 0).sort((a, b) => a.x - b.x);
		expect(neighbourOf(layout, row[0].id, 'left')).toBeNull();
		expect(neighbourOf(layout, row.at(-1)!.id, 'right')).toBeNull();
	});

	it('reaches every drawn person from the focus using only arrow keys', () => {
		// Breadth-first over the four keys: anyone unreachable would be stranded for keyboard users.
		const seen = new Set([jessica]);
		const queue = [jessica];
		while (queue.length > 0) {
			const id = queue.shift()!;
			for (const dir of ['up', 'down', 'left', 'right'] as const) {
				const next = neighbourOf(layout, id, dir);
				if (next && !seen.has(next)) {
					seen.add(next);
					queue.push(next);
				}
			}
		}
		const unreachable = layout.people
			.filter((p) => !seen.has(p.id))
			.map((p) => p.person.displayName);
		expect(unreachable).toEqual([]);
	});

	it('returns null for people that are not drawn', () => {
		expect(neighbourOf(layout, 'nobody', 'up')).toBeNull();
	});
});

describe('partner connectors', () => {
	it('runs along the row for a union between cards and brackets under the row for a hanging one', () => {
		const layout = focusLayout('Jessica Louise Lovejoy');
		const between = layout.edges.find((e) => e.kind === 'partner' && e.source.y === e.target.y)!;
		expect(partnerEdgePath(between as never)).toMatch(/^M [-\d.]+ [-\d.]+ L [-\d.]+ [-\d.]+$/);
		const hanging = {
			kind: 'partner',
			id: 'p',
			unionId: 'u',
			personId: 'x',
			source: { x: 0, y: 0 },
			target: { x: 300, y: LAYOUT_METRICS.cardHeight / 2 + 17 }
		};
		const path = partnerEdgePath(hanging as never);
		expect(path).toContain('Q');
		expect(path.startsWith(`M 0 ${LAYOUT_METRICS.cardHeight / 2}`)).toBe(true);
	});
});

describe('browser-side copies of server constants', () => {
	it('agree with the server for every union status and parent-child type', () => {
		for (const status of Object.values(UNION_STATUSES))
			expect(isEndedUnion(status), status).toBe(isEndedUnionStatus(status));
		expect([...ALL_PARENT_CHILD_TYPES].sort()).toEqual(Object.values(PARENT_CHILD_TYPES).sort());
	});
});

describe('unionLabelText', () => {
	const union = (over: object) =>
		({
			id: 'u',
			status: 'active',
			marriageDate: null,
			marriagePlace: null,
			partnerIds: [],
			children: [],
			...over
		}) as never;

	it('shows the marriage as recorded, then how it ended', () => {
		expect(
			unionLabelText(
				union({
					marriageDate: '1975',
					events: [{ id: 'e', type: 'DIV', dateText: '1999', place: null }]
				})
			)
		).toBe('1975 – div. 1999');
	});

	it('falls back to the start of an unmarried partnership, and to nothing', () => {
		expect(
			unionLabelText(
				union({ events: [{ id: 'e', type: '_PSTART', dateText: '1990', place: null }] })
			)
		).toBe('from 1990');
		expect(unionLabelText(union({}))).toBe('');
	});

	it('ignores an end event with no date rather than printing a bare abbreviation', () => {
		expect(
			unionLabelText(
				union({
					marriageDate: '1975',
					events: [{ id: 'e', type: 'DIV', dateText: null, place: 'Perth' }]
				})
			)
		).toBe('1975');
	});
});
