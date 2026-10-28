/**
 * The flat tree's poster as a PDF, built in the browser. macOS and iOS print dialogs only offer the
 * printer's paper, so a download is the one way to get the poster's own sheet everywhere. Loaded only
 * when someone downloads: jsPDF, svg2pdf and the font are about 2 MB between them.
 */

import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import regularUrl from 'dejavu-fonts-ttf/ttf/DejaVuSansCondensed.ttf?url';
import boldUrl from 'dejavu-fonts-ttf/ttf/DejaVuSansCondensed-Bold.ttf?url';
import { posterPanels, type PosterSheet } from './poster.js';

/**
 * The PDF fonts have no ♂, ♀, ⚧ or ○ and only Western European letters, so a font that has them all
 * is embedded. Condensed, because the cards truncate names to fit the narrower screen font.
 */
const FONT = 'DejaVuSansCondensed';

/** What svg2pdf can read as attributes; it understands neither `var()` nor Svelte's scoped classes. */
const PRESENTATION = [
	'fill',
	'fill-opacity',
	'stroke',
	'stroke-width',
	'stroke-opacity',
	'stroke-dasharray',
	'stroke-linecap',
	'stroke-linejoin',
	'opacity',
	'font-size',
	'text-anchor',
	'dominant-baseline'
] as const;

const isTransparent = (colour: string) => colour === 'transparent' || /,\s*0\)$/.test(colour);
/** Chrome reports a length set through a CSS variable as `calc(3px)`, which svg2pdf reads as NaN. */
const unwrapCalc = (value: string) => value.replace(/calc\(([^()]*)\)/g, '$1');

/** A detached copy of the drawn poster with every computed style written onto it as attributes. */
export function inlinedCopy(svg: SVGSVGElement): SVGSVGElement {
	const copy = svg.cloneNode(true) as SVGSVGElement;
	const originals = [svg, ...svg.querySelectorAll('*')];
	const copies = [copy, ...copy.querySelectorAll('*')];
	originals.forEach((original, i) => {
		const element = copies[i]!;
		const style = getComputedStyle(original);
		if (style.display === 'none' || style.visibility === 'hidden') {
			element.remove();
			return;
		}
		element.removeAttribute('class');
		element.removeAttribute('style');
		for (const name of PRESENTATION) {
			const value = style.getPropertyValue(name);
			if (!value) continue;
			const isPaint = name === 'fill' || name === 'stroke';
			element.setAttribute(name, isPaint && isTransparent(value) ? 'none' : unwrapCalc(value));
		}
		if (original instanceof SVGTextElement || original instanceof SVGTSpanElement) {
			element.setAttribute('font-family', FONT);
			element.setAttribute('font-weight', Number(style.fontWeight) >= 600 ? 'bold' : 'normal');
			if (style.textTransform === 'uppercase' && element.childElementCount === 0)
				element.textContent = (element.textContent ?? '').toUpperCase();
		}
	});
	// Tooltips and accessible names have no place on paper, and svg2pdf would draw some as text.
	for (const title of copy.querySelectorAll('title, desc')) title.remove();
	copy.removeAttribute('width');
	copy.removeAttribute('height');
	return copy;
}

async function base64Of(url: string): Promise<string> {
	const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
	let binary = '';
	// Chunked: one spread of 680 KB overflows the argument limit.
	for (let i = 0; i < bytes.length; i += 0x8000)
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

/** The poster at the sheet's exact size as a PDF file, split into panels past the page limit. */
export async function posterPdf(svg: SVGSVGElement, sheet: PosterSheet): Promise<Blob> {
	const [regular, bold] = await Promise.all([base64Of(regularUrl), base64Of(boldUrl)]);
	const panels = posterPanels(sheet);
	const format = [panels.widthMm, panels.heightMm];
	const orientation = panels.widthMm >= panels.heightMm ? 'landscape' : 'portrait';
	const doc = new jsPDF({ unit: 'mm', format, orientation, compress: true });
	doc.addFileToVFS(`${FONT}.ttf`, regular);
	doc.addFont(`${FONT}.ttf`, FONT, 'normal');
	doc.addFileToVFS(`${FONT}-Bold.ttf`, bold);
	doc.addFont(`${FONT}-Bold.ttf`, FONT, 'bold');
	const drawing = inlinedCopy(svg);
	for (let i = 0; i < panels.count; i++) {
		if (i > 0) doc.addPage(format, orientation);
		// The whole drawing on every page, shifted so this panel's slice falls on it; the page clips the rest.
		await doc.svg(drawing, {
			x: (sheet.widthMm - sheet.drawingWidthMm) / 2 - (panels.isWide ? i * panels.widthMm : 0),
			y: (sheet.heightMm - sheet.drawingHeightMm) / 2 - (panels.isWide ? 0 : i * panels.heightMm),
			width: sheet.drawingWidthMm,
			height: sheet.drawingHeightMm
		});
	}
	return doc.output('blob');
}
