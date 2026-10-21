<script lang="ts">
	import { createSubmission } from '#lib/components/forms/submission.svelte.js';
	import type { SexKey } from '#lib/shared/palette.js';
	import {
		COLOUR_PRESETS,
		CONTRAST_FLOORS,
		SEX_COLOUR_LABELS,
		floorBreaches,
		paletteWarnings,
		sexContrast,
		type ColourGroup,
		type SettingsDocument,
		type SettingsPatch
	} from '#lib/shared/settings.js';
	import ColourField from './ColourField.svelte';
	import PalettePreview from './PalettePreview.svelte';
	import {
		draftFrom,
		draftPalette,
		groupsOf,
		isDraftChanged,
		patchFrom,
		type ColourDraft
	} from './colour-draft.js';

	interface Props {
		/** Prefixes every id in the editor, so two editors can share a page. */
		idPrefix: string;
		/** The layer as stored; the editor starts from it again after each save. */
		stored: SettingsDocument;
		/** The layers this one inherits from, nearest first; empty for the site default. */
		below: readonly SettingsDocument[];
		/** What an inherited group falls back to, in words: "the site default". */
		inheritedName: string;
		/** Saves the colour groups; rejects with an Error whose message is shown. */
		onsave: (patch: SettingsPatch) => Promise<void>;
	}

	let { idPrefix, stored, below, inheritedName, onsave }: Props = $props();

	let draft = $derived<ColourDraft>(draftFrom(stored));
	// This endpoint is unversioned, so a conflict is not expected; if one arrives it reads as any
	// other failed save.
	const submission = createSubmission((message) => {
		submission.error = message;
	});
	let wasSaved = $state(false);

	const palette = $derived(draftPalette(draft, below));
	const shown = $derived(groupsOf(palette));
	const breaches = $derived(floorBreaches(palette));
	const warnings = $derived(paletteWarnings(palette));
	const isChanged = $derived(isDraftChanged(draft, stored));

	const SEXES: readonly SexKey[] = ['male', 'female', 'unknown'];
	const FOCUS_FIELDS = [
		{ key: 'ancestor', label: 'Ancestor line' },
		{ key: 'descendant', label: 'Descendant line' },
		{ key: 'partner', label: 'Partnership line' }
	] as const;
	const GROUP_NAMES: Readonly<Record<ColourGroup, string>> = {
		sexColours: 'Sex colours',
		tracePalette: 'Trace palette',
		focusColours: 'Focus line'
	};

	function edit(change: Partial<ColourDraft>) {
		draft = { ...draft, ...change };
		wasSaved = false;
	}

	function setSex(key: SexKey, value: string) {
		edit({ sexColours: { ...shown.sexColours, [key]: value } });
	}
	function setTrace(slot: number, value: string) {
		const trace = [...shown.tracePalette.trace];
		trace[slot] = value;
		edit({ tracePalette: { ...shown.tracePalette, trace } });
	}
	function setIntersection(value: string) {
		edit({ tracePalette: { ...shown.tracePalette, intersection: value } });
	}
	function setFocus(key: (typeof FOCUS_FIELDS)[number]['key'], value: string) {
		edit({ focusColours: { ...shown.focusColours, [key]: value } });
	}

	function sexError(key: SexKey): string | null {
		return breaches.find((breach) => breach.sex === key)?.message ?? null;
	}
	function sexHint(key: SexKey): string {
		const ratio = sexContrast(palette, key);
		const figure = (value: number) => `${value.toFixed(1)}:1`;
		return `Border on fill ${figure(ratio.border)} (needs ${CONTRAST_FLOORS.border}:1), text on fill ${figure(ratio.ink)} (needs ${CONTRAST_FLOORS.ink}:1), on the dark stage ${figure(ratio.sphere)} (needs ${CONTRAST_FLOORS.sphere}:1).`;
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		wasSaved = false;
		if (breaches.length > 0) {
			submission.error =
				'Some colours are too hard to read. Change the ones marked above, then save.';
			return;
		}
		await submission.submit(async () => {
			await onsave(patchFrom(draft));
			wasSaved = true;
		}, 'Could not save the colours.');
	}
</script>

{#snippet groupStatus(group: ColourGroup)}
	<div class="flex flex-wrap items-center gap-2 text-xs text-stone-600">
		<span id="{idPrefix}-{group}-status">
			{draft[group] ? 'Your own colours.' : `Using ${inheritedName}.`}
		</span>
		<button
			type="button"
			class="secondary"
			disabled={draft[group] === null}
			onclick={() => edit({ [group]: null })}
		>
			Use {inheritedName}<span class="sr-only"> for {GROUP_NAMES[group].toLowerCase()}</span>
		</button>
	</div>
{/snippet}

<form class="flex flex-col gap-5" onsubmit={save} aria-describedby="{idPrefix}-save-error">
	<div class="flex flex-wrap items-center gap-2" role="group" aria-label="Presets">
		<span class="text-sm font-semibold text-stone-800">Start from</span>
		{#each COLOUR_PRESETS as preset (preset.id)}
			<button
				type="button"
				class="secondary"
				onclick={() =>
					edit({
						sexColours: preset.groups.sexColours,
						tracePalette: preset.groups.tracePalette,
						focusColours: preset.groups.focusColours
					})}
			>
				{preset.label}
			</button>
		{/each}
		<button
			type="button"
			class="secondary"
			onclick={() => edit({ sexColours: null, tracePalette: null, focusColours: null })}
		>
			Reset all to {inheritedName}
		</button>
	</div>

	<fieldset aria-describedby="{idPrefix}-sexColours-status">
		<legend>Sex colours</legend>
		<p class="mb-2 text-xs text-stone-600">
			The card border and the sphere in the 3D views. The card fill and the Orrery star are made
			from it.
		</p>
		{@render groupStatus('sexColours')}
		<div class="mt-3 grid gap-4 sm:grid-cols-3">
			{#each SEXES as sex (sex)}
				<ColourField
					id="{idPrefix}-sex-{sex}"
					label={SEX_COLOUR_LABELS[sex]}
					value={shown.sexColours[sex]}
					onchange={(value) => setSex(sex, value)}
					error={sexError(sex)}
					hint={sexHint(sex)}
				/>
			{/each}
		</div>
	</fieldset>

	<fieldset aria-describedby="{idPrefix}-tracePalette-status">
		<legend>Trace palette</legend>
		<p class="mb-2 text-xs text-stone-600">
			One colour for each person or line traced in the 3D views, in the order they were added, and
			one for where traced paths meet.
		</p>
		{@render groupStatus('tracePalette')}
		<div class="mt-3 grid gap-4 sm:grid-cols-3">
			{#each shown.tracePalette.trace as colour, slot (slot)}
				<ColourField
					id="{idPrefix}-trace-{slot}"
					label="Trace {slot + 1}"
					value={colour}
					onchange={(value) => setTrace(slot, value)}
				/>
			{/each}
			<ColourField
				id="{idPrefix}-intersection"
				label="Where traces meet"
				value={shown.tracePalette.intersection}
				onchange={setIntersection}
			/>
		</div>
	</fieldset>

	<fieldset aria-describedby="{idPrefix}-focusColours-status">
		<legend>Focus line</legend>
		<p class="mb-2 text-xs text-stone-600">
			The focus person's ancestors, descendants and partnerships. The 3D views draw a lighter shade,
			so the line shows on their dark stage.
		</p>
		{@render groupStatus('focusColours')}
		<div class="mt-3 grid gap-4 sm:grid-cols-3">
			{#each FOCUS_FIELDS as field (field.key)}
				<ColourField
					id="{idPrefix}-focus-{field.key}"
					label={field.label}
					value={shown.focusColours[field.key]}
					onchange={(value) => setFocus(field.key, value)}
				/>
			{/each}
		</div>
	</fieldset>

	{#if warnings.length > 0}
		<div class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
			<p class="font-semibold">Worth a second look</p>
			<ul class="mt-1 list-disc pl-5">
				{#each warnings as warning (warning)}
					<li>{warning}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<PalettePreview {palette} label="Preview of these colours" />

	<div class="flex flex-wrap items-center gap-3">
		<button type="submit" class="primary" disabled={submission.isSaving || !isChanged}>
			{submission.isSaving ? 'Saving…' : 'Save colours'}
		</button>
		<p role="status" class="text-sm text-stone-700">
			{#if wasSaved}Saved.{:else if isChanged}Unsaved changes.{/if}
		</p>
	</div>
	<p id="{idPrefix}-save-error" role="alert" class="text-sm font-medium text-red-800">
		{submission.error ?? ''}
	</p>
</form>

<style>
	fieldset {
		border: 1px solid #d6d3d1;
		border-radius: 0.75rem;
		padding: 0.75rem 1rem 1rem;
	}
	legend {
		padding: 0 0.25rem;
		font-weight: 700;
		color: #1c1917;
	}
	button {
		cursor: pointer;
		border-radius: 0.5rem;
		padding: 0.375rem 0.75rem;
		font-size: 0.875rem;
		font-weight: 600;
	}
	button:disabled {
		cursor: default;
		opacity: 0.55;
	}
	.primary {
		background: #065f46;
		color: #fffbeb;
	}
	.primary:not(:disabled):hover {
		background: #047857;
	}
	.secondary {
		border: 1px solid #a8a29e;
		background: #fdfbf7;
		color: #292524;
		padding: 0.25rem 0.625rem;
		font-size: 0.75rem;
	}
	.secondary:not(:disabled):hover {
		background: #f5f5f4;
	}
</style>
