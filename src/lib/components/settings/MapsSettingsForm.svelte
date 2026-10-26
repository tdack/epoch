<script lang="ts">
	import { createSubmission } from '#lib/components/forms/submission.svelte.js';
	import {
		DEFAULT_MAPS_SETTINGS,
		resolveMapsSettings,
		type MapsSettings
	} from '#lib/shared/geo.js';
	import type { SettingsPatch } from '#lib/shared/settings.js';

	interface Props {
		/** The stored group, or undefined when the owner has never changed it. */
		stored: Partial<MapsSettings> | undefined;
		/** Saves the group, or clears it when null; rejects with an Error whose message is shown. */
		onsave: (patch: SettingsPatch) => Promise<void>;
	}

	let { stored, onsave }: Props = $props();

	const submission = createSubmission((message) => {
		submission.error = message;
	});
	let draft = $derived<MapsSettings>(resolveMapsSettings(stored));
	let wasSaved = $state(false);

	const isChanged = $derived(JSON.stringify(draft) !== JSON.stringify(resolveMapsSettings(stored)));
	const inputClass =
		'w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 focus:outline-none';

	// A blank address means "the default", so it is left out and the server fills it in.
	function groupOf(): Partial<MapsSettings> {
		const group: Partial<MapsSettings> = { isGeocodingEnabled: draft.isGeocodingEnabled };
		for (const key of ['photonUrl', 'tileUrl', 'tileAttribution'] as const)
			if (draft[key].trim() !== '') group[key] = draft[key].trim();
		return group;
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		wasSaved = false;
		await submission.submit(async () => {
			await onsave({ maps: groupOf() });
			wasSaved = true;
		}, 'Could not save the map settings.');
	}

	async function useDefaults() {
		wasSaved = false;
		await submission.submit(async () => {
			await onsave({ maps: null });
			wasSaved = true;
		}, 'Could not save the map settings.');
	}
</script>

<form class="flex flex-col gap-4" onsubmit={save} aria-describedby="maps-save-error">
	<label class="flex items-start gap-2 text-sm text-stone-800">
		<input
			type="checkbox"
			bind:checked={draft.isGeocodingEnabled}
			aria-describedby="maps-geocoding-help"
			class="mt-0.5 h-4 w-4 rounded border-stone-300 text-emerald-700 focus:ring-emerald-600"
		/>
		<span>
			Suggest places from OpenStreetMap
			<span id="maps-geocoding-help" class="block text-xs text-stone-600">
				Place text you type is sent to the address below, through this Epoch. Nothing about a person
				or a tree is sent, and text that looks like a street address is never sent.
			</span>
		</span>
	</label>
	<div>
		<label for="maps-photon-url" class="field-label">Photon address</label>
		<input
			id="maps-photon-url"
			type="url"
			bind:value={draft.photonUrl}
			placeholder={DEFAULT_MAPS_SETTINGS.photonUrl}
			autocomplete="off"
			spellcheck="false"
			class={inputClass}
		/>
	</div>
	<div>
		<label for="maps-tile-url" class="field-label">Map tile address</label>
		<input
			id="maps-tile-url"
			type="text"
			bind:value={draft.tileUrl}
			placeholder={DEFAULT_MAPS_SETTINGS.tileUrl}
			autocomplete="off"
			spellcheck="false"
			class={inputClass}
		/>
		<p class="mt-1 text-xs text-stone-600">Use {'{z}'}, {'{x}'} and {'{y}'} where the tile goes.</p>
	</div>
	<div>
		<label for="maps-attribution" class="field-label">Map credit</label>
		<input
			id="maps-attribution"
			type="text"
			bind:value={draft.tileAttribution}
			placeholder={DEFAULT_MAPS_SETTINGS.tileAttribution}
			autocomplete="off"
			class={inputClass}
		/>
		<p class="mt-1 text-xs text-stone-600">
			Shown on every map. The tile provider's terms usually require it.
		</p>
	</div>
	<div class="flex flex-wrap items-center gap-3">
		<button
			type="submit"
			class="rounded-lg bg-emerald-800 px-3 py-1.5 text-sm font-semibold text-amber-50 hover:bg-emerald-700 disabled:cursor-default disabled:opacity-55"
			disabled={submission.isSaving || !isChanged}
		>
			{submission.isSaving ? 'Saving…' : 'Save map settings'}
		</button>
		<button
			type="button"
			class="rounded-lg border border-stone-400 bg-stone-50 px-2.5 py-1 text-xs font-semibold text-stone-800 hover:bg-stone-100 disabled:opacity-55"
			disabled={submission.isSaving || stored === undefined}
			onclick={useDefaults}
		>
			Use the defaults
		</button>
		<p role="status" class="text-sm text-stone-700">
			{#if wasSaved}Saved.{:else if isChanged}Unsaved changes.{/if}
		</p>
	</div>
	<p id="maps-save-error" role="alert" class="text-sm font-medium text-red-800">
		{submission.error ?? ''}
	</p>
</form>
