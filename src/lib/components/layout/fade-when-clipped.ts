import type { Attachment } from 'svelte/attachments';

/**
 * Fades a sideways-scrolling row's right edge while items are hidden past it, which tells a phone
 * user the row scrolls.
 */
export const fadeWhenClipped: Attachment<HTMLElement> = (row) => {
	const measure = () =>
		row.classList.toggle(
			'mask-r-from-[calc(100%-2rem)]',
			row.scrollLeft + row.clientWidth < row.scrollWidth - 1
		);
	measure();
	row.addEventListener('scroll', measure, { passive: true });
	const observer = new ResizeObserver(measure);
	observer.observe(row);
	return () => {
		row.removeEventListener('scroll', measure);
		observer.disconnect();
	};
};
