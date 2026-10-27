<script lang="ts">
	import { dateReader } from '#lib/components/date-format.js';
	import { ArrowDown, ArrowUp, ChevronDown, MapPin, Plus } from '@lucide/svelte';
	import FactDialog from '#lib/components/modals/FactDialog.svelte';
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import NoteList from '#lib/components/notes/NoteList.svelte';
	import NotesDisclosure from '#lib/components/notes/NotesDisclosure.svelte';
	import { canAddNote } from '#lib/components/notes/note-permissions.js';
	import { NOTE_SUBJECT_KINDS } from '#lib/shared/notes.js';
	import CitationsDisclosure from '#lib/components/evidence/CitationsDisclosure.svelte';
	import { citationsOfSubject } from '#lib/components/evidence/evidence-select.js';
	import { deleteFactApi, previewFactApi, reorderFactsApi } from '#lib/api/people.js';
	import { CITATION_SUBJECT_KINDS } from '#lib/shared/evidence.js';
	import { CONFLICT_KINDS } from '#lib/shared/fact-timeline.js';
	import { canChangeRecords, canCreateRecords, type TreeRole } from '#lib/shared/roles.js';
	import type { FactDto, PersonPageDto, PersonSummaryDto } from '#lib/shared/person-page.js';
	import { ageAt, birthSpan } from '#lib/shared/age.js';
	import { parseDateValue } from '#lib/shared/date-value.js';
	import { FACT_KINDS, type FactRelative } from '#lib/shared/fact-types.js';
	import { UNION_EVENT_LABELS } from '#lib/shared/union-events.js';
	import PersonLink from '#lib/components/PersonLink.svelte';
	import {
		factLabelOf,
		groupFacts,
		groupKeyOf,
		memberSubTypeOf,
		type FactMember
	} from './fact-groups.js';
	import AgeText from './AgeText.svelte';
	import { childWord, lifeTimeline, type LifeEntry } from './life-timeline.js';
	import { personPath, treePath, unionPath } from './person-paths.js';

	interface Props {
		dto: PersonPageDto;
		treeId: string;
		/** The tree's slug, for the links this builds (ADR-045); without one they use the id. */
		treeSlug?: string | null;
		role: TreeRole | undefined;
		editor: TreeEditor;
		toasts: ToastStore;
		/**
		 * `grouped` is one panel per kind of fact, newest shown (ADR-053), for the drawer. The person
		 * page splits the facts in two (ADR-059): `timeline` is the life story, events and partnership
		 * events oldest first, every one shown; `attributes` is one row per kind of attribute, its
		 * newest shown and the rest a click away.
		 */
		mode?: 'grouped' | 'timeline' | 'attributes';
	}

	let { dto, treeId, treeSlug = null, role, editor, toasts, mode = 'grouped' }: Props = $props();
	const showDate = dateReader();
	const uid = $props.id();
	const treeRef = $derived({ id: treeId, slug: treeSlug });
	// A viewer, and the public visitor, may read facts and names but not change them.
	const canEditFacts = $derived(canCreateRecords(role));
	const canEditUnions = $derived(canChangeRecords(role));
	const isTimeline = $derived(mode === 'timeline');
	/** Both page modes set a fact as a heading column and its details, with controls on one line. */
	const isPageRow = $derived(mode !== 'grouped');

	const life = $derived(
		isTimeline ? lifeTimeline(dto.facts, dto.partnerships, dto.directChildren) : []
	);
	const birth = $derived(birthSpan(dto.facts));
	const NO_AGE_TYPES = ['BIRT', 'CHR', 'BAPM', 'BURI', 'CREM'];
	/**
	 * The age at a fact, from every recorded birth. None where the record states one, on the birth
	 * itself or a christening or baptism (nearly always "under 1"), or on a burial or cremation,
	 * which would contradict the death's age when they share a range.
	 */
	const ageOf = (fact: FactDto) =>
		!birth || fact.age || NO_AGE_TYPES.includes(fact.type) ? null : ageAt(birth, fact);
	// A partnership's or a child's date reaches the page only as text, so it is parsed here.
	const ageAtText = (dateText: string | null) =>
		birth && dateText ? ageAt(birth, parseDateValue(dateText)) : null;
	const groups = $derived(
		isTimeline
			? []
			: groupFacts(
					dto.facts,
					mode === 'attributes' ? (fact) => fact.kind === FACT_KINDS.ATTRIBUTE : undefined
				)
	);

	/** The people a new fact can also be added to, once each however they are related (ADR-071). */
	const relatives = $derived.by((): FactRelative[] => {
		const seen = new Set([dto.person.id]);
		const out: FactRelative[] = [];
		const add = (person: PersonSummaryDto, relation: string) => {
			if (seen.has(person.id) || person.isPrivate) return;
			seen.add(person.id);
			out.push({ id: person.id, name: person.displayName, relation });
		};
		for (const p of dto.partnerships) p.partners.forEach((x) => add(x, 'Partner'));
		for (const p of dto.partnerships) p.children.forEach((c) => add(c.person, 'Child'));
		dto.directChildren.forEach((c) => add(c.person, 'Child'));
		dto.parentFamilies.forEach((f) => f.parents.forEach((x) => add(x.person, 'Parent')));
		[...dto.siblings.full, ...dto.siblings.half].forEach((x) => add(x, 'Sibling'));
		return out;
	});
	let factDialog = $state<{ fact: FactDto | null } | null>(null);

	const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;
	const WEB_URL_SHAPE = /^https?:\/\/\S+$/i;

	interface ContactRow {
		label: string;
		value: string;
		/** Set only for values the browser may follow; anything else renders as plain text. */
		href: string | null;
	}

	/** One row per stored contact value. A `javascript:` or other non-web value is never a link. */
	function contactRows(fact: FactDto): ContactRow[] {
		const rows: ContactRow[] = [];
		const add = (label: string, text: string | null, hrefFor: (value: string) => string | null) => {
			for (const value of (text ?? '').split('\n').map((line) => line.trim())) {
				if (value) rows.push({ label, value, href: hrefFor(value) });
			}
		};
		add('Phone', fact.phone, () => null);
		add('Email', fact.email, (value) => (EMAIL_SHAPE.test(value) ? `mailto:${value}` : null));
		add('Fax', fact.fax, () => null);
		add('Website', fact.web, (value) => (WEB_URL_SHAPE.test(value) ? value : null));
		return rows;
	}

	/** Which groups show their earlier facts. Kept for the page's life, not stored. */
	let expanded = $state<Record<string, boolean>>({});

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

	/**
	 * The index of the fact a move swaps with, or null. Only facts of one date swap, since the lists
	 * sort by date. Grouped, they must also be of one kind, and up is the next index because a tie
	 * shows its later fact first. In the timeline they must both be events, and up is the previous
	 * index, because it reads oldest first.
	 */
	function swapPartner(index: number, direction: 'up' | 'down'): number | null {
		const isUp = direction === 'up';
		const partner = isUp !== isTimeline ? index + 1 : index - 1;
		const [a, b] = [dto.facts[index], dto.facts[partner]];
		if (!a || !b || a.sortStart !== b.sortStart) return null;
		const isSameKind = isTimeline ? a.kind === b.kind : groupKeyOf(a) === groupKeyOf(b);
		return isSameKind ? partner : null;
	}

	// The timeline is a list on the section, not panels in it: a heading column, then the details.
	const timelineRow = 'grid gap-x-4 gap-y-1 py-3 sm:grid-cols-[8.5rem_minmax(0,1fr)]';
	const timelineHeading = 'text-sm font-semibold text-stone-900';

	async function move(index: number, partner: number) {
		const order = dto.facts.map((f) => f.id);
		[order[index], order[partner]] = [order[partner]!, order[index]!];
		await editor.mutate(() => reorderFactsApi(treeId, dto.person.id, order), {
			done: 'Facts reordered',
			failure: 'Could not reorder'
		});
	}
</script>

{#snippet factNotes(fact: FactDto)}
	<NotesDisclosure
		noteCount={fact.noteItems.length}
		canAdd={canAddNote(role)}
		label={`the ${fact.label.toLowerCase()}`}
		isInline={isPageRow}
	>
		<NoteList
			{treeId}
			{treeSlug}
			{role}
			{editor}
			{toasts}
			subjectLabel={`the ${fact.label.toLowerCase()}`}
			subject={{ kind: NOTE_SUBJECT_KINDS.EVENT, id: fact.id }}
			notes={fact.noteItems}
		/>
	</NotesDisclosure>
{/snippet}

{#snippet factRow(fact: FactDto, index: number, heading: string | null = null)}
	<li
		class={heading === null ? 'py-3' : timelineRow}
		data-testid="fact"
		data-fact-id={fact.id}
		data-fact-type={fact.type}
		data-conflict={fact.conflict?.kind ?? ''}
	>
		{#if heading !== null}<h4 class={timelineHeading}>{heading}</h4>{/if}
		<div class="min-w-0">{@render factDetail(fact, index, heading === null)}</div>
	</li>
{/snippet}

{#snippet age(fact: FactDto)}
	{@const text = ageOf(fact)}
	{#if text}<span class="text-xs"><AgeText age={text} testId="fact-age" /></span>{/if}
{/snippet}

{#snippet factDetail(fact: FactDto, index: number, isPanel: boolean)}
	{#if isPanel}
		<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
			{#if fact.value || memberSubTypeOf(fact)}<span class="text-sm text-stone-900"
					>{fact.value ?? ''}{#if memberSubTypeOf(fact)}<span class="text-stone-500"
							>{fact.value ? ' · ' : ''}{memberSubTypeOf(fact)}</span
						>{/if}</span
				>{/if}
			<span class="text-xs text-stone-600"
				>{showDate(fact.dateText) || 'Date unknown'}{#if fact.isApproximate}{' '}
					<span class="text-stone-400">(approximate)</span>{/if}{@render age(fact)}</span
			>
		</div>
	{:else if fact.kind !== FACT_KINDS.ATTRIBUTE}
		<!-- An event is placed by its date; an undated one says so rather than looking complete. -->
		<p class="text-sm text-stone-900">
			{showDate(fact.dateText) || 'Date unknown'}{#if fact.isApproximate}{' '}
				<span class="text-xs text-stone-500">(approximate)</span>{/if}{@render age(
				fact
			)}{#if fact.value}<span class="text-stone-600">{' · '}{fact.value}</span>{/if}
		</p>
	{:else}
		<!-- An attribute is its value; most have no date, and "Date unknown" on each would be noise. -->
		<p class="text-sm text-stone-900">
			{fact.value ?? ''}{#if fact.dateText}<span class="text-xs text-stone-600"
					>{fact.value ? ' · ' : ''}{showDate(fact.dateText)}</span
				>{#if fact.isApproximate}{' '}
					<span class="text-xs text-stone-500">(approximate)</span>{/if}{@render age(fact)}{/if}
		</p>
	{/if}
	{#if fact.place}<p class="mt-1 flex items-center text-xs text-stone-600">
			<MapPin class="mr-1 h-3.5 w-3.5 text-stone-400" /><a
				href={`${treePath(treeRef)}/place?name=${encodeURIComponent(fact.place)}`}
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
	{#if fact.address}<p
			class="mt-1 text-xs whitespace-pre-line text-stone-700"
			data-testid="fact-address"
		>
			{fact.address}
		</p>{/if}
	{#if fact.agency}<p class="mt-1 text-xs text-stone-600" data-testid="fact-agency">
			Agency: {fact.agency}
		</p>{/if}
	{#if fact.religion}<p class="mt-1 text-xs text-stone-600" data-testid="fact-religion">
			Religion: {fact.religion}
		</p>{/if}
	{#if contactRows(fact).length > 0}
		<ul class="mt-1 space-y-0.5 text-xs text-stone-600" data-testid="fact-contact">
			{#each contactRows(fact) as row, rowIndex (rowIndex)}
				<li>
					{row.label}:
					{#if row.href}<a
							href={row.href}
							rel="noopener noreferrer"
							class="text-emerald-800 underline hover:text-emerald-900">{row.value}</a
						>{:else}{row.value}{/if}
				</li>
			{/each}
		</ul>
	{/if}
	{#if fact.latitude || fact.longitude}<p
			class="mt-1 text-xs text-stone-600"
			data-testid="fact-coordinates"
		>
			Coordinates: {[fact.latitude, fact.longitude].filter(Boolean).join(', ')}
		</p>{/if}
	{#if fact.isLegacyNote && fact.notes}<p class="mt-1 text-xs text-stone-700">
			{fact.notes}
			<span class="text-stone-400">(imported note)</span>
		</p>{/if}
	{#if fact.retainedLines.length > 0}
		<details class="mt-2 text-xs" data-testid="fact-retained">
			<summary class="cursor-pointer font-semibold text-stone-700"
				>Imported, not editable here ({fact.retainedLines.length})</summary
			>
			<p class="mt-1 text-stone-600">
				Kept so your file exports unchanged. The app cannot show or edit these yet.
			</p>
			<pre
				class="mt-1 overflow-x-auto rounded bg-stone-50 p-2 font-mono text-[11px] text-stone-800">{fact.retainedLines.join(
					'\n'
				)}</pre>
		</details>
	{/if}
	{#if fact.conflict}
		<p class="mt-1 text-xs font-semibold text-amber-800" role="note">
			{fact.conflict.kind === 'repeat'
				? `Recorded ${fact.conflict.otherIds.length + 1} times with the same details.`
				: `Disagrees with ${fact.conflict.otherIds.length} other recorded ${fact.label.toLowerCase()}${fact.conflict.otherIds.length > 1 ? 's' : ''}. All are kept.`}
		</p>
	{/if}
	<CitationsDisclosure
		{treeId}
		{treeSlug}
		{role}
		{editor}
		{toasts}
		subjectLabel={`the ${fact.label.toLowerCase()}`}
		subject={{ kind: CITATION_SUBJECT_KINDS.EVENT, id: fact.id }}
		citations={citationsOfSubject(dto.evidence.citations, CITATION_SUBJECT_KINDS.EVENT, fact.id)}
		citationCount={fact.citationCount}
		isConflicting={fact.conflict?.kind === CONFLICT_KINDS.CONFLICT}
		label={`the ${fact.label.toLowerCase()}`}
		isAddLinkShown={false}
	>
		{#snippet controls()}
			<!-- The page keeps a fact's evidence, notes and controls on one line. -->
			{#if isPageRow}{@render factNotes(fact)}{/if}
			{#if canEditFacts}
				<button
					type="button"
					onclick={() => (factDialog = { fact })}
					class="row-link"
					aria-label={`Edit ${fact.label}`}>Edit</button
				>
				<button
					type="button"
					onclick={() => removeFact(fact)}
					class="row-link text-red-700"
					aria-label={`Remove ${fact.label}`}>Remove</button
				>
				{#if swapPartner(index, 'up') !== null}
					<button
						type="button"
						onclick={() => void move(index, swapPartner(index, 'up')!)}
						class="row-link"
						aria-label={`Move ${fact.label} up`}><ArrowUp class="inline h-3 w-3" /></button
					>
				{/if}
				{#if swapPartner(index, 'down') !== null}
					<button
						type="button"
						onclick={() => void move(index, swapPartner(index, 'down')!)}
						class="row-link"
						aria-label={`Move ${fact.label} down`}><ArrowDown class="inline h-3 w-3" /></button
					>
				{/if}
			{/if}
		{/snippet}
	</CitationsDisclosure>
	{#if !isPageRow}{@render factNotes(fact)}{/if}
{/snippet}

{#snippet textAge(dateText: string | null)}
	{@const text = ageAtText(dateText)}
	{#if text}<span class="text-xs"><AgeText age={text} testId="fact-age" /></span>{/if}
{/snippet}

{#snippet childRow(entry: Extract<LifeEntry, { kind: 'child' }>)}
	<li class={timelineRow} data-testid="life-child-birth">
		<h4 class={timelineHeading}>Birth of {childWord(entry.child, entry.types)}</h4>
		<div class="min-w-0">
			<p class="text-sm text-stone-900">
				{showDate(entry.child.birthDate)}{@render textAge(entry.child.birthDate)}<span
					class="text-stone-600"
					>{' · '}<PersonLink
						person={entry.child}
						href={personPath(treeRef, entry.child.id)}
					/></span
				>
			</p>
		</div>
	</li>
{/snippet}

{#snippet unionRow(entry: Extract<LifeEntry, { kind: 'union' }>)}
	<li class={timelineRow} data-testid="life-union-event" data-union-id={entry.unionId}>
		<h4 class={timelineHeading}>{UNION_EVENT_LABELS[entry.event.type]}</h4>
		<div class="min-w-0">
			<p class="text-sm text-stone-900">
				{showDate(entry.event.dateText) || 'Date unknown'}{@render textAge(
					entry.event.dateText
				)}{#if entry.partners.length > 0}<span class="text-stone-600"
						>{' · with'}
						{#each entry.partners as partner, i (partner.id)}{#if i > 0}{i ===
								entry.partners.length - 1
									? ' and '
									: ', '}{/if}<PersonLink
								person={partner}
								href={personPath(treeRef, partner.id)}
							/>{/each}</span
					>{/if}
			</p>
			{#if entry.event.place}<p class="mt-1 flex items-center text-xs text-stone-600">
					<MapPin class="mr-1 h-3.5 w-3.5 text-stone-400" /><a
						href={`${treePath(treeRef)}/place?name=${encodeURIComponent(entry.event.place)}`}
						class="hover:underline">{entry.event.place}</a
					>
				</p>{/if}
			<!-- The event belongs to the partnership, so its evidence and editing are there. -->
			<p class="mt-2 flex flex-wrap items-center gap-x-3 text-xs">
				<a href={unionPath(treeRef, entry.unionId)} class="row-link">Partnership</a>
				{#if canEditUnions}<button
						type="button"
						onclick={() => editor.editUnion(entry.unionId)}
						class="row-link"
						aria-label={`Edit the ${UNION_EVENT_LABELS[entry.event.type].toLowerCase()}`}
						>Edit</button
					>{/if}
			</p>
		</div>
	</li>
{/snippet}

{#snippet groupedFact(member: FactMember)}
	<li
		class="py-2 first:pt-0 last:pb-0"
		data-testid="fact"
		data-fact-id={member.fact.id}
		data-fact-type={member.fact.type}
		data-conflict={member.fact.conflict?.kind ?? ''}
	>
		{@render factDetail(member.fact, member.index, false)}
	</li>
{/snippet}

{#if canEditFacts && mode !== 'attributes'}
	<div class="flex justify-end">
		<button type="button" onclick={() => (factDialog = { fact: null })} class="action-btn"
			><Plus class="h-3.5 w-3.5" />Add fact</button
		>
	</div>
{/if}
{#if isTimeline}
	{#if life.length === 0}
		<p class="text-sm text-stone-500 italic">No events recorded.</p>
	{:else}
		<ol class="divide-y divide-stone-200" data-testid="facts">
			{#each life as entry (entry.kind === 'fact' ? entry.fact.id : entry.kind === 'union' ? entry.event.id : `child-${entry.child.id}`)}
				{#if entry.kind === 'fact'}
					{@render factRow(entry.fact, entry.index, factLabelOf(entry.fact))}
				{:else if entry.kind === 'union'}
					{@render unionRow(entry)}
				{:else}
					{@render childRow(entry)}
				{/if}
			{/each}
		</ol>
	{/if}
{:else if mode === 'attributes'}
	<!-- One row per kind, so the newest of each reads as a summary; the rest is one click away. -->
	<ul class="divide-y divide-stone-200" data-testid="attributes">
		{#each groups as group, groupIndex (group.key)}
			{@const [newest, ...earlier] = group.members}
			{@const earlierId = `${uid}-earlier-${groupIndex}`}
			{@const headingId = `${uid}-group-${groupIndex}`}
			{@const isOpen = expanded[group.key] === true}
			<li class={timelineRow} data-testid="fact-group">
				<!-- Names the row's "Show N earlier", which would otherwise repeat on the page unlabelled. -->
				<h4 id={headingId} class={timelineHeading}>
					{group.label}
					{#if group.members.length > 1}<span
							class="ml-1 text-xs font-normal text-stone-500 tabular-nums"
							>{group.members.length}</span
						>{/if}
				</h4>
				<div class="min-w-0">
					{#if group.isConflicting}
						<ul class="divide-y divide-stone-200">
							{#each group.members as member (member.fact.id)}
								{@render groupedFact(member)}
							{/each}
						</ul>
					{:else}
						<ul>{@render groupedFact(newest!)}</ul>
						{#if earlier.length > 0}
							<button
								type="button"
								class="row-link mt-2 inline-flex items-center gap-1 text-xs coarse:min-h-11"
								aria-expanded={isOpen}
								aria-controls={earlierId}
								aria-describedby={headingId}
								onclick={() => (expanded[group.key] = !isOpen)}
								><ChevronDown
									class={['h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180']}
									aria-hidden="true"
								/>{isOpen ? 'Hide earlier' : `Show ${earlier.length} earlier`}</button
							>
							<ul
								id={earlierId}
								class="mt-2 divide-y divide-stone-200 border-t border-stone-200 pt-2"
								hidden={!isOpen}
							>
								{#each earlier as member (member.fact.id)}
									{@render groupedFact(member)}
								{/each}
							</ul>
						{/if}
					{/if}
				</div>
			</li>
		{/each}
	</ul>
{:else if dto.facts.length === 0}
	<p class="text-sm text-stone-500 italic">No facts recorded.</p>
{:else}
	<ol class="space-y-3" data-testid="facts">
		{#each groups as group, groupIndex (group.key)}
			{@const [newest, ...earlier] = group.members}
			{@const earlierId = `${uid}-earlier-${groupIndex}`}
			{@const isOpen = expanded[group.key] === true}
			<li class="rounded-xl border border-stone-200 bg-white p-3" data-testid="fact-group">
				<h4 class="flex items-baseline gap-2 text-sm font-semibold text-stone-900">
					{group.label}
					{#if group.members.length > 1}
						<span class="text-xs font-normal text-stone-500">{group.members.length}</span>
					{/if}
				</h4>
				{#if group.isConflicting}
					<ul class="mt-1 divide-y divide-stone-200">
						{#each group.members as member (member.fact.id)}
							{@render factRow(member.fact, member.index)}
						{/each}
					</ul>
				{:else}
					<ul class="mt-1 divide-y divide-stone-200">
						{@render factRow(newest!.fact, newest!.index)}
					</ul>
					{#if earlier.length > 0}
						<button
							type="button"
							class="row-link mt-1 text-xs coarse:min-h-11"
							aria-expanded={isOpen}
							aria-controls={earlierId}
							onclick={() => (expanded[group.key] = !isOpen)}
							>{isOpen ? 'Hide earlier' : `Show ${earlier.length} earlier`}</button
						>
						<ul id={earlierId} class="divide-y divide-stone-200" hidden={!isOpen}>
							{#each earlier as member (member.fact.id)}
								{@render factRow(member.fact, member.index)}
							{/each}
						</ul>
					{/if}
				{/if}
			</li>
		{/each}
	</ol>
{/if}

<FactDialog
	isOpen={factDialog !== null}
	{treeId}
	personId={dto.person.id}
	fact={factDialog?.fact ?? null}
	{role}
	relatives={factDialog !== null && factDialog.fact === null ? relatives : []}
	citations={factDialog?.fact
		? citationsOfSubject(dto.evidence.citations, CITATION_SUBJECT_KINDS.EVENT, factDialog.fact.id)
		: []}
	onsaved={factSaved}
	onstale={factStale}
	oncancel={() => (factDialog = null)}
/>
