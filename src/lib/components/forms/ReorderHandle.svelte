<script lang="ts">
	import { tick } from 'svelte';
	import { shouldReduceMotion } from '#lib/components/motion.js';
	import { dropIndex, moveItem } from './reorder.js';

	interface Props {
		/** This row's id. The row element must carry `data-reorder-id` with the same value. */
		id: string;
		/** The row's name, for the accessible name and the announcement. */
		name: string;
		/** Every row's id in the current order. */
		ids: readonly string[];
		/** True while a save is in flight, so a second reorder cannot start. */
		isDisabled?: boolean;
		/**
		 * Called once per drop or arrow press with the new order. Await the save in it: focus returns to
		 * the handle only after it settles, because the list may re-render and drop focus.
		 */
		onreorder: (ids: string[]) => Promise<void> | void;
	}

	let { id, name, ids, isDisabled = false, onreorder }: Props = $props();

	const uid = $props.id();
	let button = $state<HTMLButtonElement>();
	let announcement = $state('');
	let drag: { from: number; to: number; startY: number; rows: HTMLElement[] } | null = null;

	const index = $derived(ids.indexOf(id));
	const rowOf = () => button!.closest<HTMLElement>('[data-reorder-id]')!;

	async function commit(next: string[]) {
		await onreorder(next);
		announcement = `${name} moved to position ${next.indexOf(id) + 1} of ${next.length}`;
		await tick();
		button?.focus();
	}

	function onkeydown(event: KeyboardEvent) {
		const by = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
		if (!by) return;
		event.preventDefault();
		const to = index + by;
		if (isDisabled || to < 0 || to >= ids.length) return;
		void commit(moveItem(ids, index, to));
	}

	function onpointerdown(event: PointerEvent) {
		if (isDisabled || event.button > 0) return;
		const row = rowOf();
		const rows = [...row.parentElement!.children].filter((c): c is HTMLElement =>
			c.hasAttribute('data-reorder-id')
		);
		drag = { from: index, to: index, startY: event.clientY, rows };
		button!.setPointerCapture(event.pointerId);
		const transition = shouldReduceMotion() ? '' : 'transform 120ms';
		for (const r of rows) r.style.transition = r === row ? 'none' : transition;
		row.style.position = 'relative';
		row.style.zIndex = '1';
	}

	function onpointermove(event: PointerEvent) {
		if (!drag) return;
		const dy = event.clientY - drag.startY;
		const own = drag.rows[drag.from]!;
		// offsetTop ignores the transforms already applied, so rows are measured at rest.
		const centres = drag.rows.map((r) => r.offsetTop + r.offsetHeight / 2);
		drag.to = dropIndex(centres, drag.from, centres[drag.from]! + dy);
		const shift = own.offsetHeight;
		drag.rows.forEach((r, i) => {
			if (i === drag!.from) r.style.transform = `translateY(${dy}px)`;
			else if (drag!.from < drag!.to && i > drag!.from && i <= drag!.to)
				r.style.transform = `translateY(${-shift}px)`;
			else if (drag!.to < drag!.from && i >= drag!.to && i < drag!.from)
				r.style.transform = `translateY(${shift}px)`;
			else r.style.transform = '';
		});
	}

	function finish(event: PointerEvent, isCancelled: boolean) {
		if (!drag) return;
		const { from, to, rows } = drag;
		drag = null;
		button?.releasePointerCapture(event.pointerId);
		for (const r of rows) r.removeAttribute('style');
		if (!isCancelled && to !== from) void commit(moveItem(ids, from, to));
	}
</script>

<button
	bind:this={button}
	type="button"
	class="inline-flex min-h-8 min-w-8 cursor-grab touch-none items-center justify-center rounded-md text-stone-500 focus-ring select-none hover:bg-stone-200/70 active:cursor-grabbing disabled:cursor-default disabled:opacity-50 coarse:min-h-11 coarse:min-w-11"
	disabled={isDisabled}
	aria-label="Reorder {name}"
	aria-describedby="{uid}-hint"
	{onkeydown}
	{onpointerdown}
	{onpointermove}
	onpointerup={(e) => finish(e, false)}
	onpointercancel={(e) => finish(e, true)}
>
	<span aria-hidden="true">⠿</span>
</button>
<span id="{uid}-hint" class="sr-only">Drag, or press the up and down arrow keys, to reorder.</span>
<span class="sr-only" aria-live="polite">{announcement}</span>
