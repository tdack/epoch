/**
 * Pure colour arithmetic for the user-chosen palette: hex parsing, mixing, WCAG contrast and an
 * OKLab distance. Kept free of any DOM or three.js import so the server can enforce the contrast
 * floors on save and the client can show the same numbers.
 *
 * Deliberately limited: no CIEDE2000 and no colour-blindness simulation. OKLab distance is enough
 * to warn that two trace colours look alike; it is a warning, never an automatic adjustment.
 */

export interface Rgb {
	readonly red: number;
	readonly green: number;
	readonly blue: number;
}

const HEX_PATTERN = /^#[0-9a-f]{6}$/;

/** Whether the string is a six-digit hex colour, case-insensitively. */
export function isHexColour(value: string): boolean {
	return HEX_PATTERN.test(value.toLowerCase());
}

/**
 * Parses `#rrggbb` (either case). Anything else, including the three-digit form, is `null`: the
 * palette stores one spelling so that a colour round-trips through the form and the style attribute.
 */
export function parseHex(value: string): Rgb | null {
	const lower = value.toLowerCase();
	if (!HEX_PATTERN.test(lower)) return null;
	return {
		red: Number.parseInt(lower.slice(1, 3), 16),
		green: Number.parseInt(lower.slice(3, 5), 16),
		blue: Number.parseInt(lower.slice(5, 7), 16)
	};
}

/** Formats a colour as lower-case `#rrggbb`, rounding each channel. */
export function formatHex(rgb: Rgb): string {
	const channel = (value: number) =>
		Math.round(Math.min(255, Math.max(0, value)))
			.toString(16)
			.padStart(2, '0');
	return `#${channel(rgb.red)}${channel(rgb.green)}${channel(rgb.blue)}`;
}

/** Linear mix: `t` of the way from `from` to `to`, so 0 is `from` and 1 is `to`. */
export function mixHex(from: string, to: string, t: number): string {
	const a = parseHex(from);
	const b = parseHex(to);
	if (!a || !b) throw new RangeError(`mixHex needs two hex colours, got ${from} and ${to}`);
	const at = (x: number, y: number) => x + (y - x) * t;
	return formatHex({
		red: at(a.red, b.red),
		green: at(a.green, b.green),
		blue: at(a.blue, b.blue)
	});
}

/** Mixes a colour toward white by `amount` (0 to 1). Used for stars and dark-stage lifts. */
export function lightenHex(colour: string, amount: number): string {
	return mixHex(colour, '#ffffff', amount);
}

function linearChannel(channel: number): number {
	const srgb = channel / 255;
	return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance, 0 for black to 1 for white. */
export function relativeLuminance(colour: string): number {
	const rgb = parseHex(colour);
	if (!rgb) throw new RangeError(`relativeLuminance needs a hex colour, got ${colour}`);
	return (
		0.2126 * linearChannel(rgb.red) +
		0.7152 * linearChannel(rgb.green) +
		0.0722 * linearChannel(rgb.blue)
	);
}

/** WCAG contrast ratio between two colours, from 1 (identical) to 21 (black on white). */
export function contrastRatio(first: string, second: string): number {
	const a = relativeLuminance(first);
	const b = relativeLuminance(second);
	const [light, dark] = a > b ? [a, b] : [b, a];
	return (light + 0.05) / (dark + 0.05);
}

interface Oklab {
	readonly lightness: number;
	readonly greenRed: number;
	readonly blueYellow: number;
}

/** Björn Ottosson's OKLab, a perceptual space in which Euclidean distance tracks how alike colours look. */
function toOklab(colour: string): Oklab {
	const rgb = parseHex(colour);
	if (!rgb) throw new RangeError(`toOklab needs a hex colour, got ${colour}`);
	const r = linearChannel(rgb.red);
	const g = linearChannel(rgb.green);
	const b = linearChannel(rgb.blue);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return {
		lightness: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		greenRed: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		blueYellow: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	};
}

/** Perceptual distance in OKLab: roughly 0.02 is a just-noticeable difference, 0.1 is clearly apart. */
export function oklabDistance(first: string, second: string): number {
	const a = toOklab(first);
	const b = toOklab(second);
	return Math.hypot(
		a.lightness - b.lightness,
		a.greenRed - b.greenRed,
		a.blueYellow - b.blueYellow
	);
}
