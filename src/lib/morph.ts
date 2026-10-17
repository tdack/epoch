/**
 * The geometry that lets one person's card become a fan wedge or a list row. Every shape is a
 * "bent card": a rounded rectangle around a centre, turned, and bent around a circle of radius
 * 1 / bend. A flat card has bend 0, a fan wedge bends around the fan's centre, and the fan's
 * centre half-disc is a card bent so far its inner edge shrinks to a point. Blending the numbers
 * of two shapes is therefore a real morph, not a cross-fade.
 */

import { DISTANCE, LAYOUTS, LENS_IDS, PEOPLE, type LensId, type Place } from './family.js';

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** The sub-range [from, to] of t, stretched back to 0–1. */
export const window01 = (t: number, from: number, to: number) => clamp01((t - from) / (to - from));

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [
	Number.parseInt(hex.slice(1, 3), 16),
	Number.parseInt(hex.slice(3, 5), 16),
	Number.parseInt(hex.slice(5, 7), 16)
];
const mixRgb = (a: Rgb, b: Rgb, t: number) =>
	`rgb(${Math.round(lerp(a[0], b[0], t))} ${Math.round(lerp(a[1], b[1], t))} ${Math.round(lerp(a[2], b[2], t))})`;

interface Shape {
	x: number;
	y: number;
	turn: number;
	w: number;
	h: number;
	bend: number;
	r: number;
}

/** A point `s` along the shape's middle line and `v` above it. */
function at(shape: Shape, s: number, v: number): [number, number] {
	const tx = Math.cos(shape.turn);
	const ty = Math.sin(shape.turn);
	// "Up" in the shape's frame: away from the centre of the bend.
	const nx = ty;
	const ny = -tx;
	let along: number;
	let up: number;
	if (Math.abs(shape.bend) < 1e-7) {
		along = s;
		up = v;
	} else {
		// Written so it stays finite as the bend tends to flat: (R + v)cos β − R, (R + v)sin β.
		const beta = s * shape.bend;
		const half = Math.sin(beta / 2);
		up = v * Math.cos(beta) - (2 * half * half) / shape.bend;
		along = v * Math.sin(beta) + Math.sin(beta) / shape.bend;
	}
	return [shape.x + tx * along + nx * up, shape.y + ty * along + ny * up];
}

const EDGE_STEPS = 18;
const CORNER_STEPS = 4;

/** The outline as a path, sampled finely enough that a bent edge reads as an arc. */
export function bentPath(shape: Shape): string {
	const hw = shape.w / 2;
	const hh = shape.h / 2;
	const r = Math.max(0, Math.min(shape.r, hw, hh));
	const points: Array<[number, number]> = [];
	const corner = (cs: number, cv: number, from: number) => {
		for (let i = 0; i <= CORNER_STEPS; i++) {
			// Clockwise, as the outline runs.
			const a = from - (i / CORNER_STEPS) * (Math.PI / 2);
			points.push(at(shape, cs + r * Math.cos(a), cv + r * Math.sin(a)));
		}
	};
	const edge = (s0: number, v0: number, s1: number, v1: number, steps: number) => {
		for (let i = 1; i < steps; i++) {
			const t = i / steps;
			points.push(at(shape, lerp(s0, s1, t), lerp(v0, v1, t)));
		}
	};
	// Round the outline in the shape's own (s, v) frame, then bend it: top edge left to right.
	corner(-hw + r, hh - r, Math.PI);
	edge(-hw + r, hh, hw - r, hh, EDGE_STEPS);
	corner(hw - r, hh - r, Math.PI / 2);
	edge(hw, hh - r, hw, -hh + r, 2);
	corner(hw - r, -hh + r, 0);
	edge(hw - r, -hh, -hw + r, -hh, EDGE_STEPS);
	corner(-hw + r, -hh + r, -Math.PI / 2);
	let d = '';
	for (const [i, [x, y]] of points.entries())
		d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
	return `${d}Z`;
}

/** The app's tree tokens, and the emerald of its charts (`ChartCanvas`, `FanChart`). */
const INK = {
	stoneInk: rgb('#1c1917'),
	emerald800: rgb('#065f46'),
	white: rgb('#ffffff'),
	chartFill: rgb('#ecfdf5'),
	fanEven: rgb('#d1fae5'),
	chartEdge: rgb('#6ee7b7'),
	privateFill: rgb('#fafaf9'),
	privateEdge: rgb('#d6d3d1')
};
const SEX: Record<'m' | 'f' | 'u', { fill: Rgb; edge: Rgb }> = {
	m: { fill: rgb('#dbe8f5'), edge: rgb('#5a84b5') },
	f: { fill: rgb('#f6dde6'), edge: rgb('#b8607f') },
	u: { fill: rgb('#ebe7e0'), edge: rgb('#7d756a') }
};

interface Style {
	fill: Rgb;
	fillAlpha: number;
	edge: Rgb;
	edgeAlpha: number;
	edgeWidth: number;
	radius: number;
	symbolAlpha: number;
	ringAlpha: number;
	nameSize: number;
	nameWeight: number;
	nameFill: Rgb;
	/** 1 centres the text on the shape; 0 sets it from the left edge plus `inset`. */
	centred: number;
	inset: number;
	nameY: number;
	/** The baseline of the first line under the name, and the step to the next. */
	lineY: number;
	lineGap: number;
}

function styleOf(place: Place, id: string): Style {
	const person = PEOPLE.find((p) => p.id === id)!;
	const isFocus = id === 'ellen';
	const isPrivate = !!person.isPrivate;
	const base = {
		fillAlpha: 1,
		edgeAlpha: 1,
		symbolAlpha: 0,
		ringAlpha: 0,
		nameFill: INK.stoneInk,
		nameWeight: 600
	};
	switch (place.look) {
		case 'tree':
			return {
				...base,
				fill: SEX[person.sex].fill,
				edge: isFocus ? INK.stoneInk : SEX[person.sex].edge,
				edgeWidth: isFocus ? 3 : 1.75,
				radius: 12,
				symbolAlpha: 1,
				ringAlpha: isFocus ? 1 : 0,
				nameSize: 14,
				nameWeight: isPrivate ? 500 : 700,
				centred: 0,
				inset: 34,
				nameY: -7,
				lineY: 13,
				lineGap: 16
			};
		case 'chart':
			return {
				...base,
				fill: isPrivate ? INK.privateFill : INK.chartFill,
				edge: isPrivate ? INK.privateEdge : INK.chartEdge,
				edgeWidth: 1.5,
				radius: 8,
				nameSize: 14,
				centred: 0,
				inset: 12,
				nameY: -3,
				lineY: 15,
				lineGap: 16
			};
		case 'fan': {
			const isOuter = (place.ring ?? 0) >= 3;
			return {
				...base,
				fill: (place.ring ?? 0) % 2 === 0 ? INK.fanEven : INK.chartFill,
				edge: INK.chartEdge,
				edgeWidth: 1.5,
				radius: 3,
				nameSize: isOuter ? 12 : 13,
				centred: 1,
				inset: 0,
				nameY: isOuter ? 4 : -3,
				lineY: 13,
				lineGap: 16
			};
		}
		case 'step':
			return {
				...base,
				fill: INK.white,
				fillAlpha: 0,
				edge: INK.white,
				edgeAlpha: 0,
				edgeWidth: 1,
				radius: 8,
				nameSize: 15,
				nameWeight: 500,
				nameFill: INK.emerald800,
				centred: 0,
				inset: 14,
				nameY: 5,
				lineY: 22,
				lineGap: 16
			};
	}
}

interface Resolved {
	place: Place;
	isShown: boolean;
}

/**
 * Where everyone is in each lens. Someone a lens leaves out waits, unseen, where the nearest lens
 * that shows them puts them, so they fade in and out in place rather than flying across.
 */
const RESOLVED: Record<string, Resolved[]> = Object.fromEntries(
	PEOPLE.map((person) => {
		const shown = LENS_IDS.map((lens) => LAYOUTS[lens][person.id]);
		return [
			person.id,
			shown.map((place, i) => {
				if (place) return { place, isShown: true };
				for (let d = 1; d < LENS_IDS.length; d++) {
					const near = shown[i + d] ?? shown[i - d];
					if (near) return { place: { ...near, lines: [] }, isShown: false };
				}
				throw new Error(`${person.id} is in no lens`);
			})
		];
	})
);

export interface Drawn {
	id: string;
	name: string;
	isPrivate: boolean;
	sex: 'm' | 'f' | 'u';
	opacity: number;
	path: string;
	ringPath: string | null;
	fill: string;
	fillAlpha: number;
	edge: string;
	edgeAlpha: number;
	edgeWidth: number;
	symbolAlpha: number;
	ringAlpha: number;
	/** The text's frame: its origin, turn, and the left edge it is set from. */
	textX: number;
	textY: number;
	textTurn: number;
	/** 0–1; dips while a card changes shape, so names never print over each other mid-move. */
	textAlpha: number;
	nameX: number;
	nameY: number;
	nameSize: number;
	nameWeight: number;
	nameFill: string;
	/** The lines under the name; while a lens change swaps their text, both sets, cross-fading. */
	lines: Array<{ text: string; x: number; y: number; alpha: number }>;
	/** Where the sex symbol is centred, from the card's left edge. */
	symbolX: number;
	/** The top of the focus rule, where the app hangs its "Focus" tab. */
	ringTop: number;
}

/** Rough text width for the first render, before the browser can measure. */
const estimate = (text: string, size: number) => text.length * size * 0.56;

export type Measure = (text: string, size: number, weight: number) => number;

/** How much later each step from the focus person starts to move, as a share of the morph. */
const RIPPLE = 0.09;
const RIPPLE_SPAN = 1 - 3 * RIPPLE;

/**
 * Everyone, part way from lens `from` to lens `to`. `progress` runs 0 to 1; each person eases
 * through their own slice of it, the focus person first, so the change spreads out from her.
 */
export function drawAll(
	from: LensId,
	to: LensId,
	progress: number,
	measure: Measure = (text, size) => estimate(text, size)
): Drawn[] {
	const a = LENS_IDS.indexOf(from);
	const b = LENS_IDS.indexOf(to);
	return PEOPLE.map((person) => {
		const delay = (DISTANCE[person.id] ?? 0) * RIPPLE;
		const t = easeInOut(window01(progress, delay, delay + RIPPLE_SPAN));
		const ra = RESOLVED[person.id]![a]!;
		const rb = RESOLVED[person.id]![b]!;
		const pa = ra.place;
		const pb = rb.place;
		const sa = styleOf(pa, person.id);
		const sb = styleOf(pb, person.id);
		// Someone arriving fades in late and someone leaving fades out early, so the space they
		// pass through is never crowded.
		const opacity = lerp(
			ra.isShown ? 1 : 0,
			rb.isShown ? 1 : 0,
			ra.isShown === rb.isShown ? t : rb.isShown ? window01(t, 0.4, 1) : window01(t, 0, 0.6)
		);
		const shape: Shape = {
			x: lerp(pa.x, pb.x, t),
			y: lerp(pa.y, pb.y, t),
			turn: lerp(pa.turn, pb.turn, t),
			w: lerp(pa.w, pb.w, t),
			h: lerp(pa.h, pb.h, t),
			bend: lerp(pa.bend, pb.bend, t),
			r: lerp(sa.radius, sb.radius, t)
		};
		const ringAlpha = lerp(sa.ringAlpha, sb.ringAlpha, t);
		const nameSize = lerp(sa.nameSize, sb.nameSize, t);
		const nameWeight = Math.round(lerp(sa.nameWeight, sb.nameWeight, t));
		const leftOf = (style: Style, place: Place, width: number) =>
			lerp(-place.w / 2 + style.inset, -width / 2, style.centred);
		const nameWidthA = measure(person.name, sa.nameSize, sa.nameWeight);
		const nameWidthB = measure(person.name, sb.nameSize, sb.nameWeight);
		const textAt = at(shape, 0, 0);

		const lines: Drawn['lines'] = [];
		const widthOf = (text: string) => measure(text, 12, 400);
		const sameText = (pa.lines ?? []).join('\n') === (pb.lines ?? []).join('\n');
		if (sameText) {
			// The same text glides from one place to the other.
			(pa.lines ?? []).forEach((text, i) => {
				lines.push({
					text,
					x: lerp(leftOf(sa, pa, widthOf(text)), leftOf(sb, pb, widthOf(text)), t),
					y: lerp(sa.lineY + i * sa.lineGap, sb.lineY + i * sb.lineGap, t),
					alpha: 1
				});
			});
		} else {
			const fadeOut = 1 - window01(t, 0, 0.45);
			const fadeIn = window01(t, 0.55, 1);
			for (const [place, style, alpha] of [
				[pa, sa, fadeOut],
				[pb, sb, fadeIn]
			] as const) {
				if (alpha <= 0.001) continue;
				(place.lines ?? []).forEach((text, i) =>
					lines.push({
						text,
						x: leftOf(style, place, widthOf(text)),
						y: style.lineY + i * style.lineGap,
						alpha
					})
				);
			}
		}

		return {
			id: person.id,
			name: person.name,
			isPrivate: !!person.isPrivate,
			sex: person.sex,
			opacity,
			path: bentPath(shape),
			// The app's focus rule sits 8 outside the frame, its corner 8 rounder.
			ringPath:
				ringAlpha > 0.01
					? bentPath({ ...shape, w: shape.w + 16, h: shape.h + 16, r: shape.r + 8 })
					: null,
			ringTop: -shape.h / 2 - 8,
			fill: mixRgb(sa.fill, sb.fill, t),
			fillAlpha: lerp(sa.fillAlpha, sb.fillAlpha, t),
			edge: mixRgb(sa.edge, sb.edge, t),
			edgeAlpha: lerp(sa.edgeAlpha, sb.edgeAlpha, t),
			edgeWidth: lerp(sa.edgeWidth, sb.edgeWidth, t),
			symbolAlpha: lerp(sa.symbolAlpha, sb.symbolAlpha, t),
			textX: textAt[0],
			textY: textAt[1],
			textTurn: lerp(pa.labelTurn ?? 0, pb.labelTurn ?? 0, t),
			// Cards changing shape pass through each other (a chart column bending into a ring); the
			// text fades out by the middle of the move and back in, while a card that only slides
			// keeps its name readable throughout.
			textAlpha: pa.look === pb.look ? 1 : (1 - 2 * t) ** 2,
			nameX: lerp(leftOf(sa, pa, nameWidthA), leftOf(sb, pb, nameWidthB), t),
			nameY: lerp(sa.nameY, sb.nameY, t),
			nameSize,
			nameWeight,
			nameFill: mixRgb(sa.nameFill, sb.nameFill, t),
			lines,
			symbolX: -shape.w / 2 + 18,
			ringAlpha
		};
	});
}
