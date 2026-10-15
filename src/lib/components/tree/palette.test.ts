import { describe, expect, it } from 'vitest';
import { contrastRatio } from '#lib/shared/colour.js';
import { DEFAULT_PALETTE, resolvePalette, treeTokenStyle } from './palette';
import { HIGHLIGHT_TOKENS, ORRERY_TOKENS, RING_TOKENS, TREE_TOKENS } from './tree-tokens';

describe('DEFAULT_PALETTE', () => {
	it('reproduces the built-in token values exactly', () => {
		expect(DEFAULT_PALETTE.sex.male).toEqual({
			fill: TREE_TOKENS['--sex-m'],
			border: TREE_TOKENS['--sex-m-border'],
			sphere: RING_TOKENS.male,
			star: ORRERY_TOKENS.male
		});
		expect(DEFAULT_PALETTE.sex.female.border).toBe(TREE_TOKENS['--sex-f-border']);
		expect(DEFAULT_PALETTE.sex.unknown.fill).toBe(TREE_TOKENS['--sex-u']);
		expect(DEFAULT_PALETTE.trace).toEqual(HIGHLIGHT_TOKENS.trace);
		expect(DEFAULT_PALETTE.focusDark.partner).toBe(RING_TOKENS.dark.partner);
	});
});

describe('resolvePalette', () => {
	it('returns the built-in palette when no layer sets anything', () => {
		expect(resolvePalette(null, undefined, {})).toEqual(DEFAULT_PALETTE);
	});

	it('prefers the user layer over the site layer over the built-in', () => {
		const site = { sexColours: { male: '#112233' } };
		const user = { sexColours: { male: '#445566' } };
		expect(resolvePalette(user, site).sex.male.border).toBe('#445566');
		expect(resolvePalette(null, site).sex.male.border).toBe('#112233');
	});

	it('takes a group whole from the first layer that sets it', () => {
		const user = { focusColours: { ancestor: '#101010' } };
		const site = { focusColours: { ancestor: '#202020', descendant: '#303030' } };
		const palette = resolvePalette(user, site);
		expect(palette.focus.ancestor).toBe('#101010');
		expect(palette.focus.descendant).toBe(DEFAULT_PALETTE.focus.descendant);
	});

	it('derives the other shades of a changed sex colour', () => {
		const palette = resolvePalette({ sexColours: { female: '#008000' } });
		expect(palette.sex.female.border).toBe('#008000');
		expect(palette.sex.female.sphere).toBe('#008000');
		expect(palette.sex.female.fill).not.toBe(DEFAULT_PALETTE.sex.female.fill);
		expect(contrastRatio(palette.sex.female.fill, '#008000')).toBeGreaterThan(1.5);
		expect(palette.sex.male).toEqual(DEFAULT_PALETTE.sex.male);
	});

	it('falls back to the built-in colour for an invalid stored value', () => {
		const palette = resolvePalette({
			sexColours: { male: 'javascript:alert(1)' as string },
			tracePalette: { trace: ['#zzz', ...HIGHLIGHT_TOKENS.trace.slice(1)] }
		});
		expect(palette.sex.male).toEqual(DEFAULT_PALETTE.sex.male);
		expect(palette.trace[0]).toBe(HIGHLIGHT_TOKENS.trace[0]);
		expect(palette.trace[1]).toBe(HIGHLIGHT_TOKENS.trace[1]);
	});

	it('lower-cases a valid colour so it always matches the stored form', () => {
		expect(resolvePalette({ focusColours: { partner: '#ABCDEF' } }).focus.partner).toBe('#abcdef');
	});
});

describe('treeTokenStyle', () => {
	it('emits exactly the built-in custom properties for the default palette', () => {
		const expected = Object.entries(TREE_TOKENS)
			.map(([name, value]) => `${name}:${value}`)
			.join(';');
		expect(treeTokenStyle()).toBe(expected);
	});

	it('writes a chosen sex colour and focus colour into the flat view variables', () => {
		const style = treeTokenStyle(
			resolvePalette({ sexColours: { male: '#123456' }, focusColours: { descendant: '#abcdef' } })
		);
		expect(style).toContain('--sex-m-border:#123456');
		expect(style).toContain('--tree-accent:#abcdef');
		expect(style).not.toContain(TREE_TOKENS['--sex-m-border']);
	});

	it('never writes an invalid colour into the style attribute', () => {
		const hostile = {
			...DEFAULT_PALETTE,
			focus: { ...DEFAULT_PALETTE.focus, ancestor: 'red;--x:url(evil)' }
		};
		const style = treeTokenStyle(hostile);
		expect(style).not.toContain('evil');
		expect(style).toContain(`--union-ink:${DEFAULT_PALETTE.focus.ancestor}`);
	});
});
