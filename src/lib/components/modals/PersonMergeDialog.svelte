<script lang="ts">
	import ImpactDialog from './ImpactDialog.svelte';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import PersonPicker from '#lib/components/PersonPicker.svelte';
	import { isConflict } from '#lib/api/client.js';
	import { mergePeopleApi, reviewPersonMergeApi } from '#lib/api/people.js';
	import type { MergeSide, PersonMergeReviewDto } from '#lib/shared/person-merge.js';
	import { sexLabel } from '#lib/shared/sex.js';
	import type { ChangeSummary, ImpactSummary } from '#lib/types/genealogy.js';

	interface Props {
		isOpen: boolean;
		treeId: string;
		/** The person whose page the dialog was opened from. */
		person: { id: string; name: string };
		/** Called after a merge, with the change (so the caller can offer Undo) and the record that remains. */
		onmerged: (change: ChangeSummary | null, survivorId: string) => void | Promise<void>;
		oncancel: () => void;
	}

	let { isOpen, treeId, person, onmerged, oncancel }: Props = $props();

	const legend = 'text-xs font-semibold text-stone-700';

	let other = $state<{ id: string; name: string } | null>(null);
	/** Which record stays: its id, XREF, preferred name and favourites are the ones kept. */
	let stays = $state<'this' | 'other'>('this');
	let keepSex = $state<MergeSide | null>(null);
	let review = $state<PersonMergeReviewDto | null>(null);
	let impact = $state<ImpactSummary | null>(null);
	let error = $state<string | null>(null);
	let saveError = $state<string | null>(null);
	let isLoading = $state(false);
	let isSaving = $state(false);
	let request = 0;

	const survivorId = $derived(stays === 'this' ? person.id : (other?.id ?? ''));
	const mergedId = $derived(stays === 'this' ? (other?.id ?? '') : person.id);

	$effect(() => {
		if (!isOpen) return;
		other = null;
		stays = 'this';
		keepSex = null;
		review = null;
		impact = null;
		error = null;
		saveError = null;
	});

	// The review and the exact preview are planned on the server for the choices made so far.
	$effect(() => {
		if (!isOpen || !other) return;
		const [survivor, merged, sex] = [survivorId, mergedId, keepSex];
		const mine = ++request;
		isLoading = true;
		reviewPersonMergeApi(treeId, survivor, { mergedId: merged, keep: sex ? { sex } : undefined })
			.then((result) => {
				if (mine !== request) return;
				review = result.review;
				impact = result.impact;
				error = null;
			})
			.catch((cause: unknown) => {
				if (mine !== request) return;
				review = null;
				impact = null;
				error = (cause as Error).message;
			})
			.finally(() => {
				if (mine === request) isLoading = false;
			});
	});

	// Swapping which record stays changes which sex is "the survivor's", so an earlier choice no longer applies.
	function choose(next: 'this' | 'other') {
		stays = next;
		keepSex = null;
	}

	async function save() {
		if (!review || !impact) return;
		isSaving = true;
		saveError = null;
		try {
			const { change } = await mergePeopleApi(treeId, review.survivor.id, {
				mergedId: review.merged.id,
				keep: keepSex ? { sex: keepSex } : undefined,
				expectedVersions: {
					[review.survivor.id]: review.survivor.version,
					[review.merged.id]: review.merged.version
				}
			});
			await onmerged(change, review.survivor.id);
		} catch (cause: unknown) {
			saveError = isConflict(cause)
				? `${(cause as Error).message} Close this and try again.`
				: messageOf(cause, 'Could not merge');
		} finally {
			isSaving = false;
		}
	}
</script>

{#snippet column(side: PersonMergeReviewDto['survivor'], heading: string)}
	<section
		class="min-w-0 rounded-lg border border-stone-200 bg-white p-3 text-xs"
		aria-label="{heading}: {side.name}"
		data-testid="merge-side"
	>
		<h4 class="text-sm font-semibold text-stone-900">{heading}: {side.name}</h4>
		<p class="text-stone-600">{sexLabel(side.sex)}</p>
		<dl class="mt-2 space-y-2">
			<div>
				<dt class="font-semibold text-stone-700">Names</dt>
				<dd>{side.names.map((n) => n.text).join('; ') || 'None'}</dd>
			</div>
			<div>
				<dt class="font-semibold text-stone-700">Facts</dt>
				<dd>
					{#each side.facts as fact, i (i)}<span class="block">{fact.label}: {fact.text}</span
						>{:else}None{/each}
				</dd>
			</div>
			<div>
				<dt class="font-semibold text-stone-700">Parents</dt>
				<dd>{side.parents.map((p) => p.name).join(', ') || 'None recorded'}</dd>
			</div>
			<div>
				<dt class="font-semibold text-stone-700">Partnerships</dt>
				<dd>
					{#each side.partnerships as union (union.id)}<span class="block"
							>With {union.partners} ({union.childCount}
							{union.childCount === 1 ? 'child' : 'children'})</span
						>{:else}None{/each}
				</dd>
			</div>
			<div>
				<dt class="font-semibold text-stone-700">Children</dt>
				<dd>{side.children.map((c) => c.name).join(', ') || 'None recorded'}</dd>
			</div>
			{#if side.mediaCount > 0}
				<div>
					<dt class="font-semibold text-stone-700">Attachments</dt>
					<dd>{side.mediaCount}</dd>
				</div>
			{/if}
		</dl>
	</section>
{/snippet}

<ImpactDialog
	{isOpen}
	title="Merge with another record of this person"
	{impact}
	isLoading={isOpen && isLoading}
	isConfirming={isSaving}
	error={saveError ?? error}
	confirmLabel="Merge people"
	idleMessage={other
		? (review?.refusal ?? 'Choose what to keep to see the changes.')
		: 'Choose the other record to compare.'}
	isConfirmBlocked={!impact}
	onconfirm={save}
	{oncancel}
>
	{#snippet controls()}
		<div class="space-y-3" data-testid="merge-form">
			<p class="text-xs text-stone-600">
				Use this when two records are the same person. Names, facts, relationships and attachments
				of the record that goes are added to the one that stays. Nothing is chosen for you where
				they differ: both are kept. One Undo puts everything back.
			</p>
			<PersonPicker
				{treeId}
				label="The other record of this person"
				picked={other}
				onpick={(p) => {
					other = p;
					keepSex = null;
				}}
			/>

			{#if other}
				<fieldset class="space-y-1">
					<legend class={legend}>Which record stays?</legend>
					<label class="flex items-start gap-2 text-sm"
						><input
							type="radio"
							name="stays"
							checked={stays === 'this'}
							onchange={() => choose('this')}
						/> <span>{person.name} (this record)</span></label
					>
					<label class="flex items-start gap-2 text-sm"
						><input
							type="radio"
							name="stays"
							checked={stays === 'other'}
							onchange={() => choose('other')}
						/> <span>{other.name}</span></label
					>
					<p class="text-xs text-stone-600">
						The record that stays keeps its address, its preferred name and its favourites. The
						other's GEDCOM reference is kept as an alias so a later export still resolves it.
					</p>
				</fieldset>

				{#if review}
					{#if review.refusal}
						<p
							role="alert"
							class="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-900"
							data-testid="merge-refusal"
						>
							{review.refusal}
						</p>
					{:else}
						<div class="grid gap-2 sm:grid-cols-2">
							{@render column(review.survivor, 'Stays')}
							{@render column(review.merged, 'Goes')}
						</div>
						{#each review.conflicts as conflict (conflict.kind)}
							<fieldset class="space-y-1" data-testid="merge-conflict">
								<legend class={legend}>They record a different sex. Which is right?</legend>
								<label class="flex items-center gap-2 text-sm"
									><input
										type="radio"
										name="sex"
										checked={keepSex === 'survivor'}
										onchange={() => (keepSex = 'survivor')}
									/>
									{sexLabel(conflict.survivor)} ({review.survivor.name})</label
								>
								<label class="flex items-center gap-2 text-sm"
									><input
										type="radio"
										name="sex"
										checked={keepSex === 'merged'}
										onchange={() => (keepSex = 'merged')}
									/>
									{sexLabel(conflict.merged)} ({review.merged.name})</label
								>
							</fieldset>
						{/each}
						{#if review.notes.length > 0}
							<ul class="list-disc space-y-1 pl-5 text-xs text-amber-900" data-testid="merge-notes">
								{#each review.notes as note (note)}<li>{note}</li>{/each}
							</ul>
						{/if}
					{/if}
				{/if}
			{/if}
		</div>
	{/snippet}
</ImpactDialog>
