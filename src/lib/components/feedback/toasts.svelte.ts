/** Transient messages after a mutation, optionally with one action (Undo). Owned by the page and passed down. */

export const TOAST_TONES = { SUCCESS: 'success', ERROR: 'error', INFO: 'info' } as const;
export type ToastTone = (typeof TOAST_TONES)[keyof typeof TOAST_TONES];

export interface ToastAction {
	label: string;
	run: () => void | Promise<void>;
}

export interface Toast {
	id: number;
	message: string;
	tone: ToastTone;
	action?: ToastAction;
	/** How long it stays before dismissing itself, unless hovered or focused. */
	durationMs: number;
}

/** Long enough to reach Undo with a keyboard, which is the point of showing it. */
export const UNDO_TOAST_MS = 12_000;
export const DEFAULT_TOAST_MS = 6_000;

export class ToastStore {
	items = $state<Toast[]>([]);
	private nextId = 1;

	push(message: string, options: { tone?: ToastTone; action?: ToastAction; durationMs?: number } = {}): number {
		const id = this.nextId++;
		const durationMs = options.durationMs ?? (options.action ? UNDO_TOAST_MS : DEFAULT_TOAST_MS);
		// One undo offer at a time: it always refers to the latest change, so older offers would mislead.
		const kept = options.action ? this.items.filter((t) => !t.action) : this.items;
		this.items = [...kept, { id, message, tone: options.tone ?? TOAST_TONES.SUCCESS, action: options.action, durationMs }];
		return id;
	}

	dismiss(id: number) {
		this.items = this.items.filter((t) => t.id !== id);
	}
}
