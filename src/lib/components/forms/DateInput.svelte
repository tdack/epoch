<script lang="ts">
	import {
		MONTH_ABBREVIATIONS,
		checkDateText,
		daysInMonthOf,
		formatPickerDate,
		pickerStateOf
	} from '#lib/shared/date-value.js';

	interface Props {
		/** The date as text. Free-form on purpose: `ABT 1900`, `BET 1900 AND 1905` and `1912` are all real dates. */
		value: string;
		/** Id for the text input, so the caller's `<label for>` points at it. */
		id: string;
		/** Classes for the text input, so the field matches the form it sits in. */
		inputClass?: string;
		placeholder?: string;
		isDisabled?: boolean;
	}

	let {
		value = $bindable(),
		id,
		inputClass = '',
		placeholder = 'e.g. 14 APR 1912',
		isDisabled = false
	}: Props = $props();

	const MONTH_NAMES = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	];
	const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

	let isPickerOpen = $state(false);
	/** Errors wait for the first blur so a half-typed date isn't shouted at. */
	let wasTouched = $state(false);
	let viewYear = $state(1900);
	let viewMonth = $state(1);
	let prefix = $state('');
	let pickedDay = $state<number | null>(null);
	let pickedMonth = $state<number | null>(null);
	let pickedYear = $state<number | null>(null);
	let wrapper: HTMLDivElement | undefined = $state();
	/**
	 * Where the picker sits, in viewport pixels. It is `fixed` rather than absolute inside the field:
	 * a dialog scrolls its own content, and an absolutely placed popover is cut off at the dialog's
	 * edge whenever the field is near the bottom or the side.
	 */
	let pickerPosition = $state({ left: 0, top: 0 });

	const PICKER_WIDTH_PX = 256;
	const PICKER_HEIGHT_PX = 340;
	const VIEWPORT_MARGIN_PX = 8;

	const check = $derived(checkDateText(value));
	const problem = $derived(wasTouched && !check.isValid ? check.message : undefined);
	const messageId = $derived(`${id}-message`);

	/** Monday-first, matching the region this is used in; the blanks pad the first week. */
	const leadingBlanks = $derived(
		(new Date(Date.UTC(viewYear, viewMonth - 1, 1)).getUTCDay() + 6) % 7
	);
	const dayCount = $derived(daysInMonthOf(viewYear, viewMonth));

	function placePicker() {
		if (!wrapper) return;
		const rect = wrapper.getBoundingClientRect();
		const left = Math.min(
			Math.max(rect.right - PICKER_WIDTH_PX, VIEWPORT_MARGIN_PX),
			window.innerWidth - PICKER_WIDTH_PX - VIEWPORT_MARGIN_PX
		);
		const below = rect.bottom + 4;
		// Open upwards when there is no room below and more room above.
		const isRoomBelow = below + PICKER_HEIGHT_PX <= window.innerHeight - VIEWPORT_MARGIN_PX;
		const top =
			isRoomBelow || rect.top < PICKER_HEIGHT_PX ? below : rect.top - PICKER_HEIGHT_PX - 4;
		pickerPosition = { left, top: Math.max(VIEWPORT_MARGIN_PX, top) };
	}

	function openPicker() {
		placePicker();
		const state = pickerStateOf(value);
		prefix = state.prefix;
		pickedYear = state.date?.year ?? null;
		pickedMonth = state.date?.month ?? null;
		pickedDay = state.date?.day ?? null;
		viewYear = state.date?.year ?? new Date().getFullYear();
		viewMonth = state.date?.month ?? (state.date ? 1 : new Date().getMonth() + 1);
		isPickerOpen = true;
	}

	function commit(date: { year: number; month: number | null; day: number | null }) {
		value = prefix + formatPickerDate(date);
		wasTouched = true;
		isPickerOpen = false;
		document.getElementById(id)?.focus();
	}

	function shiftYear(delta: number) {
		viewYear = Math.min(9999, Math.max(1, viewYear + delta));
	}

	function onYearInput(event: Event) {
		const year = Number((event.currentTarget as HTMLInputElement).value);
		if (Number.isInteger(year) && year >= 1 && year <= 9999) viewYear = year;
	}

	function onPickerKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		// Close only the picker; the dialog around it would otherwise treat Escape as "cancel".
		event.preventDefault();
		event.stopPropagation();
		isPickerOpen = false;
		document.getElementById(`${id}-picker-button`)?.focus();
	}

	// A dialog scrolls under a fixed popover, and a phone's keyboard resizes the window and scrolls
	// the focused field into view. Closing on either would shut the picker the moment its Year box is
	// tapped, so it follows its field instead.
	$effect(() => {
		if (!isPickerOpen) return;
		const follow = () => placePicker();
		window.addEventListener('scroll', follow, true);
		window.addEventListener('resize', follow);
		return () => {
			window.removeEventListener('scroll', follow, true);
			window.removeEventListener('resize', follow);
		};
	});

	function onWindowPointerDown(event: PointerEvent) {
		if (isPickerOpen && wrapper && !wrapper.contains(event.target as Node)) isPickerOpen = false;
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="relative" bind:this={wrapper}>
	<div class="flex gap-1">
		<input
			{id}
			type="text"
			bind:value
			{placeholder}
			disabled={isDisabled}
			autocomplete="off"
			spellcheck="false"
			aria-invalid={problem ? 'true' : undefined}
			aria-describedby={problem ? messageId : undefined}
			onblur={() => (wasTouched = true)}
			class="{inputClass} min-w-0 flex-1 {problem ? 'border-red-500!' : ''}"
		/>
		<button
			id="{id}-picker-button"
			type="button"
			disabled={isDisabled}
			aria-label="Pick a date"
			aria-haspopup="dialog"
			aria-expanded={isPickerOpen}
			title="Pick a date"
			onclick={() => (isPickerOpen ? (isPickerOpen = false) : openPicker())}
			class="shrink-0 cursor-pointer rounded-lg border border-stone-300 bg-white px-2 text-stone-600 hover:bg-stone-100 disabled:opacity-50"
		>
			<svg
				viewBox="0 0 20 20"
				class="h-4 w-4"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				aria-hidden="true"
			>
				<rect x="3" y="4.5" width="14" height="12" rx="2" />
				<path d="M3 8.5h14M7 3v3M13 3v3" stroke-linecap="round" />
			</svg>
		</button>
	</div>

	{#if problem}
		<p id={messageId} class="mt-1 text-[11px] text-red-700" role="alert">{problem}</p>
	{/if}

	{#if isPickerOpen}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			role="dialog"
			aria-label="Date picker"
			tabindex="-1"
			onkeydown={onPickerKeydown}
			style="left: {pickerPosition.left}px; top: {pickerPosition.top}px;"
			class="fixed z-20 w-64 space-y-2 rounded-xl border border-stone-300 bg-white p-3 text-stone-800 shadow-xl"
		>
			<div class="flex items-center gap-1">
				<button type="button" aria-label="Previous year" onclick={() => shiftYear(-1)} class="nav"
					>‹</button
				>
				<input
					type="number"
					min="1"
					max="9999"
					aria-label="Year"
					value={viewYear}
					oninput={onYearInput}
					class="w-full min-w-0 rounded-md border border-stone-300 px-2 py-1 text-center text-sm"
				/>
				<button type="button" aria-label="Next year" onclick={() => shiftYear(1)} class="nav"
					>›</button
				>
			</div>
			<div class="flex items-center gap-1">
				<button
					type="button"
					aria-label="Previous decade"
					onclick={() => shiftYear(-10)}
					class="nav text-[11px]">−10</button
				>
				<select
					aria-label="Month"
					bind:value={viewMonth}
					class="w-full min-w-0 rounded-md border border-stone-300 px-2 py-1 text-sm"
				>
					{#each MONTH_NAMES as name, i (name)}
						<option value={i + 1}>{name}</option>
					{/each}
				</select>
				<button
					type="button"
					aria-label="Next decade"
					onclick={() => shiftYear(10)}
					class="nav text-[11px]">+10</button
				>
			</div>

			<div class="grid grid-cols-7 gap-0.5 text-center text-[11px]">
				{#each WEEKDAYS as weekday (weekday)}
					<span class="py-1 font-medium text-stone-500">{weekday}</span>
				{/each}
				{#each { length: leadingBlanks } as _, i (i)}
					<span></span>
				{/each}
				{#each { length: dayCount } as _, i (i)}
					{@const day = i + 1}
					{@const isPicked =
						pickedYear === viewYear && pickedMonth === viewMonth && pickedDay === day}
					<button
						type="button"
						aria-label="{day} {MONTH_NAMES[viewMonth - 1]} {viewYear}"
						aria-pressed={isPicked}
						onclick={() => commit({ year: viewYear, month: viewMonth, day })}
						class="cursor-pointer rounded-md py-1 text-xs hover:bg-emerald-100 {isPicked
							? 'bg-emerald-700 text-white hover:bg-emerald-700'
							: ''}"
					>
						{day}
					</button>
				{/each}
			</div>

			<div class="flex gap-1 border-t border-stone-200 pt-2 text-[11px]">
				<button
					type="button"
					onclick={() => commit({ year: viewYear, month: viewMonth, day: null })}
					class="action"
				>
					{MONTH_ABBREVIATIONS[viewMonth - 1]}
					{viewYear} only
				</button>
				<button
					type="button"
					onclick={() => commit({ year: viewYear, month: null, day: null })}
					class="action"
				>
					{viewYear} only
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.nav {
		flex-shrink: 0;
		cursor: pointer;
		border-radius: 0.375rem;
		border: 1px solid var(--color-stone-300);
		padding: 0.125rem 0.5rem;
		font-size: 1rem;
		line-height: 1.5rem;
		min-width: 2rem;
	}
	.nav:hover {
		background: var(--color-stone-100);
	}
	.action {
		flex: 1;
		cursor: pointer;
		border-radius: 0.375rem;
		border: 1px solid var(--color-stone-300);
		padding: 0.25rem 0.5rem;
	}
	.action:hover {
		background: var(--color-stone-100);
	}
</style>
