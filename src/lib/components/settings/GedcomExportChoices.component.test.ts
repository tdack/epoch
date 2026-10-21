import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import GedcomExportChoices from './GedcomExportChoices.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

function render() {
	const onexport = vi.fn();
	component = mount(GedcomExportChoices, { target: document.body, props: { onexport } });
	flushSync();
	return onexport;
}

const exportButton = () =>
	[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Export')!;
const radio = (label: string) =>
	[...document.querySelectorAll('label')]
		.find((l) => l.textContent?.trim() === label)!
		.querySelector('input')!;
const compress = () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

describe('GedcomExportChoices', () => {
	it('exports GEDCOM 7.0, uncompressed, by default', () => {
		const onexport = render();
		exportButton().click();
		expect(onexport).toHaveBeenCalledWith({ format: 'gedcom7', shouldCompress: false });
	});

	it('compresses a 7.0 export to .gdz when asked', () => {
		const onexport = render();
		compress().click();
		flushSync();
		exportButton().click();
		expect(onexport).toHaveBeenCalledWith({ format: 'gedcom7', shouldCompress: true });
	});

	it('offers 5.5.1 without GEDZip, which holds 7.0 only', () => {
		const onexport = render();
		compress().click();
		flushSync();
		radio('GEDCOM 5.5.1 (legacy)').click();
		flushSync();
		expect(compress().checked).toBe(false);
		expect(compress().disabled).toBe(true);
		expect(document.body.textContent).toContain('GEDZip holds GEDCOM 7.0 files only.');
		exportButton().click();
		expect(onexport).toHaveBeenCalledWith({ format: 'gedcom551', shouldCompress: false });
	});
});
