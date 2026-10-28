<script lang="ts">
	import { tick, type Snippet } from 'svelte';

	/** What the trigger snippet spreads onto its button so the popover can open from it. */
	interface PopoverTriggerAttrs {
		id: string;
		'aria-haspopup': 'menu' | 'dialog';
		'aria-expanded': 'true' | 'false';
		'aria-controls': string | undefined;
		'data-popover-trigger': '';
		onclick: () => void;
		onkeydown: (event: KeyboardEvent) => void;
	}

	interface Props {
		/** Whether the panel is showing. Bindable so a caller can close it after an action. */
		isOpen?: boolean;
		/** The panel's accessible name. */
		label: string;
		/** `menu` holds `menuitem*` elements and is arrow-key navigated; `dialog` holds free-form controls. */
		role?: 'menu' | 'dialog';
		/** Which edge of the trigger the panel lines up with. */
		align?: 'start' | 'end';
		/** Opens upward, for a trigger pinned to the bottom of its pane. */
		isAbove?: boolean;
		/** Draw the panel as a modal bottom sheet over a backdrop, for phones. */
		isSheet?: boolean;
		/** Extra classes for the panel, for width and padding. */
		panelClass?: string;
		/** Extra classes for the wrapper, for its place in the caller's layout. */
		class?: string;
		/** The button that opens the panel; spread `attrs` onto it. */
		trigger: Snippet<[PopoverTriggerAttrs]>;
		children: Snippet<[{ close: () => void }]>;
	}

	let {
		isOpen = $bindable(false),
		label,
		role = 'menu',
		align = 'start',
		isAbove = false,
		isSheet = false,
		panelClass = '',
		class: rootClass = '',
		trigger,
		children
	}: Props = $props();

	const uid = $props.id();
	const triggerId = `${uid}-trigger`;
	const panelId = `${uid}-panel`;
	const ITEM_SELECTOR = '[role^="menuitem"]:not([disabled]):not([aria-disabled="true"])';
	const FOCUSABLE_SELECTOR =
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

	let root: HTMLDivElement | undefined = $state();
	let panel: HTMLDivElement | undefined = $state();
	// The trigger can wrap to either side of a toolbar, so the requested edge is a preference: the
	// panel takes the other edge when the requested one would push it off the screen.
	let placedAlign: 'start' | 'end' = $state('start');

	const triggerElement = () => root?.querySelector<HTMLElement>('[data-popover-trigger]');
	const items = () => [...(panel?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])];

	function close(shouldRestoreFocus = false) {
		if (!isOpen) return;
		isOpen = false;
		if (shouldRestoreFocus) triggerElement()?.focus();
	}

	function place() {
		placedAlign = align;
		const trigger = triggerElement();
		const width = panel?.offsetWidth;
		if (!trigger || !width) return;
		const rect = trigger.getBoundingClientRect();
		const isStartOverflowing = rect.left + width > window.innerWidth;
		const isEndOverflowing = rect.right - width < 0;
		if (align === 'start' && isStartOverflowing && !isEndOverflowing) placedAlign = 'end';
		else if (align === 'end' && isEndOverflowing && !isStartOverflowing) placedAlign = 'start';
	}

	async function open(focusItem: 'first' | 'last' = 'first') {
		isOpen = true;
		await tick();
		if (!isSheet) place();
		if (role === 'menu') {
			const list = items();
			// A radio menu opens on what is chosen now, so the keyboard starts where the user already is;
			// ArrowUp still means "from the end", so it ignores the checked item.
			const checked = list.find((el) => el.getAttribute('aria-checked') === 'true');
			(focusItem === 'last' ? list[list.length - 1] : (checked ?? list[0]))?.focus();
		} else {
			(panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? panel)?.focus();
		}
	}

	const attrs: PopoverTriggerAttrs = $derived({
		id: triggerId,
		'aria-haspopup': role,
		'aria-expanded': isOpen ? 'true' : 'false',
		'aria-controls': isOpen ? panelId : undefined,
		'data-popover-trigger': '',
		onclick: () => (isOpen ? close() : void open()),
		onkeydown: (event) => {
			if (role !== 'menu') return;
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				void open('first');
			} else if (event.key === 'ArrowUp') {
				event.preventDefault();
				void open('last');
			}
		}
	});

	function onPanelKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close(true);
			return;
		}
		if (role === 'menu') {
			const list = items();
			const at = list.indexOf(document.activeElement as HTMLElement);
			const move = (to: number) => {
				event.preventDefault();
				list[(to + list.length) % list.length]?.focus();
			};
			if (event.key === 'ArrowDown') move(at + 1);
			else if (event.key === 'ArrowUp') move(at < 0 ? -1 : at - 1);
			else if (event.key === 'Home') move(0);
			else if (event.key === 'End') move(-1);
			else if (event.key === 'Tab') close();
		} else if (isSheet && event.key === 'Tab') {
			// A modal sheet keeps Tab inside itself; the anchored popover lets focus leave and closes.
			const list = [...(panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])];
			if (list.length === 0) return;
			const first = list[0];
			const last = list[list.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		}
	}

	function onPanelClick(event: MouseEvent) {
		const target = event.target as Element;
		// Choosing an item is the end of a menu; controls marked to stay open (a checked list) do not close it.
		if (
			role === 'menu' &&
			target.closest('[role^="menuitem"]') &&
			!target.closest('[data-keep-open]')
		)
			// Focus goes back to the trigger so it is not stranded on <body>; a link or dialog opened by
			// the item moves it on afterwards.
			close(true);
	}

	function onFocusOut(event: FocusEvent) {
		const next = event.relatedTarget as Node | null;
		if (isOpen && !isSheet && next && !root?.contains(next)) close();
	}
</script>

<svelte:window
	onpointerdown={(event) => {
		if (isOpen && !root?.contains(event.target as Node)) close();
	}}
/>

<div bind:this={root} class="relative inline-block {rootClass}" onfocusout={onFocusOut}>
	{@render trigger(attrs)}
	{#if isOpen}
		{#if isSheet}
			<button
				type="button"
				tabindex="-1"
				aria-label="Close"
				class="fixed inset-0 z-40 cursor-default bg-stone-900/30"
				onclick={() => close(true)}
			></button>
		{/if}
		<div
			bind:this={panel}
			id={panelId}
			{role}
			aria-label={label}
			aria-modal={isSheet && role === 'dialog' ? true : undefined}
			tabindex="-1"
			onkeydown={onPanelKeydown}
			onclick={onPanelClick}
			class="border border-stone-300 bg-white text-stone-800 shadow-lg shadow-stone-900/10 focus:outline-none {isSheet
				? 'fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl p-4'
				: `absolute ${isAbove ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} z-40 rounded-xl ${placedAlign === 'end' ? 'right-0' : 'left-0'}`} {panelClass}"
		>
			{@render children({ close: () => close(true) })}
		</div>
	{/if}
</div>
