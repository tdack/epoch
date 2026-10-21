<script lang="ts">
	import {
		linkKey,
		type Highlight,
		type HighlightSource,
		type KinSource
	} from '#lib/tree-layout/highlight.js';
	import type { Palette } from '#lib/shared/palette.js';
	import { yearsLine } from './tree-view.js';
	import {
		capitalised,
		describeMark,
		hoverCard,
		type PickTarget,
		type ShellPerson
	} from './webgl-tree.js';

	/**
	 * The card that follows the pointer over a person, partnership or line in a WebGL view. Pointer
	 * only, so it is hidden from assistive tech: a name button's own label carries the same facts.
	 */
	interface Props {
		/** What the pointer is over; null shows nothing. */
		hovered: PickTarget | null;
		/** The pointer inside the shell, in CSS pixels; null while orbiting or off the canvas. */
		pointerAt: { x: number; y: number } | null;
		/** The shell's size, so the card flips to the other side of the pointer near an edge. */
		shellWidth: number;
		shellHeight: number;
		/** Everyone drawn. Private people are never named. */
		people: ShellPerson[];
		kin: KinSource;
		/** What is lit now, for saying why the hovered item is. */
		highlight: Highlight;
		palette: Palette;
		/** The whole tree is drawn: a click lights a person's line instead of refocusing. */
		isWholeTree: boolean;
		isTracing: boolean;
		/** What to call a source in a sentence; see `sourceLabel`. */
		labelOf: (source: HighlightSource) => string;
	}

	let {
		hovered,
		pointerAt,
		shellWidth,
		shellHeight,
		people,
		kin,
		highlight,
		palette,
		isWholeTree,
		isTracing,
		labelOf
	}: Props = $props();

	/** How far the hover card sits from the pointer, in CSS pixels. */
	const CARD_OFFSET_PX = 14;

	let cardWidth = $state(0);
	let cardHeight = $state(0);

	const personById = $derived(new Map(people.map((p) => [p.id, p])));
	const hoveredPerson = $derived(
		hovered?.kind === 'person' ? personById.get(hovered.id) : undefined
	);
	/** Why the item under the pointer is lit, if it is. */
	const hoveredMark = $derived.by(() => {
		if (!hovered) return null;
		const marks =
			hovered.kind === 'person'
				? highlight.people
				: hovered.kind === 'union'
					? highlight.unions
					: highlight.links;
		const mark = marks.get(hovered.id);
		return mark ? describeMark(mark, highlight, labelOf) : null;
	});
	const card = $derived(
		hoveredPerson && hoveredPerson.person.isPrivate !== true
			? hoverCard(hoveredPerson.person, people, hoveredMark)
			: null
	);
	/** The card for a partnership or a line: a title and a line or two, never a private person's name. */
	const itemCard = $derived.by(() => {
		if (!hovered || hovered.kind === 'person') return null;
		if (hovered.kind === 'union') {
			const union = kin.unions.find((u) => u.id === hovered!.id);
			if (!union) return null;
			const children = kin.childLinks.filter((l) => l.fromUnionId === union.id).length;
			return {
				title: capitalised(
					labelOf({ kind: 'union', unionId: union.id, shouldSplitPartners: true })
				),
				meta: `${union.partnerIds.length} ${union.partnerIds.length === 1 ? 'partner' : 'partners'} · ${children} ${children === 1 ? 'child' : 'children'} in view`,
				hint: isTracing
					? 'Click to add to or remove from the trace'
					: 'Click to light this partnership'
			};
		}
		const link = kin.childLinks.find((l) => linkKey(l) === hovered!.id);
		if (!link) return null;
		return {
			title: capitalised(labelOf({ kind: 'link', key: hovered.id })),
			meta: 'A parent-child line',
			hint: isTracing ? 'Click to add to or remove from the trace' : 'Click to light this line'
		};
	});
	/** Below and right of the pointer, flipped to the other side where it would leave the view. */
	const cardAt = $derived.by(() => {
		if (!pointerAt) return null;
		const x =
			pointerAt.x + CARD_OFFSET_PX + cardWidth > shellWidth
				? pointerAt.x - CARD_OFFSET_PX - cardWidth
				: pointerAt.x + CARD_OFFSET_PX;
		const y =
			pointerAt.y + CARD_OFFSET_PX + cardHeight > shellHeight
				? pointerAt.y - CARD_OFFSET_PX - cardHeight
				: pointerAt.y + CARD_OFFSET_PX;
		return { x: Math.max(4, x), y: Math.max(4, y) };
	});
	function sexColourOf(person: ShellPerson['person']): string {
		if (person.sex === 'M') return palette.sex.male.sphere;
		if (person.sex === 'F') return palette.sex.female.sphere;
		return palette.sex.unknown.sphere;
	}
</script>

{#if (card || itemCard) && cardAt}
	<!-- Pointer only, so hidden from assistive tech: a name's own label carries its years. -->
	<div
		class="hover-card pointer-events-none absolute top-0 left-0 z-30"
		style="translate:{cardAt.x}px {cardAt.y}px"
		aria-hidden="true"
		data-testid="hover-card"
		bind:offsetWidth={cardWidth}
		bind:offsetHeight={cardHeight}
	>
		{#if card && hoveredPerson}
			{@const years = yearsLine(hoveredPerson.person)}
			<p class="name">{card.name}</p>
			{#if years}<p class="years">{years}</p>{/if}
			<p class="meta">
				<i style="background:{sexColourOf(hoveredPerson.person)}"
				></i>{card.sex}{#if card.roleLabel}<span class="sep">·</span>{card.roleLabel}{/if}
			</p>
			<p class="meta">
				{card.partnershipCount}
				{card.partnershipCount === 1 ? 'partnership' : 'partnerships'}<span class="sep">·</span
				>{card.childrenInView}
				{card.childrenInView === 1 ? 'child' : 'children'} in view
			</p>
			<p class="hint">
				{isTracing
					? 'Click to add to or remove from the trace'
					: isWholeTree
						? 'Click to light their line'
						: 'Click to mark'} · double-click to centre and see details
			</p>
		{:else if itemCard}
			<p class="name">{itemCard.title}</p>
			<p class="meta">{itemCard.meta}</p>
			{#if hoveredMark}<p class="meta">{hoveredMark}</p>{/if}
			<p class="hint">{itemCard.hint}</p>
		{/if}
	</div>
{/if}

<style>
	.hover-card {
		max-width: 16rem;
		border: 1px solid var(--tree-panel-border);
		border-radius: 0.625rem;
		background: var(--tree-panel);
		padding: 0.5rem 0.75rem;
		font-size: 0.75rem;
		line-height: 1.35;
		color: var(--tree-ink-muted);
		box-shadow: 0 8px 24px -8px rgb(28 25 23 / 0.35);
	}
	.hover-card .name {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--tree-ink);
	}
	.hover-card .years {
		color: var(--tree-ink);
	}
	.hover-card .meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		margin-top: 0.125rem;
	}
	.hover-card .meta i {
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		margin-right: 0.3125rem;
		border-radius: 9999px;
	}
	.hover-card .sep {
		margin: 0 0.3125rem;
	}
	.hover-card .hint {
		margin-top: 0.3125rem;
		font-size: 0.6875rem;
		color: var(--color-emerald-800);
	}
</style>
