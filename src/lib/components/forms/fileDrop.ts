import type { Action } from 'svelte/action';

interface FileDropOptions {
	/** False leaves every drag alone, so the browser's own handling applies. */
	isEnabled: boolean;
	/** Whether a file drag is over the node; for the highlight. */
	onActiveChange: (isActive: boolean) => void;
	/** The files that were dropped, never empty. */
	onFiles: (files: File[]) => void;
}

/** Only file drags are for us; a dragged link, text or in-app item passes over untouched. */
const isFileDrag = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

/**
 * Makes a node a drop target for files. It adds no tab stop or focus handling: the file input
 * stays the keyboard path.
 */
export const fileDrop: Action<HTMLElement, FileDropOptions> = (node, initial) => {
	let options = initial;
	// Entering a child fires leave on the parent, so a bare flag would flicker.
	let depth = 0;
	const setDepth = (next: number) => {
		const wasActive = depth > 0;
		depth = next;
		if (wasActive !== depth > 0) options.onActiveChange(depth > 0);
	};
	const accepts = (event: DragEvent) => options.isEnabled && isFileDrag(event);

	const enter = (event: DragEvent) => {
		if (!accepts(event)) return;
		event.preventDefault();
		setDepth(depth + 1);
	};
	const over = (event: DragEvent) => {
		if (!accepts(event)) return;
		// Without this the browser opens the file instead of dropping it here.
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
	};
	const leave = () => {
		if (depth > 0) setDepth(depth - 1);
	};
	const drop = (event: DragEvent) => {
		if (!accepts(event)) return;
		event.preventDefault();
		setDepth(0);
		const files = [...(event.dataTransfer?.files ?? [])];
		if (files.length > 0) options.onFiles(files);
	};

	node.addEventListener('dragenter', enter);
	node.addEventListener('dragover', over);
	node.addEventListener('dragleave', leave);
	node.addEventListener('drop', drop);
	return {
		update(next) {
			options = next;
		},
		destroy() {
			node.removeEventListener('dragenter', enter);
			node.removeEventListener('dragover', over);
			node.removeEventListener('dragleave', leave);
			node.removeEventListener('drop', drop);
		}
	};
};
