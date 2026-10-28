import { LAYOUT_METRICS, type TreeLayout } from '#lib/tree-layout/index.js';

/**
 * Millimetres per layout unit on a poster. A full card's dates are 12 units, so they print at about
 * 8.5pt and its name at 10pt: the smallest a wall chart stays readable at arm's length.
 */
export const POSTER_MM_PER_UNIT = 0.25;
export const POSTER_MARGIN_MM = 10;
/** Room round the drawing for the focus tab and union labels that sit outside the card bounds. */
const PAD_UNITS = 30;
/**
 * A0's short side, which a common 914 mm plotter roll takes with room to spare. Only the sheet's
 * short side is held to it: the long side runs on as a banner, so a wide tree keeps readable cards
 * instead of shrinking.
 */
const ROLL_WIDTH_MM = 841;
/** The floor, so a small family does not print on a sheet the size of a business card. */
const A4_MM = { long: 297, short: 210 } as const;

export interface PosterSheet {
	/** The page, margins included; exact, not rounded up to a paper size. */
	widthMm: number;
	heightMm: number;
	/** The drawing itself, inside the margins. */
	drawingWidthMm: number;
	drawingHeightMm: number;
	viewBox: string;
	/** How wide one card prints, so the control can say when a big tree gets small. */
	cardWidthMm: number;
}

// Down, so a drawing shrunk to the roll never rounds past it onto a second sheet.
const round = (mm: number) => Math.floor(mm * 10) / 10;

/**
 * The one sheet a flat tree prints on, always at readable size unless even its short side is wider
 * than a roll, when it shrinks to the roll.
 */
export function posterSheet(bounds: TreeLayout['bounds']): PosterSheet {
	const minX = bounds.minX - PAD_UNITS;
	const minY = bounds.minY - PAD_UNITS;
	const width = bounds.maxX - bounds.minX + 2 * PAD_UNITS;
	const height = bounds.maxY - bounds.minY + 2 * PAD_UNITS;
	const isLandscape = width >= height;
	const [minW, minH] = isLandscape ? [A4_MM.long, A4_MM.short] : [A4_MM.short, A4_MM.long];
	const inner = 2 * POSTER_MARGIN_MM;
	const mmPerUnit = Math.min(POSTER_MM_PER_UNIT, (ROLL_WIDTH_MM - inner) / Math.min(width, height));
	const drawingWidthMm = round(width * mmPerUnit);
	const drawingHeightMm = round(height * mmPerUnit);
	return {
		widthMm: Math.max(minW, drawingWidthMm + inner),
		heightMm: Math.max(minH, drawingHeightMm + inner),
		drawingWidthMm,
		drawingHeightMm,
		viewBox: `${minX} ${minY} ${width} ${height}`,
		cardWidthMm: round(LAYOUT_METRICS.cardWidth * mmPerUnit)
	};
}
