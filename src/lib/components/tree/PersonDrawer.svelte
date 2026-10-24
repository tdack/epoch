<script lang="ts">
	import { tick } from 'svelte';
	import { X, ExternalLink } from '@lucide/svelte';
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import type { MarksStore } from '#lib/components/layout/marks-store.svelte.js';
	import PersonView from '#lib/components/person/PersonView.svelte';
	import { personPath } from '#lib/components/person/person-paths.js';
	import type { PersonPageDto } from '#lib/shared/person-page.js';
	import type { TreeRole } from '#lib/shared/roles.js';
	import type { TreeEditor } from './tree-editor.svelte.js';
	import {
		DRAWER_MIN_WIDTH_PX,
		DRAWER_WIDTH_STORAGE_KEY,
		canResizeDrawer,
		clampDrawerWidth,
		maxDrawerWidth
	} from './drawer-width.js';

	/**
	 * The frame around a person beside the canvas: a panel over everything, or a card docked beside
	 * the canvas on wide windows; its resize handle, Close and Escape, and the link to the full page. What is inside it is the same
	 * `PersonView` the person page renders.
	 */
	interface Props {
		/** The person's page data; null while it loads. */
		page: PersonPageDto | null;
		treeId: string;
		/** The tree's slug, for the links this builds (ADR-045); without one they use the id. */
		treeSlug?: string | null;
		role: TreeRole | undefined;
		/** The member's own person in this tree; private to them. */
		selfPersonId?: string | null;
		/** Set when the page data could not be loaded. */
		error?: string | null;
		onClose: () => void;
		/** A relative was clicked: the canvas moves to them rather than leaving for their page. */
		onSelectPerson: (id: string) => void;
		editor: TreeEditor;
		toasts: ToastStore;
		marks: MarksStore;
		/**
		 * Sit in the page's flow beside the canvas, at its height, instead of floating over everything.
		 * The page decides, since only it knows whether there is room for both.
		 */
		isDocked?: boolean;
	}

	let {
		page,
		treeId,
		treeSlug = null,
		role,
		selfPersonId = null,
		error = null,
		onClose,
		onSelectPerson,
		editor,
		toasts,
		marks,
		isDocked = false
	}: Props = $props();
	const treeRef = $derived({ id: treeId, slug: treeSlug });

	let panel: HTMLElement | null = $state(null);

	// Focus the heading when a person opens, so a keyboard or screen-reader user lands on who this
	// is. Keyed on the id: a reload after an edit shows the same person and must not take focus.
	let focusedId: string | null = null;
	$effect(() => {
		const id = page?.person.id ?? null;
		if (!id || id === focusedId) return;
		focusedId = id;
		void tick().then(() => panel?.querySelector<HTMLElement>('h2')?.focus());
	});

	const KEY_STEP_PX = 16;
	/** The strip left of a docked card that holds the handle and parts it from the canvas. */
	const DOCKED_GUTTER_PX = 16;
	/** The page's side padding and the gutter, which a docked drawer shares the window with. */
	const DOCKED_CHROME_PX = 48 + DOCKED_GUTTER_PX;

	let viewportWidthPx = $state(0);
	/** The width the drawer and canvas share, which the limits are measured against. */
	const roomPx = $derived(isDocked ? viewportWidthPx - DOCKED_CHROME_PX : viewportWidthPx);
	/** What the viewer asked for; the drawn width is this held inside the current window. */
	let wantedWidthPx = $state(readStoredWidth());
	const isResizable = $derived(canResizeDrawer(roomPx));
	const widthPx = $derived(clampDrawerWidth(wantedWidthPx, roomPx));
	// Inline only when resizable: below the breakpoint the classes keep the phone and tablet layout.
	const widthStyle = $derived(isResizable ? `width: ${widthPx}px` : undefined);

	function readStoredWidth(): number {
		try {
			const stored = localStorage.getItem(DRAWER_WIDTH_STORAGE_KEY);
			return stored === null ? DRAWER_MIN_WIDTH_PX : Number(stored);
		} catch {
			return DRAWER_MIN_WIDTH_PX;
		}
	}

	function storeWidth() {
		try {
			localStorage.setItem(DRAWER_WIDTH_STORAGE_KEY, String(widthPx));
		} catch {
			// A remembered width is a convenience only.
		}
	}

	let drag: { pointerId: number; startX: number; startWidthPx: number } | null = $state(null);

	function startDrag(event: PointerEvent) {
		if (event.button !== 0) return;
		// Captured, so a fast drag that leaves the thin handle never reaches the canvas and pans it.
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		drag = { pointerId: event.pointerId, startX: event.clientX, startWidthPx: widthPx };
		event.preventDefault();
	}

	function moveDrag(event: PointerEvent) {
		if (drag?.pointerId !== event.pointerId) return;
		// Relative to where it was grabbed, so the edge does not jump to the pointer on the first move.
		wantedWidthPx = clampDrawerWidth(drag.startWidthPx + drag.startX - event.clientX, roomPx);
	}

	function endDrag(event: PointerEvent) {
		if (drag?.pointerId !== event.pointerId) return;
		drag = null;
		storeWidth();
	}

	function handleKeydown(event: KeyboardEvent) {
		const next =
			event.key === 'ArrowLeft'
				? widthPx + KEY_STEP_PX
				: event.key === 'ArrowRight'
					? widthPx - KEY_STEP_PX
					: event.key === 'Home'
						? DRAWER_MIN_WIDTH_PX
						: event.key === 'End'
							? maxDrawerWidth(roomPx)
							: null;
		if (next === null) return;
		event.preventDefault();
		wantedWidthPx = clampDrawerWidth(next, roomPx);
		storeWidth();
	}

	function resetWidth() {
		wantedWidthPx = DRAWER_MIN_WIDTH_PX;
		storeWidth();
	}

	function keydown(event: KeyboardEvent) {
		// A dialog opened from a section sits inside this panel; its own Escape must not close the panel too.
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		if ((event.target as Element).closest('dialog')) return;
		onClose();
	}
</script>

<svelte:window bind:innerWidth={viewportWidthPx} />

{#snippet resizeHandle(placement: string)}
	{#if isResizable}
		<!-- A focusable separator is the ARIA pattern for a splitter, so it takes keys like a control. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize details panel"
			aria-valuenow={widthPx}
			aria-valuemin={DRAWER_MIN_WIDTH_PX}
			aria-valuemax={maxDrawerWidth(roomPx)}
			tabindex="0"
			title="Drag to resize; double-click to reset"
			onpointerdown={startDrag}
			onpointermove={moveDrag}
			onpointerup={endDrag}
			onpointercancel={endDrag}
			ondblclick={resetWidth}
			onkeydown={handleKeydown}
			class={[
				'group flex cursor-col-resize touch-none items-center justify-center focus-ring',
				placement
			]}
		>
			<span
				class={[
					'h-10 w-1 rounded-full transition-colors group-hover:bg-stone-500 group-focus-visible:bg-stone-500',
					drag ? 'bg-stone-600' : 'bg-stone-300'
				]}
				aria-hidden="true"
			></span>
		</div>
	{/if}
{/snippet}

{#snippet panelBody()}
	{#if page}
		<div
			class="flex items-center justify-between border-b border-stone-200/90 bg-[#fbf8f0] px-6 py-3"
		>
			<a
				href={personPath(treeRef, page.person.id)}
				class="text-link inline-flex items-center gap-1 text-xs"
			>
				<ExternalLink class="h-3 w-3" />
				<span>Open full page</span>
			</a>
			<button
				type="button"
				onclick={onClose}
				aria-label="Close details"
				class="inline-flex cursor-pointer items-center justify-center rounded-lg p-1.5 text-stone-500 focus-ring transition-colors hover:bg-stone-200/60 hover:text-stone-800 coarse:min-h-11 coarse:min-w-11"
			>
				<X class="h-5 w-5" />
			</button>
		</div>
		<div class="flex-1 overflow-y-auto p-6">
			<PersonView
				dto={page}
				{treeId}
				{treeSlug}
				{role}
				{selfPersonId}
				layout="drawer"
				relativeTarget={{ kind: 'select', onSelect: onSelectPerson }}
				{editor}
				{toasts}
				{marks}
			/>
		</div>
	{:else}
		<div class="p-6">
			<button
				type="button"
				onclick={onClose}
				aria-label="Close details"
				class="float-right inline-flex cursor-pointer items-center justify-center rounded-lg p-1.5 text-stone-500 focus-ring hover:text-stone-800 coarse:min-h-11 coarse:min-w-11"
				><X class="h-5 w-5" /></button
			>
			<p class="text-sm text-red-800">{error}</p>
		</div>
	{/if}
{/snippet}

{#if page || error}
	{#if isDocked}
		<!-- Absolutely placed inside, so a long life story scrolls in the card instead of stretching
		     the row, and with it the canvas, past the window. -->
		<div class="relative flex-none" style="width: {widthPx + DOCKED_GUTTER_PX}px">
			{@render resizeHandle('absolute inset-y-0 left-0 w-4')}
			<div
				bind:this={panel}
				data-testid="person-drawer"
				role={page ? 'complementary' : 'alert'}
				aria-label={page ? 'Person details' : undefined}
				onkeydown={keydown}
				class={[
					'absolute inset-y-0 right-0 left-4 flex flex-col overflow-hidden rounded-2xl border border-stone-300/80 bg-[#fcfaf5]',
					{ 'select-none': drag }
				]}
			>
				{@render panelBody()}
			</div>
		</div>
	{:else}
		<div
			bind:this={panel}
			data-testid="person-drawer"
			role={page ? 'complementary' : 'alert'}
			aria-label={page ? 'Person details' : undefined}
			onkeydown={keydown}
			style={widthStyle}
			class={[
				'fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-stone-300 bg-[#fcfaf5]/98 shadow-2xl backdrop-blur-xl sm:w-96',
				{ 'select-none': drag }
			]}
		>
			{@render resizeHandle('absolute inset-y-0 -left-1.5 z-10 w-3')}
			{@render panelBody()}
		</div>
	{/if}
{/if}
