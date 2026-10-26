<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import { createSubmission } from '#lib/components/forms/submission.svelte.js';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import { undoApi } from '#lib/api/relationships.js';
	import {
		clearPlaceLocationApi,
		ignorePlaceLocationApi,
		setPlaceLocationApi
	} from '#lib/api/lists.js';
	import type { PlaceLocationDto } from '#lib/shared/places.js';
	import type { ChangeSummary } from '#lib/types/genealogy.js';
	import PlaceMap from './PlaceMap.svelte';

	interface Props {
		treeId: string;
		/** The place record the location belongs to. */
		placeId: string;
		/** Null when the place has none yet. */
		location: PlaceLocationDto | null;
		/** Whether the viewer may change it (`record:edit`). */
		canEdit: boolean;
		tileUrl: string;
		tileAttribution: string;
	}

	let { treeId, placeId, location, canEdit, tileUrl, tileAttribution }: Props = $props();
	const { toasts } = getTreeContext();

	let isPicking = $state(false);
	let draft = $state<{ latitude: number; longitude: number } | null>(null);
	const submission = createSubmission(async (message) => {
		// Someone else changed it first: show what is stored now and leave the choice to the viewer.
		submission.error = `${message} The page now shows the current location.`;
		isPicking = false;
		draft = null;
		await invalidateAll();
	});

	const current = $derived(
		location?.status === 'confirmed' && location.latitude !== null && location.longitude !== null
			? { latitude: location.latitude, longitude: location.longitude }
			: null
	);
	const pin = $derived(isPicking ? (draft ?? current) : current);
	const osmHref = $derived(
		current
			? `https://www.openstreetmap.org/?mlat=${current.latitude}&mlon=${current.longitude}#map=12/${current.latitude}/${current.longitude}`
			: null
	);

	async function changed(change: ChangeSummary | null) {
		isPicking = false;
		draft = null;
		await invalidateAll();
		toasts.push(change?.summary ?? 'Location changed', {
			action: change?.isUndoable
				? {
						label: 'Undo',
						run: async () => {
							try {
								const { undone } = await undoApi(treeId);
								await invalidateAll();
								toasts.push(`Undid: ${undone.summary}`);
							} catch (cause: unknown) {
								toasts.push(messageOf(cause, 'Could not undo'), {
									tone: 'error',
									durationMs: 10_000
								});
							}
						}
					}
				: undefined
		});
	}

	const save = () =>
		draft &&
		submission.submit(async () => {
			const { change } = await setPlaceLocationApi(treeId, placeId, draft!, location?.version);
			await changed(change);
		}, 'Could not save the location');
	const ignore = () =>
		submission.submit(async () => {
			const { change } = await ignorePlaceLocationApi(treeId, placeId, location?.version);
			await changed(change);
		}, 'Could not ignore the location');
	const clear = () =>
		submission.submit(async () => {
			const { change } = await clearPlaceLocationApi(treeId, placeId, location?.version);
			await changed(change);
		}, 'Could not clear the location');
</script>

<section class="mt-4" aria-labelledby="place-location-heading" data-testid="place-location">
	<h2 id="place-location-heading" class="text-sm font-semibold text-stone-900">Location</h2>

	{#if pin}
		<PlaceMap
			class="mt-2 h-64"
			label="Map showing where this place is. The pin is not a keyboard target; the coordinates below give the same information."
			markers={[]}
			{pin}
			{isPicking}
			{tileUrl}
			{tileAttribution}
			onpick={(latitude, longitude) => (draft = { latitude, longitude })}
		/>
	{:else if isPicking}
		<PlaceMap
			class="mt-2 h-64"
			label="Map for choosing this place's location. Click the map to drop the pin."
			{isPicking}
			{tileUrl}
			{tileAttribution}
			onpick={(latitude, longitude) => (draft = { latitude, longitude })}
		/>
	{:else}
		<p class="mt-1 text-sm text-stone-700" data-testid="no-location">
			{location?.status === 'ignored'
				? 'This place is left off maps.'
				: 'This place has no location yet.'}
		</p>
	{/if}

	{#if current && !isPicking}
		<p class="mt-2 text-xs text-stone-600">
			{current.latitude.toFixed(5)}, {current.longitude.toFixed(5)}
			({location?.source === 'gedcom'
				? 'from the file'
				: location?.source === 'photon'
					? 'from a search'
					: 'set by hand'}) ·
			<a href={osmHref} class="text-link" rel="noopener noreferrer" target="_blank"
				>Open in OpenStreetMap</a
			>
		</p>
	{/if}

	{#if canEdit}
		<div class="mt-2 flex flex-wrap items-center gap-2">
			{#if isPicking}
				<p class="text-xs text-stone-600">Click the map or drag the pin, then save.</p>
				<button
					type="button"
					class="btn-primary-sm"
					disabled={!draft || submission.isSaving}
					onclick={save}>Save location</button
				>
				<button
					type="button"
					class="row-action"
					disabled={submission.isSaving}
					onclick={() => {
						isPicking = false;
						draft = null;
						submission.clearError();
					}}>Cancel</button
				>
			{:else}
				<button
					type="button"
					class="row-action"
					data-testid="set-location"
					onclick={() => {
						submission.clearError();
						isPicking = true;
					}}>{current ? 'Move pin' : 'Set location'}</button
				>
				{#if location?.status !== 'ignored'}
					<button type="button" class="row-action" disabled={submission.isSaving} onclick={ignore}
						>Ignore (no real location)</button
					>
				{/if}
				{#if location}
					<button
						type="button"
						class="row-action-danger"
						disabled={submission.isSaving}
						onclick={clear}>Clear</button
					>
				{/if}
			{/if}
		</div>
		{#if submission.error}
			<p class="mt-2 text-sm text-red-700" role="alert">{submission.error}</p>
		{/if}
	{/if}
</section>
