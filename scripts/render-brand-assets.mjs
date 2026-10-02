// Rasterises the brand SVGs in static/ into the PNG and ICO files browsers, launchers and link
// unfurlers need. The SVGs are the sources of truth; run this after changing one and commit the
// output, since neither Workers nor the build can rasterise.
//
// Uses the Playwright Chromium already present for e2e rather than an image library, so the PNGs
// match how browsers draw the SVGs (stroke caps, opacity) and no native dependency is added.
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const staticDir = new URL('../static/', import.meta.url);
const brandDir = new URL('brand/', staticDir);

const svg = async (name, dir = brandDir) => readFile(new URL(name, dir), 'utf8');

/** Renders `markup` at exactly `width`×`height` CSS px with a transparent background. */
async function renderPng(page, markup, width, height) {
	await page.setViewportSize({ width, height });
	await page.setContent(
		`<!doctype html><html><head><style>html,body{margin:0;background:transparent}` +
			`svg{display:block;width:${width}px;height:${height}px}</style></head><body>${markup}</body></html>`,
		{ waitUntil: 'load' }
	);
	return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width, height } });
}

/** An ICO container holding PNG frames, which every browser since IE Vista-era accepts. */
function toIco(frames) {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(frames.length, 4);
	let offset = 6 + 16 * frames.length;
	const entries = frames.map(({ size, png }) => {
		const entry = Buffer.alloc(16);
		entry.writeUInt8(size >= 256 ? 0 : size, 0);
		entry.writeUInt8(size >= 256 ? 0 : size, 1);
		entry.writeUInt16LE(1, 4);
		entry.writeUInt16LE(32, 6);
		entry.writeUInt32LE(png.length, 8);
		entry.writeUInt32LE(offset, 12);
		offset += png.length;
		return entry;
	});
	return Buffer.concat([header, ...entries, ...frames.map((f) => f.png)]);
}

/**
 * The link-preview card's typeface, inlined so the raster does not depend on whichever fonts the
 * machine running this script happens to have. Falls back to the system stack when offline.
 */
async function loadCardFontCss() {
	try {
		const cssUrl = 'https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;700&display=block';
		// A modern user agent, or Google serves TTF without unicode-range subsets.
		const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
		const css = await (await fetch(cssUrl, { headers: { 'user-agent': ua } })).text();
		const latin = css.split('/* latin */').slice(1).map((block) => block.split('}')[0] + '}');
		const inlined = [];
		for (const face of latin) {
			const fontUrl = face.match(/url\((https:[^)]+)\)/)?.[1];
			if (!fontUrl) continue;
			const bytes = Buffer.from(await (await fetch(fontUrl)).arrayBuffer());
			inlined.push(face.replace(fontUrl, `data:font/woff2;base64,${bytes.toString('base64')}`));
		}
		if (inlined.length === 0) throw new Error('no latin faces in the stylesheet');
		return { css: inlined.join('\n'), family: "'Source Sans 3'" };
	} catch (err) {
		console.warn(`Could not fetch the card font (${err.message}); using the system stack.`);
		return { css: '', family: 'system-ui' };
	}
}

async function renderOgCard(page, markSvg) {
	const font = await loadCardFontCss();
	await page.setViewportSize({ width: 1200, height: 630 });
	await page.setContent(
		`<!doctype html><html><head><style>${font.css}
		html,body{margin:0}
		.card{width:1200px;height:630px;box-sizing:border-box;padding:80px 96px;background:#064e3b;
			color:#fffbeb;font-family:${font.family},system-ui,sans-serif;display:flex;align-items:center;gap:48px}
		.card svg{width:360px;height:360px;flex:none;margin-left:-40px}
		h1{margin:0;font-size:120px;line-height:1;font-weight:700;letter-spacing:-0.03em}
		p{margin:24px 0 0;font-size:36px;line-height:1.3;color:#a7f3d0;max-width:600px}
		</style></head><body><div class="card">${markSvg}<div><h1>Epoch</h1>
		<p>A private family history, shared with the people who help keep it.</p></div></div></body></html>`,
		{ waitUntil: 'networkidle' }
	);
	await page.evaluate(() => document.fonts.ready);
	return page.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 630 } });
}

async function main() {
	// CHROMIUM_PATH lets a machine whose installed browser build differs from Playwright's pin
	// (CI images, sandboxes) render without downloading another one.
	const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
	try {
		const page = await browser.newPage({ deviceScaleFactor: 1 });

		const icon = await svg('icon.svg');
		for (const [name, size] of [
			['icon-192.png', 192],
			['icon-512.png', 512],
			['apple-touch-icon.png', 180]
		]) {
			await writeFile(new URL(name, brandDir), await renderPng(page, icon, size, size));
		}
		await writeFile(
			new URL('icon-maskable-512.png', brandDir),
			await renderPng(page, await svg('icon-maskable.svg'), 512, 512)
		);

		// The ICO is for clients that ignore SVG favicons, which also ignore its dark-scheme rule,
		// so it carries the light-scheme colours only.
		const favicon = await svg('favicon.svg', staticDir);
		const frames = [];
		for (const size of [16, 32, 48]) {
			frames.push({ size, png: await renderPng(page, favicon, size, size) });
		}
		await writeFile(new URL('favicon.ico', staticDir), toIco(frames));

		// The card's mark is the app icon's glyph without its square, drawn on the card's own green.
		const cardMark = icon.replace(/<rect[^>]*\/>/, '');
		await writeFile(new URL('og-image.png', brandDir), await renderOgCard(page, cardMark));
	} finally {
		await browser.close();
	}
	console.log('Brand assets written to static/ and static/brand/.');
}

await main();
