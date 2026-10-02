<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		ArrowDown,
		ArrowUp,
		Combine,
		Cross,
		GitBranch,
		MapPin,
		Pencil,
		Plus,
		Star,
		Trash2,
		UserPlus
	} from 'lucide-svelte';
	import PersonMergeDialog from '#lib/components/modals/PersonMergeDialog.svelte';
	import FactDialog from '#lib/components/modals/FactDialog.svelte';
	import NameDialog from '#lib/components/modals/NameDialog.svelte';
	import PersonLink from '#lib/components/PersonLink.svelte';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import { hasMinimumRole, isManagerOrAbove } from '#lib/shared/roles.js';
	import type { PersonPrivacy } from '#lib/shared/privacy.js';
	import { sexLabel } from '#lib/shared/sex.js';
	import type {
		FactDto,
		NameDto,
		PersonSummaryDto
	} from '#lib/server/services/person-page-service.js';
	import {
		undoApi,
		deleteFactApi,
		deleteNameApi,
		previewFactApi,
		previewNameApi,
		recordRecentApi,
		reorderFactsApi,
		reorderNamesApi,
		setFavoriteApi,
		setPersonPrivacyApi,
		setPreferredNameApi
	} from '#lib/services/tree-api.js';
	import { NAME_TYPE_LABELS, formatFullName } from '#lib/shared/name-types.js';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	const { editor, toasts, marks } = getTreeContext();

	const dto = $derived(data.person);
	const treeId = $derived(data.summary.tree.id);
	const treeHref = $derived(`/trees/${encodeURIComponent(treeId)}`);
	const personHref = (id: string) => `${treeHref}/people/${encodeURIComponent(id)}`;
	const unionHref = (id: string) => `${treeHref}/unions/${encodeURIComponent(id)}`;

	// The dialogs read versions and names from the graph the screen shows.
	$effect(() => {
		editor.graph = dto.graph;
		return () => (editor.graph = null);
	});

	// ---- Favourite and recent ----
	const isFavorite = $derived(marks.favorites.some((f) => f.id === dto.person.id));

	// An explicit POST from the page, not a load: links preload on hover, and a preload is not a visit.
	// Effects never run on the server, so a server render records nothing either.
	$effect(() => {
		const personId = dto.person.id;
		void recordRecentApi(treeId, personId)
			.then((updated) => marks.set(updated))
			.catch(() => {
				// Recents are a convenience; a failed record is not worth a message.
			});
	});

	async function toggleFavorite() {
		try {
			marks.set(await setFavoriteApi(treeId, dto.person.id, !isFavorite));
		} catch (cause) {
			toasts.push((cause as Error).message || 'Could not change the favourite', { tone: 'error' });
		}
	}

	// ---- Merge (editors and above: it deletes a record) ----
	const role = $derived(data.trees.find((t) => t.id === treeId)?.role);
	const canMerge = $derived(role !== undefined && hasMinimumRole(role, 'editor'));
	let isMerging = $state(false);

	// The record that goes may be the one on screen, so the page moves to the one that stays, and Undo moves back.
	async function merged(change: Parameters<typeof editor.afterChange>[0], survivorId: string) {
		const here = dto.person.id;
		isMerging = false;
		await goto(personHref(survivorId), { refreshAll: true });
		toasts.push(change?.summary ?? 'People merged', {
			action: change?.isUndoable
				? {
						label: 'Undo',
						run: async () => {
							try {
								const { undone } = await undoApi(treeId);
								await goto(personHref(here), { refreshAll: true });
								toasts.push(`Undid: ${undone.summary}`);
							} catch (cause: unknown) {
								toasts.push((cause as Error).message || 'Could not undo', {
									tone: 'error',
									durationMs: 10_000
								});
							}
						}
					}
				: undefined
		});
	}

	// ---- Privacy (managers and owners) ----
	const canSetPrivacy = $derived(
		isManagerOrAbove(data.trees.find((t) => t.id === treeId)?.role) && dto.privacy !== null
	);
	const PRIVACY_CHOICES: Array<{ value: PersonPrivacy; label: string }> = [
		{ value: 'auto', label: 'Automatic: follow their dates' },
		{ value: 'public', label: 'Always public' },
		{ value: 'private', label: 'Always private' }
	];
	/** What contributors and viewers get, in a sentence, so the setting's effect is not a guess. */
	const privacyEffect = $derived.by(() => {
		if (!dto.privacy) return '';
		if (dto.privacy.setting === 'public') return 'Contributors and viewers can see them.';
		if (dto.privacy.setting === 'private') return 'Hidden from contributors and viewers.';
		return dto.privacy.isLikelyLiving
			? 'Hidden from contributors and viewers, except the contributor who added them: no death is recorded and no birth is old enough.'
			: 'Visible to contributors and viewers: a death is recorded or their birth is old enough.';
	});
	let isSavingPrivacy = $state(false);

	async function changePrivacy(event: Event) {
		const privacy = (event.currentTarget as HTMLSelectElement).value as PersonPrivacy;
		isSavingPrivacy = true;
		try {
			const { change } = await setPersonPrivacyApi(
				treeId,
				dto.person.id,
				privacy,
				dto.person.version
			);
			await editor.afterChange(change, 'Privacy changed');
		} catch (cause) {
			toasts.push((cause as Error).message || 'Could not change the privacy', { tone: 'error' });
		} finally {
			isSavingPrivacy = false;
		}
	}

	// ---- Names ----
	let nameDialog = $state<{ name: NameDto | null } | null>(null);

	async function nameSaved(change: Parameters<typeof editor.afterChange>[0]) {
		nameDialog = null;
		await editor.afterChange(change, 'Name saved');
	}

	async function nameStale(message: string) {
		nameDialog = null;
		await editor.refresh();
		toasts.push(`${message} Review the name and try again.`, { tone: 'error', durationMs: 10_000 });
	}

	/** The partnerships this person can have taken a name through, worded by who the other partners are. */
	const partnershipChoices = $derived(
		dto.partnerships.map((p) => {
			const others = p.partners
				.filter((partner) => partner.id !== dto.person.id)
				.map((partner) => partner.displayName);
			return {
				unionId: p.unionId,
				label: others.length > 0 ? `Partnership with ${others.join(' and ')}` : 'Partnership'
			};
		})
	);
	const partnershipLabel = (unionId: string | null) =>
		partnershipChoices.find((c) => c.unionId === unionId)?.label ?? null;

	/** A name's own type, or the word the file gave it for a type Epoch has no name for. */
	const typeLabel = (name: NameDto) =>
		name.type === 'other' && name.gedcomType ? name.gedcomType : NAME_TYPE_LABELS[name.type];

	/** "In use from 1998, taken through" (the partnership link follows it); built here because the template drops the space after a comma between blocks. */
	function nameContext(name: NameDto): string {
		const from = name.dateText ? `In use from ${name.dateText}` : '';
		const through = partnershipLabel(name.unionId) ? `${from ? 'taken' : 'Taken'} through` : '';
		return [from, through].filter(Boolean).join(from && through ? ', ' : '');
	}

	function removeName(name: NameDto) {
		if (name.id === null) return;
		const { id, version } = { id: name.id, version: name.version ?? 0 };
		void editor.confirmWithImpact({
			title: `Remove the ${typeLabel(name).toLowerCase()} "${formatFullName(name)}"?`,
			confirmLabel: 'Remove name',
			preview: () => previewNameApi(treeId, { kind: 'delete_name', nameId: id, version }),
			run: () => deleteNameApi(treeId, id, version),
			done: 'Name removed'
		});
	}

	async function makePreferred(name: NameDto) {
		if (name.id === null) return;
		try {
			const { change } = await setPreferredNameApi(
				treeId,
				dto.person.id,
				name.id,
				name.version ?? undefined
			);
			await editor.afterChange(change, 'Preferred name changed');
		} catch (cause) {
			toasts.push((cause as Error).message || 'Could not change the preferred name', {
				tone: 'error'
			});
		}
	}

	/** The preferred name is always listed and exported first, so it cannot move and nothing can move above it. */
	const canMoveName = (index: number, by: -1 | 1) => {
		const other = dto.names[index + by];
		return other !== undefined && !other.isPreferred && !dto.names[index]!.isPreferred;
	};

	async function moveName(index: number, by: -1 | 1) {
		const order = dto.names.map((n) => n.id).filter((id): id is string => id !== null);
		[order[index], order[index + by]] = [order[index + by]!, order[index]!];
		try {
			const { change } = await reorderNamesApi(treeId, dto.person.id, order);
			await editor.afterChange(change, 'Names reordered');
		} catch (cause) {
			toasts.push((cause as Error).message || 'Could not reorder', { tone: 'error' });
		}
	}

	// ---- Facts ----
	let factDialog = $state<{ fact: FactDto | null } | null>(null);

	async function factSaved(change: Parameters<typeof editor.afterChange>[0]) {
		factDialog = null;
		await editor.afterChange(change, 'Fact saved');
	}

	async function factStale(message: string) {
		factDialog = null;
		await editor.refresh();
		toasts.push(`${message} Review the fact and try again.`, { tone: 'error', durationMs: 10_000 });
	}

	function removeFact(fact: FactDto) {
		void editor.confirmWithImpact({
			title: `Remove this ${fact.label.toLowerCase()}?`,
			confirmLabel: 'Remove fact',
			preview: () =>
				previewFactApi(treeId, { kind: 'delete_fact', factId: fact.id, version: fact.version }),
			run: () => deleteFactApi(treeId, fact.id, fact.version),
			done: 'Fact removed'
		});
	}

	/** Facts that sort together (same date, or both undated) can swap places; a date decides the rest. */
	const canSwap = (a: FactDto | undefined, b: FactDto | undefined) =>
		a !== undefined && b !== undefined && a.sortStart === b.sortStart;

	async function move(index: number, by: -1 | 1) {
		const order = dto.facts.map((f) => f.id);
		[order[index], order[index + by]] = [order[index + by]!, order[index]!];
		try {
			const { change } = await reorderFactsApi(treeId, dto.person.id, order);
			await editor.afterChange(change, 'Facts reordered');
		} catch (cause) {
			toasts.push((cause as Error).message || 'Could not reorder', { tone: 'error' });
		}
	}

	const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : 'unknown');
	const childrenOf = (list: Array<{ person: PersonSummaryDto }>) => list.map((c) => c.person);
</script>

<svelte:head>
	<title>{dto.person.displayName} · Epoch</title>
</svelte:head>

<nav aria-label="Breadcrumb" class="text-xs text-stone-600">
	<a href={treeHref} class="font-semibold text-emerald-800 hover:underline"
		>{data.summary.tree.name}</a
	>
	<span aria-hidden="true"> › </span>
	<a href={`${treeHref}/people`} class="font-semibold text-emerald-800 hover:underline">People</a>
	<span aria-hidden="true"> › </span>
	<span aria-current="page">{dto.person.displayName}</span>
</nav>

<header class="flex flex-wrap items-start justify-between gap-3">
	<div>
		<h2 class="text-2xl font-bold text-stone-900" data-testid="person-name">
			{dto.person.displayName}
		</h2>
		<p class="mt-1 text-sm text-stone-600">
			{sexLabel(dto.person.sex)}{#if dto.vitals.lifespan}<span aria-hidden="true"> · </span><span
					data-testid="lifespan">{dto.vitals.lifespan}</span
				>{/if}
			{#if dto.vitals.hasConflict}<span
					class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900"
					>dates disagree</span
				>{/if}
		</p>
		<p class="mt-1 text-xs">
			<a
				href={`${treeHref}?focus=${encodeURIComponent(dto.person.id)}`}
				class="inline-flex items-center gap-1 font-semibold text-emerald-800 hover:underline"
				><GitBranch class="h-3 w-3" />Show in the tree</a
			> <span aria-hidden="true">·</span>
			<a
				href={`${treeHref}/people/${encodeURIComponent(dto.person.id)}/pedigree`}
				class="font-semibold text-emerald-800 hover:underline">Ancestors</a
			> <span aria-hidden="true">·</span>
			<a
				href={`${treeHref}/people/${encodeURIComponent(dto.person.id)}/descendants`}
				class="font-semibold text-emerald-800 hover:underline">Descendants</a
			> <span aria-hidden="true">·</span>
			<a
				href={`${treeHref}/people/${encodeURIComponent(dto.person.id)}/fan`}
				class="font-semibold text-emerald-800 hover:underline">Fan</a
			> <span aria-hidden="true">·</span>
			<a
				href={`${treeHref}/people/${encodeURIComponent(dto.person.id)}/hourglass`}
				class="font-semibold text-emerald-800 hover:underline">Hourglass</a
			> <span aria-hidden="true">·</span>
			<a
				href={`${treeHref}/relationship?from=${encodeURIComponent(dto.person.id)}`}
				class="font-semibold text-emerald-800 hover:underline">Relationship to…</a
			>
		</p>
	</div>
	<div class="flex flex-wrap gap-2">
		<button
			type="button"
			onclick={toggleFavorite}
			aria-pressed={isFavorite}
			class="btn"
			data-testid="favorite-toggle"
		>
			<Star class="h-3.5 w-3.5 {isFavorite ? 'fill-amber-400 text-amber-500' : ''}" />{isFavorite
				? 'Favourite'
				: 'Add to favourites'}
		</button>
		<button type="button" onclick={() => void editor.openEditPerson(dto.person.id)} class="btn"
			><Pencil class="h-3.5 w-3.5" />Edit</button
		>
		<button
			type="button"
			onclick={() => editor.openRelationship(editor.anchorFor(dto.person.id))}
			class="btn"><UserPlus class="h-3.5 w-3.5" />Relationship</button
		>
		<button
			type="button"
			onclick={() =>
				editor.openRelationship(editor.anchorFor(dto.person.id), { kind: 'record_death' })}
			class="btn"><Cross class="h-3.5 w-3.5" />Record death</button
		>
		{#if canMerge}
			<button
				type="button"
				onclick={() => (isMerging = true)}
				class="btn"
				data-testid="merge-person"><Combine class="h-3.5 w-3.5" />Merge…</button
			>
		{/if}
		<button
			type="button"
			onclick={() => editor.requestDeletePerson(dto.person.id)}
			class="btn text-red-700"><Trash2 class="h-3.5 w-3.5" />Delete…</button
		>
	</div>
</header>

{#if canSetPrivacy && dto.privacy}
	<section aria-labelledby="privacy-heading" class="card" data-testid="privacy-panel">
		<h3 id="privacy-heading" class="heading">Privacy</h3>
		<div class="mt-2 flex flex-wrap items-center gap-3 text-sm">
			<label for="person-privacy" class="sr-only">Who may see this person</label>
			<select
				id="person-privacy"
				value={dto.privacy.setting}
				onchange={changePrivacy}
				disabled={isSavingPrivacy}
				class="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm"
			>
				{#each PRIVACY_CHOICES as choice (choice.value)}<option value={choice.value}
						>{choice.label}</option
					>{/each}
			</select>
			<p class="text-xs text-stone-600" data-testid="privacy-effect">{privacyEffect}</p>
		</div>
	</section>
{/if}

<div class="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
	<div class="space-y-6">
		<section aria-labelledby="names-heading" class="card">
			<div class="flex items-center justify-between">
				<h3 id="names-heading" class="heading">Names</h3>
				<button type="button" onclick={() => (nameDialog = { name: null })} class="btn"
					><Plus class="h-3.5 w-3.5" />Add name</button
				>
			</div>
			<ol class="mt-3 space-y-2" data-testid="names">
				{#each dto.names as name, index (name.id ?? 'derived')}
					<li
						class="rounded-xl border border-stone-200 bg-white p-3"
						data-testid="name"
						data-name-type={name.type}
						data-preferred={name.isPreferred}
					>
						<div class="flex flex-wrap items-baseline justify-between gap-x-3">
							<span class="text-sm font-semibold text-stone-900"
								>{name.displayName}{#if name.nickname}
									<span class="font-normal text-stone-600">“{name.nickname}”</span>{/if}</span
							>
							<span class="text-xs text-stone-600">
								{typeLabel(name)}{#if name.isPreferred}
									· <span class="font-semibold text-emerald-800">shown as</span>{/if}
							</span>
						</div>
						{#if name.dateText || partnershipLabel(name.unionId)}
							<p class="mt-1 text-xs text-stone-600" data-testid="name-context">
								{nameContext(name)}{#if partnershipLabel(name.unionId)}{' '}<a
										href={unionHref(name.unionId!)}
										class="font-semibold text-emerald-800 hover:underline"
										>{partnershipLabel(name.unionId)}</a
									>{/if}
							</p>
						{/if}
						{#if name.id !== null}
							<div class="mt-2 flex flex-wrap items-center gap-3 text-xs font-semibold">
								<button
									type="button"
									onclick={() => (nameDialog = { name })}
									class="link"
									aria-label={`Edit ${typeLabel(name)}`}>Edit</button
								>
								{#if !name.isPreferred}
									<button
										type="button"
										onclick={() => void makePreferred(name)}
										class="link"
										aria-label={`Show as ${name.displayName}`}>Show as this name</button
									>
								{/if}
								{#if dto.names.length > 1}
									<button
										type="button"
										onclick={() => removeName(name)}
										class="link text-red-700"
										aria-label={`Remove ${typeLabel(name)}`}>Remove</button
									>
								{/if}
								{#if canMoveName(index, -1)}
									<button
										type="button"
										onclick={() => void moveName(index, -1)}
										class="link"
										aria-label={`Move ${typeLabel(name)} up`}
										><ArrowUp class="inline h-3 w-3" /></button
									>
								{/if}
								{#if canMoveName(index, 1)}
									<button
										type="button"
										onclick={() => void moveName(index, 1)}
										class="link"
										aria-label={`Move ${typeLabel(name)} down`}
										><ArrowDown class="inline h-3 w-3" /></button
									>
								{/if}
							</div>
						{:else}
							<p class="mt-1 text-xs text-stone-500">
								Edit this name from the person's Edit button.
							</p>
						{/if}
					</li>
				{/each}
			</ol>
		</section>

		<section aria-labelledby="facts-heading" class="card">
			<div class="flex items-center justify-between">
				<h3 id="facts-heading" class="heading">Facts</h3>
				<button type="button" onclick={() => (factDialog = { fact: null })} class="btn"
					><Plus class="h-3.5 w-3.5" />Add fact</button
				>
			</div>
			{#if dto.facts.length === 0}
				<p class="mt-2 text-sm text-stone-500 italic">No facts recorded.</p>
			{:else}
				<ol class="mt-3 space-y-2" data-testid="facts">
					{#each dto.facts as fact, index (fact.id)}
						<li
							class="rounded-xl border bg-white p-3 {fact.conflict
								? 'border-amber-400'
								: 'border-stone-200'}"
							data-testid="fact"
							data-fact-type={fact.type}
							data-conflict={fact.conflict?.kind ?? ''}
						>
							<div class="flex flex-wrap items-baseline justify-between gap-2">
								<span class="text-sm font-semibold text-emerald-900"
									>{fact.label}{#if fact.value}: <span class="text-stone-900">{fact.value}</span
										>{/if}</span
								>
								<span class="text-xs text-stone-600"
									>{fact.dateText ?? 'Date unknown'}{#if fact.isApproximate}
										<span class="text-stone-400">(approximate)</span>{/if}</span
								>
							</div>
							{#if fact.place}<p class="mt-1 flex items-center text-xs text-stone-600">
									<MapPin class="mr-1 h-3.5 w-3.5 text-stone-400" /><a
										href={`${treeHref}/place?name=${encodeURIComponent(fact.place)}`}
										class="hover:underline">{fact.place}</a
									>
								</p>{/if}
							{#if fact.cause || fact.age}
								<p class="mt-1 text-xs text-stone-600">
									{[fact.cause && `Cause: ${fact.cause}`, fact.age && `Age: ${fact.age}`]
										.filter(Boolean)
										.join(' · ')}
								</p>
							{/if}
							{#if fact.notes}<p class="mt-1 text-xs text-stone-700">
									{fact.notes}{#if fact.isLegacyNote}
										<span class="text-stone-400">(imported note)</span>{/if}
								</p>{/if}
							{#if fact.conflict}
								<p class="mt-1 text-xs font-semibold text-amber-800" role="note">
									{fact.conflict.kind === 'repeat'
										? `Recorded ${fact.conflict.otherIds.length + 1} times with the same details.`
										: `Disagrees with ${fact.conflict.otherIds.length} other recorded ${fact.label.toLowerCase()}${fact.conflict.otherIds.length > 1 ? 's' : ''}. All are kept.`}
								</p>
							{/if}
							<div class="mt-2 flex items-center gap-3 text-xs font-semibold">
								<button
									type="button"
									onclick={() => (factDialog = { fact })}
									class="link"
									aria-label={`Edit ${fact.label}`}>Edit</button
								>
								<button
									type="button"
									onclick={() => removeFact(fact)}
									class="link text-red-700"
									aria-label={`Remove ${fact.label}`}>Remove</button
								>
								{#if canSwap(dto.facts[index - 1], fact)}
									<button
										type="button"
										onclick={() => void move(index, -1)}
										class="link"
										aria-label={`Move ${fact.label} up`}><ArrowUp class="inline h-3 w-3" /></button
									>
								{/if}
								{#if canSwap(fact, dto.facts[index + 1])}
									<button
										type="button"
										onclick={() => void move(index, 1)}
										class="link"
										aria-label={`Move ${fact.label} down`}
										><ArrowDown class="inline h-3 w-3" /></button
									>
								{/if}
							</div>
						</li>
					{/each}
				</ol>
			{/if}
		</section>

		<div class="grid gap-6 sm:grid-cols-2">
			<section aria-labelledby="notes-heading" class="card">
				<h3 id="notes-heading" class="heading">Notes</h3>
				<p class="mt-2 text-xs text-stone-500">
					Notes on a person arrive with sources and evidence in a later phase.
				</p>
			</section>
			<section aria-labelledby="evidence-heading" class="card">
				<h3 id="evidence-heading" class="heading">Sources and evidence</h3>
				<p class="mt-2 text-xs text-stone-500">Citations are not recorded yet.</p>
			</section>
		</div>

		{#if dto.media.length > 0}
			<section aria-labelledby="media-heading" class="card">
				<h3 id="media-heading" class="heading">Media</h3>
				<ul class="mt-2 space-y-1 text-sm">
					{#each dto.media as item (item.id)}
						<li>
							<a
								class="link"
								href={`/api/media/${item.r2ObjectKey}`}
								target="_blank"
								rel="noreferrer">{item.title ?? item.r2ObjectKey}</a
							>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</div>

	<aside class="space-y-6" aria-label="Family">
		<section aria-labelledby="parents-heading" class="card">
			<h3 id="parents-heading" class="heading">Parents</h3>
			{#if dto.parentFamilies.length === 0}<p class="mt-2 text-xs text-stone-500 italic">
					None recorded.
				</p>{/if}
			{#each dto.parentFamilies as family (family.unionId ?? 'direct')}
				<ul class="mt-2 space-y-1 text-sm" data-testid="parents">
					{#each family.parents as parent (parent.person.id + parent.type)}
						<li>
							<PersonLink person={parent.person} href={personHref(parent.person.id)} />
							<span class="text-xs text-stone-500"
								>{parent.type === 'biological' ? '' : parent.type}</span
							>
						</li>
					{/each}
					{#if family.unionId}<li class="text-xs">
							<a class="link" href={unionHref(family.unionId)}
								>{family.label?.full ?? 'Their partnership'}</a
							>
						</li>{/if}
				</ul>
			{/each}
		</section>

		<section aria-labelledby="partners-heading" class="card">
			<h3 id="partners-heading" class="heading">Partnerships and children</h3>
			{#if dto.partnerships.length === 0 && dto.directChildren.length === 0}<p
					class="mt-2 text-xs text-stone-500 italic"
				>
					None recorded.
				</p>{/if}
			{#each dto.partnerships as union (union.unionId)}
				<div
					class="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5"
					data-testid="partnership"
				>
					<p class="text-xs font-semibold text-amber-900">
						<a class="link" href={unionHref(union.unionId)}>{union.label?.full ?? 'Partnership'}</a>
						{#if union.status !== 'active'}<span class="text-red-700"> · {union.status}</span>{/if}
						{#if union.isWidowed}<span class="text-stone-700"> · widowed</span>{/if}
					</p>
					<ul class="mt-1 space-y-0.5 text-sm">
						{#each union.partners as partner (partner.id)}
							<li>
								<PersonLink
									person={partner}
									href={personHref(partner.id)}
								/>{#if partner.isDeceased}
									<span class="text-xs text-stone-500">(deceased)</span>{/if}
							</li>
						{/each}
					</ul>
					{#if union.children.length > 0}
						<p class="mt-2 text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
							Children
						</p>
						<ul class="space-y-0.5 text-sm">
							{#each childrenOf(union.children) as child (child.id)}
								<li><PersonLink person={child} href={personHref(child.id)} /></li>
							{/each}
						</ul>
					{/if}
				</div>
			{/each}
			{#if dto.directChildren.length > 0}
				<p class="mt-3 text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
					Children (no partnership recorded)
				</p>
				<ul class="space-y-0.5 text-sm">
					{#each childrenOf(dto.directChildren) as child (child.id)}
						<li><PersonLink person={child} href={personHref(child.id)} /></li>
					{/each}
				</ul>
			{/if}
		</section>

		<section aria-labelledby="siblings-heading" class="card">
			<h3 id="siblings-heading" class="heading">Siblings</h3>
			{#if dto.siblings.full.length === 0 && dto.siblings.half.length === 0}<p
					class="mt-2 text-xs text-stone-500 italic"
				>
					None recorded.
				</p>{/if}
			<ul class="mt-2 space-y-0.5 text-sm" data-testid="siblings">
				{#each dto.siblings.full as sibling (sibling.id)}<li>
						<PersonLink person={sibling} href={personHref(sibling.id)} />
					</li>{/each}
				{#each dto.siblings.half as sibling (sibling.id)}<li>
						<PersonLink person={sibling} href={personHref(sibling.id)} />
						<span class="text-xs text-stone-500">half-sibling</span>
					</li>{/each}
			</ul>
		</section>

		{#if dto.stepParents.length > 0 || dto.stepChildren.length > 0}
			<section aria-labelledby="steps-heading" class="card">
				<h3 id="steps-heading" class="heading">Step relatives</h3>
				<ul class="mt-2 space-y-0.5 text-sm" data-testid="step-relatives">
					{#each dto.stepParents as step (step.person.id)}<li>
							<PersonLink person={step.person} href={personHref(step.person.id)} />
							<span class="text-xs text-stone-500">step-parent</span>
						</li>{/each}
					{#each dto.stepChildren as step (step.person.id)}<li>
							<PersonLink person={step.person} href={personHref(step.person.id)} />
							<span class="text-xs text-stone-500">step-child, via {step.via.displayName}</span>
						</li>{/each}
				</ul>
			</section>
		{/if}

		<section aria-labelledby="history-heading" class="card">
			<h3 id="history-heading" class="heading">History</h3>
			<p class="mt-1 text-xs text-stone-500">
				Created {when(dto.changes.createdAt)} · last written {when(dto.changes.updatedAt)}
			</p>
			{#if dto.changes.recent.length === 0}
				<p class="mt-2 text-xs text-stone-500 italic">
					No changes are logged for this person. Imported records have no history.
				</p>
			{:else}
				<ul class="mt-2 space-y-1.5 text-xs" data-testid="history">
					{#each dto.changes.recent as change (change.id)}
						<li>
							<span class="font-medium text-stone-800">{change.summary}</span>
							<span class="block text-stone-500"
								>{change.actorName ?? 'Someone'} · {when(change.createdAt)}</span
							>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</aside>
</div>

<NameDialog
	isOpen={nameDialog !== null}
	{treeId}
	personId={dto.person.id}
	name={nameDialog?.name ?? null}
	partnerships={partnershipChoices}
	onsaved={nameSaved}
	onstale={nameStale}
	oncancel={() => (nameDialog = null)}
/>

<FactDialog
	isOpen={factDialog !== null}
	{treeId}
	personId={dto.person.id}
	fact={factDialog?.fact ?? null}
	onsaved={factSaved}
	onstale={factStale}
	oncancel={() => (factDialog = null)}
/>

{#if canMerge}
	<PersonMergeDialog
		isOpen={isMerging}
		{treeId}
		person={{ id: dto.person.id, name: dto.person.displayName }}
		onmerged={merged}
		oncancel={() => (isMerging = false)}
	/>
{/if}

<style>
	.card {
		border-radius: 1rem;
		border: 1px solid var(--color-stone-200);
		background: var(--color-stone-50);
		padding: 1rem;
	}
	.heading {
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--color-stone-600);
	}
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		cursor: pointer;
		border-radius: 0.5rem;
		border: 1px solid var(--color-stone-300);
		background: var(--color-stone-100);
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-stone-800);
	}
	.btn:hover {
		background: var(--color-stone-200);
	}
	.link {
		cursor: pointer;
		font-weight: 500;
		color: var(--color-emerald-800);
	}
	.link:hover {
		text-decoration: underline;
	}
</style>
