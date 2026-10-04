/**
 * What the two 3D canvases share beyond drawing: the context menu, the keyboard cursor and
 * drag-to-relate. The flat canvas keeps its own copy of this because it also has line menus and a
 * popover; these views' lines are not interactive yet, so the smaller version is enough.
 *
 * Drag-to-relate needs no inverse projection: the browser hit-tests the transformed cards, so
 * `elementFromPoint` already answers which card is under the pointer.
 */

import { tick } from 'svelte';
import { keyIntentOf } from './tree-keyboard.js';
import { planeNeighbour, type PlaneNav } from './plane-keyboard.js';
import type { MenuItem } from './tree-view.js';
import type { PersonRef } from './tree-actions.js';

interface Config {
	container: () => HTMLElement | null;
	focusPersonId: () => string | null;
	nav: () => PlaneNav;
	/** The menu of a card or a partnership; empty when the page offers nothing. */
	personMenu: (personId: string) => MenuItem[];
	unionMenu: (unionId: string) => MenuItem[];
	/** Pan just enough to bring a card fully into view. */
	ensureVisible: (personId: string) => void;
	personRef: (personId: string) => PersonRef | null;
	onClearSelection?: () => void;
	onDragRelate?: (relate: { source: PersonRef; target: PersonRef }) => void;
}

export class PlaneInteractions {
	menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
	/** Card the user last moved to with the keys, remembered for the focus it was chosen under. */
	#cursor = $state<{ focusId: string | null; personId: string } | null>(null);
	#dragSourceId: string | null = null;
	/** What had focus when the menu opened, so closing it can hand focus back. */
	#opener: Element | null = null;
	#config: Config;

	constructor(config: Config) {
		this.#config = config;
	}

	/**
	 * The card the keys last moved to while the chart is still centred on the same person. Unlike
	 * `activeId` it does not look at the drawn cards, so a view that folds cards can protect it.
	 */
	get cursorPersonId(): string | null {
		const cursor = this.#cursor;
		return cursor && cursor.focusId === this.#config.focusPersonId() ? cursor.personId : null;
	}

	/** The one card in the tab order: the keyboard cursor while it is valid, else the focus person. */
	activeId = $derived.by(() => {
		const cursor = this.#cursor;
		const hasCursor =
			cursor &&
			cursor.focusId === this.#config.focusPersonId() &&
			this.#config.nav().people.some((p) => p.id === cursor.personId);
		return hasCursor ? cursor.personId : this.#config.focusPersonId();
	});

	#cardOf(personId: string): HTMLElement | null {
		return (
			this.#config
				.container()
				?.querySelector<HTMLElement>(`[data-person-id="${CSS.escape(personId)}"]`) ?? null
		);
	}

	async #moveTo(personId: string) {
		this.#cursor = { focusId: this.#config.focusPersonId(), personId };
		await tick();
		this.#cardOf(personId)?.focus({ preventScroll: true });
		this.#config.ensureVisible(personId);
	}

	/** Where an event happened in canvas pixels; for the keyboard, the middle of the element it came from. */
	#pointOf(event: Event): { x: number; y: number } {
		const rect = this.#config.container()?.getBoundingClientRect();
		const mouse = event as MouseEvent;
		if (
			typeof mouse.clientX === 'number' &&
			(mouse.clientX !== 0 || mouse.clientY !== 0 || event.type === 'click')
		) {
			return { x: mouse.clientX - (rect?.left ?? 0), y: mouse.clientY - (rect?.top ?? 0) };
		}
		const box = ((event.currentTarget ?? event.target) as Element | null)?.getBoundingClientRect();
		if (!box) return { x: 16, y: 16 };
		return {
			x: box.left + box.width / 2 - (rect?.left ?? 0),
			y: box.top + box.height / 2 - (rect?.top ?? 0)
		};
	}

	#open(event: Event, items: MenuItem[]) {
		event.preventDefault();
		const active = document.activeElement;
		const container = this.#config.container();
		this.#opener = active && container?.contains(active) && active !== container ? active : null;
		this.menu = items.length > 0 ? { ...this.#pointOf(event), items } : null;
	}

	openPersonMenu = (event: Event, personId: string) =>
		this.#open(event, this.#config.personMenu(personId));

	openUnionMenu = (event: Event, unionId: string) =>
		this.#open(event, this.#config.unionMenu(unionId));

	/** Close the menu and hand focus back. Idempotent: focus leaving the menu closes it too. */
	closeMenu = () => {
		if (this.menu === null) return;
		this.menu = null;
		const opener = this.#opener;
		this.#opener = null;
		const target = opener?.isConnected
			? (opener as HTMLElement)
			: this.activeId
				? this.#cardOf(this.activeId)
				: null;
		target?.focus({ preventScroll: true });
	};

	onKeydown = (event: KeyboardEvent) => {
		const intent = keyIntentOf({
			key: event.key,
			shiftKey: event.shiftKey,
			altKey: event.altKey,
			target: event.target as Element
		});
		switch (intent.kind) {
			case 'context-menu': {
				const { personId, unionId } = intent.target;
				if (personId) this.openPersonMenu(event, personId);
				else if (unionId) this.openUnionMenu(event, unionId);
				return;
			}
			case 'escape': {
				const wasOpen = this.menu !== null;
				this.closeMenu();
				if (!wasOpen) this.#config.onClearSelection?.();
				return;
			}
			case 'move':
			case 'band': {
				event.preventDefault();
				const next = planeNeighbour(this.#config.nav(), intent.fromId, intent.direction);
				if (next) void this.#moveTo(next);
				return;
			}
		}
	};

	onCardPointerDown = (event: PointerEvent, personId: string) => {
		if (event.button === 0) this.#dragSourceId = personId;
	};

	onPointerUp = (event: PointerEvent) => {
		const sourceId = this.#dragSourceId;
		this.#dragSourceId = null;
		if (!sourceId || !this.#config.onDragRelate) return;
		const targetId = document
			.elementFromPoint(event.clientX, event.clientY)
			?.closest?.('[data-person-id]')
			?.getAttribute('data-person-id');
		const source = this.#config.personRef(sourceId);
		const target = targetId ? this.#config.personRef(targetId) : null;
		if (source && target && source.id !== target.id) this.#config.onDragRelate({ source, target });
	};

	onPointerCancel = () => {
		this.#dragSourceId = null;
	};
}
