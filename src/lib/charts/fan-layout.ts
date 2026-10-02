/**
 * Where the wedges of a fan chart go. Pure and plain data, like `chart-layout.ts`, so it runs in the
 * browser and in Vitest. The person is the half-disc at the bottom centre and each generation is a
 * ring above it, split into 2^generation wedges across a half circle, the first parent of each
 * person on the left (the pedigree's heap order, which puts a person's parents side by side).
 */

import type { ChartPerson } from '../shared/charts';

/** A ring is this wide; the person's disc is `CENTRE_RADIUS`. */
export const FAN = { centreRadius: 52, ringWidth: 74, padding: 10 } as const;
/** The most generations a fan draws: the outermost ring then has 64 wedges about 3 degrees wide. */
export const MAX_FAN_GENERATIONS = 7;

export interface FanLabel {
	x: number;
	y: number;
	/** Degrees; text is rotated about (x, y) and centred there. */
	rotate: number;
	/** Name, then dates when there is room. */
	lines: string[];
}

export interface FanSegment {
	key: string;
	/** The position in the pedigree's heap order, so the segment and its outline entry agree. */
	slot: number;
	generation: number;
	person: ChartPerson;
	path: string;
	label: FanLabel;
}

export interface FanLayout {
	segments: FanSegment[];
	width: number;
	height: number;
	/** The centre of the person's disc, where every ring is centred. */
	centre: { x: number; y: number };
}

const round = (n: number) => Math.round(n * 100) / 100;
const point = (cx: number, cy: number, radius: number, angle: number) => ({
	x: round(cx + radius * Math.cos(angle)),
	y: round(cy - radius * Math.sin(angle))
});
const clip = (text: string, max: number) =>
	text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
const dates = (birth: string | null, death: string | null) =>
	birth || death ? `${birth ?? '?'} – ${death ?? ''}`.trim() : '';

/** Room for a label in characters: radial text has one ring's width, and horizontal text a chord. */
function labelFor(
	person: ChartPerson,
	generation: number,
	cx: number,
	cy: number,
	inner: number,
	outer: number,
	start: number,
	end: number
): FanLabel {
	const mid = (start + end) / 2;
	const radius = (inner + outer) / 2;
	const { x, y } = point(cx, cy, radius, mid);
	const dated = dates(person.birth, person.death);
	if (generation <= 2) {
		return { x, y, rotate: 0, lines: [clip(person.name, 17), ...(dated ? [clip(dated, 17)] : [])] };
	}
	// Along the radius, turned so it never reads upside down: the left half runs inward.
	const degrees = (mid * 180) / Math.PI;
	const rotate = round(mid > Math.PI / 2 ? 180 - degrees : -degrees);
	const room = Math.floor((outer - inner - 10) / 5.4);
	return { x, y, rotate, lines: [clip(person.name, room)] };
}

export function layoutFan(
	slots: ReadonlyArray<ChartPerson | null>,
	generations: number
): FanLayout {
	const outer = FAN.centreRadius + (generations - 1) * FAN.ringWidth;
	const cx = outer + FAN.padding;
	const cy = outer + FAN.padding;
	const segments: FanSegment[] = [];

	slots.forEach((person, i) => {
		if (!person) return;
		const generation = Math.floor(Math.log2(i + 1));
		const n = 2 ** generation;
		const k = i + 1 - n;
		const start = Math.PI - (k * Math.PI) / n;
		const end = Math.PI - ((k + 1) * Math.PI) / n;
		const inner = generation === 0 ? 0 : FAN.centreRadius + (generation - 1) * FAN.ringWidth;
		const outerRadius = generation === 0 ? FAN.centreRadius : inner + FAN.ringWidth;
		let path: string;
		if (generation === 0) {
			path = `M${cx - FAN.centreRadius} ${cy} A${FAN.centreRadius} ${FAN.centreRadius} 0 0 1 ${cx + FAN.centreRadius} ${cy} Z`;
		} else {
			const a = point(cx, cy, outerRadius, start);
			const b = point(cx, cy, outerRadius, end);
			const c = point(cx, cy, inner, end);
			const d = point(cx, cy, inner, start);
			path = `M${a.x} ${a.y} A${outerRadius} ${outerRadius} 0 0 1 ${b.x} ${b.y} L${c.x} ${c.y} A${inner} ${inner} 0 0 0 ${d.x} ${d.y} Z`;
		}
		const label =
			generation === 0
				? {
						x: cx,
						y: round(cy - FAN.centreRadius / 2),
						rotate: 0,
						lines: [
							clip(person.name, 14),
							...(dates(person.birth, person.death)
								? [clip(dates(person.birth, person.death), 14)]
								: [])
						]
					}
				: labelFor(person, generation, cx, cy, inner, outerRadius, start, end);
		segments.push({ key: `f${i}`, slot: i, generation, person, path, label });
	});

	return {
		segments,
		width: round(2 * cx),
		height: round(cy + FAN.padding),
		centre: { x: cx, y: cy }
	};
}
