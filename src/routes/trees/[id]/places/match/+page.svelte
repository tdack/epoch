<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import PlaceMap from '#lib/components/maps/PlaceMap.svelte';
	import BaseModal from '#lib/components/modals/BaseModal.svelte';
	import PlaceRewriteDialog from '#lib/components/modals/PlaceRewriteDialog.svelte';
	import Pager from '#lib/components/lists/Pager.svelte';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import { findPlaceApi, ignorePlaceLocationApi } from '#lib/api/lists.js';
	import {
		acceptMatchApi,
		acceptMatchesApi,
		searchPlaceAgainApi,
		startPlaceMatchApi
	} from '#lib/api/place-match.js';
	import { undoApi } from '#lib/api/relationships.js';
	import {
		HIGH_MATCH_SCORE,
		matchScoreLabel,
		type MatchCandidateDto,
		type MatchPlaceDto
	} from '#lib/shared/place-match.js';
	import { treePath } from '#lib/shared/tree-slug.js';
	import type { ChangeSummary } from '#lib/types/genealogy.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const { toasts } = getTreeContext();

	/** Modest on purpose: a run is a second a place, so a faster poll would only add reads. */
	const POLL_MS = 4000;

	const treeId = $derived(data.summary.tree.id);
	const base = $derived(treePath(data.summary.tree));
	const review = $derived(data.review);
	const run = $derived(review.run);
	const isRunning = $derived(run?.status === 'running');
	const placeHref = (name: string) => `${base}/place?name=${encodeURIComponent(name)}`;

	let selectedId = $state<string | null>(null);
	const selected = $derived(
		review.places.find((p) => p.id === selectedId) ?? review.places[0] ?? null
	);
	let busyId = $state<string | null>(null);
	let isStarting = $state(false);
	let searchingId = $state<string | null>(null);
	let searchText = $state('');
	let renaming = $state<{ place: MatchPlaceDto; candidate: MatchCandidateDto } | null>(null);
	let isConfirmingBulk = $state(false);
	let isAcceptingBulk = $state(false);
	let bulkError = $state<string | null>(null);

	$effect(() => {
		if (!isRunning) return;
		const timer = setInterval(() => void invalidateAll(), POLL_MS);
		return () => clearInterval(timer);
	});

	const markers = $derived(
		selected
			? selected.candidates.map((c) => ({
					id: String(c.rank),
					label: `${c.rank + 1}. ${c.displayName}`,
					href: `https://www.openstreetmap.org/?mlat=${c.latitude}&mlon=${c.longitude}#map=12/${c.latitude}/${c.longitude}`,
					latitude: c.latitude,
					longitude: c.longitude,
					count: selected.facts
				}))
			: []
	);

	function undoAction(change: ChangeSummary | null) {
		return change?.isUndoable
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
			: undefined;
	}

	async function act(place: MatchPlaceDto, work: () => Promise<void>, failure: string) {
		busyId = place.id;
		try {
			await work();
		} catch (cause: unknown) {
			toasts.push(messageOf(cause, failure), { tone: 'error', durationMs: 10_000 });
		} finally {
			busyId = null;
		}
	}

	const start = async () => {
		isStarting = true;
		try {
			await startPlaceMatchApi(treeId);
			await invalidateAll();
		} catch (cause: unknown) {
			toasts.push(messageOf(cause, 'Could not start the place match'), {
				tone: 'error',
				durationMs: 10_000
			});
		} finally {
			isStarting = false;
		}
	};

	const accept = (place: MatchPlaceDto, candidate: MatchCandidateDto) =>
		act(
			place,
			async () => {
				const { change } = await acceptMatchApi(treeId, place.id, candidate);
				await invalidateAll();
				toasts.push(change?.summary ?? 'This place already has a location', {
					action: undoAction(change)
				});
			},
			'Could not save the location'
		);

	const ignore = (place: MatchPlaceDto) =>
		act(
			place,
			async () => {
				const { change } = await ignorePlaceLocationApi(treeId, place.id, undefined);
				await invalidateAll();
				toasts.push(change?.summary ?? 'Left off maps', { action: undoAction(change) });
			},
			'Could not ignore the place'
		);

	// The rename is its own change, with the preview the dialog gives. The place the facts now sit
	// at may be another place (a merge), so the location goes to the place that has the new text.
	async function renamed(change: ChangeSummary | null, name: string) {
		const target = renaming;
		renaming = null;
		if (!target) return;
		try {
			const now = await findPlaceApi(treeId, name);
			if (now && !now.location) {
				const { change: located } = await acceptMatchApi(treeId, now.id, target.candidate);
				await invalidateAll();
				toasts.push(`Renamed the place to ${name} and set its location`, {
					action: undoAction(located ?? change)
				});
				return;
			}
		} catch (cause: unknown) {
			toasts.push(messageOf(cause, 'Renamed, but could not save the location'), {
				tone: 'error',
				durationMs: 10_000
			});
		}
		await invalidateAll();
	}

	function startSearch(place: MatchPlaceDto) {
		searchingId = place.id;
		searchText = place.name;
	}

	const searchAgain = (place: MatchPlaceDto) =>
		act(
			place,
			async () => {
				const found = await searchPlaceAgainApi(treeId, place.id, searchText.trim());
				searchingId = null;
				selectedId = place.id;
				await invalidateAll();
				toasts.push(found.length === 0 ? 'Nothing found for that text' : 'Candidates updated', {
					tone: found.length === 0 ? 'info' : 'success'
				});
			},
			'Could not search for the place'
		);

	async function acceptAllHigh() {
		isAcceptingBulk = true;
		bulkError = null;
		let accepted = 0;
		let calls = 0;
		let lastChange: ChangeSummary | null = null;
		try {
			// A call writes one batch (one change); keep going until none is left.
			for (;;) {
				const result = await acceptMatchesApi(treeId, HIGH_MATCH_SCORE);
				accepted += result.accepted;
				lastChange = result.change ?? lastChange;
				calls++;
				if (result.accepted === 0 || result.remaining === 0) break;
			}
			isConfirmingBulk = false;
			await invalidateAll();
			toasts.push(
				calls <= 1
					? `Set the location of ${accepted} ${accepted === 1 ? 'place' : 'places'}`
					: `Set the location of ${accepted} places in ${calls} changes`,
				// Undo reverses the latest change only; the others are in the change history.
				{ action: undoAction(lastChange) }
			);
		} catch (cause: unknown) {
			bulkError = messageOf(cause, 'Could not accept the matches');
			await invalidateAll();
		} finally {
			isAcceptingBulk = false;
		}
	}

	const pageHref = (offset: number) =>
		`${base}/places/match${offset > 0 ? `?offset=${offset}` : ''}`;
	const percent = (score: number) => `${Math.round(score * 100)}%`;
</script>

<svelte:head>
	<title>Match places · {data.summary.tree.name} · Epoch</title>
</svelte:head>

<nav aria-label="Breadcrumb" class="text-sm text-stone-600">
	<a href="{base}/places" class="text-link">Places</a>
</nav>
<header class="mt-1">
	<h1 class="text-2xl font-bold text-stone-900">Match places</h1>
	<p class="mt-1 max-w-2xl text-sm text-stone-600">
		Epoch looks up places that have no location on OpenStreetMap, one at a time, and offers the best
		matches for you to review. Only the place text is sent, and only for places used by people who
		have died or are marked public. Text that looks like a street address is never sent. Nothing
		changes until you accept it.
	</p>
</header>

<section class="mt-4 rounded-xl border border-stone-200 bg-white p-4" aria-labelledby="run-heading">
	<h2 id="run-heading" class="text-sm font-semibold text-stone-900">Lookup</h2>
	<div class="mt-2 flex flex-wrap items-center gap-3">
		<button
			type="button"
			class="btn-primary"
			data-testid="start-match"
			disabled={isRunning || isStarting || !review.isGeocodingEnabled}
			onclick={start}>{run ? 'Match places again' : 'Match places'}</button
		>
		{#if !review.isGeocodingEnabled}
			<p class="text-sm text-stone-700" data-testid="geocoding-off">
				Place suggestions are switched off for this install.
			</p>
		{:else if run}
			<p class="text-sm text-stone-700" role="status" data-testid="run-status">
				{#if run.status === 'running'}
					Looked up {run.searched} of {run.total}
					{run.total === 1 ? 'place' : 'places'}. {run.matched} so far have candidates.
				{:else if run.status === 'done'}
					Looked up {run.searched}
					{run.searched === 1 ? 'place' : 'places'}; {run.matched}
					{run.matched === 1 ? 'has' : 'have'} candidates.
				{:else}
					The last run did not finish. Looked up {run.searched} of {run.total}. You can run it
					again.
				{/if}
			</p>
		{/if}
	</div>
	{#if run && run.skippedByCap > 0}
		<p class="mt-2 text-sm text-stone-700" data-testid="cap-note">
			{run.skippedByCap} more {run.skippedByCap === 1 ? 'place was' : 'places were'} left for next time.
			A run looks up at most 2,000 places, most-used first. Review these, then run it again.
		</p>
	{/if}
</section>

{#if review.places.length === 0}
	<p class="mt-4 text-sm text-stone-700" data-testid="no-matches">
		{run
			? isRunning
				? 'Candidates appear here as places are looked up.'
				: 'No place has a candidate to review.'
			: 'Run the lookup to find candidates for places with no location.'}
	</p>
{:else}
	<div class="mt-4 flex flex-wrap items-center gap-3">
		<button
			type="button"
			class="btn-primary-sm"
			data-testid="accept-high"
			disabled={review.highCount === 0 || isAcceptingBulk}
			onclick={() => (isConfirmingBulk = true)}>Accept all High ({review.highCount})</button
		>
		<p class="text-xs text-stone-600">
			High means the candidate names the parts of the place, is a town or suburb, and sits near
			places you have already located.
		</p>
	</div>

	<div class="mt-4 grid gap-4 lg:grid-cols-2 lg:items-start">
		<div>
			<ul
				class="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white"
				data-testid="match-list"
			>
				{#each review.places as place (place.id)}
					{@const best = place.candidates[0]}
					<li
						class="space-y-2 px-4 py-3 text-sm {selected?.id === place.id
							? 'bg-emerald-50/60'
							: ''}"
						data-testid="match-row"
					>
						<div class="flex flex-wrap items-baseline justify-between gap-2">
							<button
								type="button"
								class="text-left font-semibold text-emerald-900 hover:underline"
								aria-pressed={selected?.id === place.id}
								onclick={() => (selectedId = place.id)}>{place.name}</button
							>
							<span class="text-stone-600"
								>{place.facts} {place.facts === 1 ? 'fact' : 'facts'}</span
							>
						</div>
						{#if best}
							<p class="text-stone-800">
								{best.displayName}
								{#if best.kind}<span class="text-xs text-stone-500">({best.kind})</span>{/if}
								<span
									class="ml-1 rounded-full border border-stone-300 px-2 py-0.5 text-xs font-semibold {matchScoreLabel(
										best.score
									) === 'High'
										? 'bg-emerald-100 text-emerald-900'
										: 'bg-stone-100 text-stone-700'}"
									title="Score {percent(best.score)}">{matchScoreLabel(best.score)}</span
								>
							</p>
						{/if}
						<div class="flex flex-wrap items-center gap-1">
							{#if best}
								<button
									type="button"
									class="btn-primary-sm"
									disabled={busyId === place.id}
									onclick={() => accept(place, best)}>Accept</button
								>
								<button
									type="button"
									class="row-action"
									disabled={busyId === place.id}
									onclick={() => (renaming = { place, candidate: best })}>Accept and rename</button
								>
							{/if}
							<button
								type="button"
								class="row-action"
								disabled={busyId === place.id}
								onclick={() => ignore(place)}>Ignore</button
							>
							<a class="row-action" href={placeHref(place.name)}>Pick on map</a>
							<button
								type="button"
								class="row-action"
								disabled={busyId === place.id}
								onclick={() => startSearch(place)}>Search again</button
							>
						</div>
						{#if searchingId === place.id}
							<form
								class="flex flex-wrap items-end gap-2"
								onsubmit={(event) => {
									event.preventDefault();
									void searchAgain(place);
								}}
							>
								<div>
									<label for="search-{place.id}" class="field-label">Search for</label>
									<input
										id="search-{place.id}"
										class="w-64 rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
										bind:value={searchText}
									/>
								</div>
								<button
									type="submit"
									class="btn-primary-sm"
									disabled={busyId === place.id || searchText.trim() === ''}>Search</button
								>
								<button type="button" class="row-action" onclick={() => (searchingId = null)}
									>Cancel</button
								>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
			<Pager
				summary="Showing {review.offset + 1} to {review.offset + review.places.length}"
				previousHref={review.offset > 0
					? pageHref(Math.max(0, review.offset - review.limit))
					: null}
				nextHref={review.hasMore ? pageHref(review.offset + review.limit) : null}
			/>
		</div>

		{#if selected}
			<div class="lg:sticky lg:top-4" data-testid="match-preview">
				<h2 class="text-sm font-semibold text-stone-900">Candidates for {selected.name}</h2>
				{#key selected.id}
					<PlaceMap
						class="mt-2 h-72"
						label="Map of the candidates for {selected.name}. Pins are not keyboard targets; the list below has the same candidates."
						{markers}
						tileUrl={data.tiles.tileUrl}
						tileAttribution={data.tiles.tileAttribution}
					/>
				{/key}
				<ol class="mt-2 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
					{#each selected.candidates as candidate (candidate.rank)}
						<li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
							<span>
								{candidate.rank + 1}. {candidate.displayName}
								<span class="text-xs text-stone-500"
									>{candidate.kind ?? 'place'} · {matchScoreLabel(candidate.score)}</span
								>
							</span>
							<button
								type="button"
								class="row-action"
								disabled={busyId === selected.id}
								onclick={() => accept(selected, candidate)}>Use this</button
							>
						</li>
					{/each}
				</ol>
				<p class="mt-2 text-xs text-stone-600">
					Accept and rename changes the text on every fact at the place to the candidate's name. It
					is a separate change from the location, and each can be undone.
				</p>
			</div>
		{/if}
	</div>
{/if}

<PlaceRewriteDialog
	isOpen={renaming !== null}
	{treeId}
	placeId={renaming?.place.id ?? ''}
	currentName={renaming?.place.name ?? ''}
	initialName={renaming?.candidate.displayName}
	onsaved={renamed}
	oncancel={() => (renaming = null)}
/>

<BaseModal
	isOpen={isConfirmingBulk}
	title="Accept all High matches"
	error={bulkError}
	onclose={() => (isConfirmingBulk = false)}
>
	<p class="text-sm text-stone-700" data-testid="bulk-confirm">
		Set the location of {review.highCount}
		{review.highCount === 1 ? 'place' : 'places'} to its best match. The text on the facts does not change.
		Each batch of up to 100 places is one change you can undo.
	</p>
	<div class="flex justify-end gap-2">
		<button
			type="button"
			class="row-action"
			disabled={isAcceptingBulk}
			onclick={() => (isConfirmingBulk = false)}>Cancel</button
		>
		<button
			type="button"
			class="btn-primary"
			disabled={isAcceptingBulk}
			data-testid="confirm-bulk"
			onclick={acceptAllHigh}>{isAcceptingBulk ? 'Accepting…' : 'Accept'}</button
		>
	</div>
</BaseModal>
