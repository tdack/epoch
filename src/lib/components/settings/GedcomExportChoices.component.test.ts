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
		.find((l) => l.textContent?.includes(label))!
		.querySelector('input')!;
const compress = () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const media = () => document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!;

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

	it('disables Include media unless 7.0 is compressed to .gdz', () => {
		const onexport = render();
		expect(media().disabled).toBe(true);
		compress().click();
		flushSync();
		expect(media().disabled).toBe(false);
		radio('GEDCOM 5.5.1 (legacy)').click();
		flushSync();
		expect(media().disabled).toBe(true);
		expect(media().checked).toBe(false);
		exportButton().click();
		expect(onexport).toHaveBeenCalledWith({ format: 'gedcom551', shouldCompress: false });
	});

	it('sends includeMedia when Include media is checked', () => {
		const onexport = render();
		compress().click();
		flushSync();
		media().click();
		flushSync();
		exportButton().click();
		expect(onexport).toHaveBeenCalledWith({
			format: 'gedcom7',
			shouldCompress: true,
			shouldIncludeMedia: true
		});
	});

	it('leaves includeMedia out when Include media is unchecked', () => {
		const onexport = render();
		compress().click();
		flushSync();
		media().click();
		flushSync();
		media().click();
		flushSync();
		exportButton().click();
		const [choice] = onexport.mock.calls[0]!;
		expect(choice).toEqual({ format: 'gedcom7', shouldCompress: true });
		expect(choice).not.toHaveProperty('shouldIncludeMedia');
	});

	it('clears Include media when compression is unchecked', () => {
		const onexport = render();
		compress().click();
		flushSync();
		media().click();
		flushSync();
		compress().click();
		flushSync();
		compress().click();
		flushSync();
		expect(media().checked).toBe(false);
		exportButton().click();
		expect(onexport).toHaveBeenCalledWith({ format: 'gedcom7', shouldCompress: true });
	});

	it('shows the stored size, or a plain note when the figure is unknown', () => {
		component = mount(GedcomExportChoices, {
			target: document.body,
			props: { onexport: vi.fn(), mediaBytes: 2 * 1024 * 1024 }
		});
		compress().click();
		flushSync();
		expect(document.body.textContent).toContain('Adds 2.0 MB of stored files.');
		unmount(component);
		document.body.innerHTML = '';
		render();
		expect(document.body.textContent).toContain('Needs GEDCOM 7.0 compressed to .gdz.');
		compress().click();
		flushSync();
		expect(document.body.textContent).toContain('Adds every stored file; may be large.');
	});
});
