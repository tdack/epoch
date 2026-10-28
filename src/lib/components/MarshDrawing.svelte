<script lang="ts">
	import { PEOPLE, datesOf } from '#lib/family.js';

	interface Props {
		/** The id of the element that names the drawing. */
		labelledBy: string;
		/** The label on the starting person's tab: "Starts here" for a sub-tree, "Focus" for the view. */
		tab: string;
		/** Fade and grey the people outside the Marsh line, as a sub-tree leaves them. */
		isLensOn?: boolean;
		/** The width under which the drawing stops shrinking, so its figure can pan it instead. */
		minWidthPx: number;
		/** The canvas's dot grid; a printed poster leaves it off. */
		hasGrid?: boolean;
	}

	let { labelledBy, tab, isLensOn = false, minWidthPx, hasGrid = true }: Props = $props();
	// One per drawing, so two on a page never share a pattern.
	const uid = $props.id();
	const dotsId = `dots-${uid}`;

	// The explorer's invented family, drawn as the app's family view (cards tinted by sex with
	// their glyphs, union markers, link inks and dashes): William Marsh, his parents and Mary's,
	// and everyone descended from the couple with their partners. The sub-trees page sets the
	// parents aside as outside the Marsh line; the reports page prints the whole drawing.
	// 164 wide so the longest date ("between 1908 and 1910 –", 12 units) stays inside its card.
	const CARD = { w: 164, h: 58 } as const;
	const UNION_R = 11;
	const ROW = [38, 150, 262, 374] as const;

	const INK = {
		biological: '#44403c',
		adoptive: '#4d7c4f',
		foster: '#a16207',
		union: '#8a5a14'
	} as const;
	const SEX = {
		m: { fill: '#dbe8f5', edge: '#5a84b5', glyph: '♂' },
		f: { fill: '#f6dde6', edge: '#b8607f', glyph: '♀' },
		u: { fill: '#ebe7e0', edge: '#7d756a', glyph: '' }
	} as const;

	interface Card {
		id: string;
		x: number;
		y: number;
		isOutside?: boolean;
		isRoot?: boolean;
	}
	const CARDS: Card[] = [
		{ id: 'john', x: 92, y: ROW[0], isOutside: true },
		{ id: 'ann', x: 280, y: ROW[0], isOutside: true },
		{ id: 'george', x: 480, y: ROW[0], isOutside: true },
		{ id: 'sarah', x: 668, y: ROW[0], isOutside: true },
		{ id: 'william', x: 186, y: ROW[1], isRoot: true },
		{ id: 'mary', x: 574, y: ROW[1] },
		{ id: 'thomas', x: 190, y: ROW[2] },
		{ id: 'ellen', x: 380, y: ROW[2] },
		{ id: 'arthur', x: 570, y: ROW[2] },
		{ id: 'rose', x: 106, y: ROW[3] },
		{ id: 'henry', x: 286, y: ROW[3] },
		{ id: 'jack', x: 474, y: ROW[3] },
		{ id: 'nell', x: 654, y: ROW[3] }
	];
	const cards = CARDS.map((card) => {
		const person = PEOPLE.find((p) => p.id === card.id)!;
		return { ...card, name: person.name, dates: datesOf(person), look: SEX[person.sex] };
	});
	const xOf = (id: string) => CARDS.find((c) => c.id === id)!.x;

	interface Union {
		a: string;
		b: string;
		y: number;
		label: string;
		isEnded?: boolean;
		isOutside?: boolean;
	}
	const UNIONS: Union[] = [
		{ a: 'john', b: 'ann', y: ROW[0], label: '', isOutside: true },
		{ a: 'george', b: 'sarah', y: ROW[0], label: '', isOutside: true },
		{ a: 'william', b: 'mary', y: ROW[1], label: '1866' },
		{ a: 'thomas', b: 'ellen', y: ROW[2], label: '1898 – div. 1904', isEnded: true },
		{ a: 'ellen', b: 'arthur', y: ROW[2], label: '1907' }
	];
	const unions = UNIONS.map((u) => ({ ...u, x: (xOf(u.a) + xOf(u.b)) / 2 }));
	const unionOf = (a: string) => unions.find((u) => u.a === a)!;

	/** The app's child link: a curve from under the union marker to the child's top. */
	const curve = (x1: number, y1: number, x2: number, y2: number) => {
		const mid = (y1 + y2) / 2;
		return `M${x1} ${y1}C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`;
	};
	type Kind = 'biological' | 'adoptive' | 'foster';
	const DASH: Record<Kind, string | undefined> = {
		biological: undefined,
		adoptive: '12 6',
		foster: '5 4'
	};
	const child = (from: string, to: string, row: number, kind: Kind = 'biological') => {
		const u = unionOf(from);
		return {
			kind,
			isOutside: u.isOutside ?? false,
			d: curve(u.x, u.y + UNION_R, xOf(to), row - CARD.h / 2)
		};
	};
	const CHILD_LINES = [
		child('john', 'william', ROW[1]),
		child('george', 'mary', ROW[1]),
		child('william', 'ellen', ROW[2]),
		child('thomas', 'rose', ROW[3]),
		child('thomas', 'henry', ROW[3], 'adoptive'),
		child('ellen', 'jack', ROW[3]),
		child('ellen', 'nell', ROW[3], 'foster')
	];
	// Wide enough for the label's 12-unit bold capitals and their tracking.
	const tabWidth = $derived(tab.length * 8 + 16);
</script>

<svg viewBox="0 0 760 420" role="img" aria-labelledby={labelledBy} style:min-width="{minWidthPx}px">
	<defs>
		<pattern id={dotsId} width="18" height="18" patternUnits="userSpaceOnUse">
			<circle cx="2" cy="2" r="1.3" fill="var(--tree-dot)" />
		</pattern>
	</defs>
	{#if hasGrid}
		<rect width="760" height="420" fill="url(#{dotsId})" />
	{/if}

	<g fill="none">
		{#each unions as u (u.a)}
			<path
				class:outside={isLensOn && u.isOutside}
				d="M{xOf(u.a) + CARD.w / 2} {u.y}H{u.x - UNION_R}M{xOf(u.b) - CARD.w / 2} {u.y}H{u.x +
					UNION_R}"
				stroke={INK.union}
				stroke-width="2.25"
				stroke-dasharray={u.isEnded ? '7 5' : undefined}
			/>
		{/each}
		{#each CHILD_LINES as line (line.d)}
			<path
				class:outside={isLensOn && line.isOutside}
				d={line.d}
				stroke={INK[line.kind]}
				stroke-width="2"
				stroke-dasharray={DASH[line.kind]}
			/>
		{/each}
	</g>

	<!-- The app's union marker: a disc holding two linked rings, dashed and slashed for a
	partnership that ended, its date above. -->
	{#each unions as u (u.a)}
		<g transform="translate({u.x} {u.y})" class:outside={isLensOn && u.isOutside} fill="none">
			<circle
				r={UNION_R}
				fill="#fdfbf7"
				stroke={INK.union}
				stroke-width="2"
				stroke-dasharray={u.isEnded ? '4 3' : undefined}
			/>
			<circle cx="-2.8" r="4" stroke={INK.union} stroke-width="1.5" />
			<circle cx="2.8" r="4" stroke={INK.union} stroke-width="1.5" />
			{#if u.isEnded}
				<line x1="-7.7" y1="7.7" x2="7.7" y2="-7.7" stroke={INK.union} stroke-width="2" />
			{/if}
			{#if u.label}
				<text y={-CARD.h / 2 - 6} text-anchor="middle" class="union-label">{u.label}</text>
			{/if}
		</g>
	{/each}

	{#each cards as card (card.id)}
		<g transform="translate({card.x} {card.y})" class:outside={isLensOn && card.isOutside}>
			{#if card.isRoot}
				<rect
					x={-CARD.w / 2 - 5}
					y={-CARD.h / 2 - 5}
					width={CARD.w + 10}
					height={CARD.h + 10}
					rx="12"
					fill="none"
					stroke="#1c1917"
					stroke-width="1.25"
				/>
				<g transform="translate(0 {-CARD.h / 2 - 5})">
					<rect x={-tabWidth / 2} y="-17" width={tabWidth} height="20" rx="4" fill="#1c1917" />
					<text y="-3" text-anchor="middle" class="tab">{tab}</text>
				</g>
			{/if}
			<rect
				x={-CARD.w / 2}
				y={-CARD.h / 2}
				width={CARD.w}
				height={CARD.h}
				rx="8"
				fill={card.look.fill}
				stroke={card.isRoot ? '#1c1917' : card.look.edge}
				stroke-width="1.5"
			/>
			{#if card.look.glyph}
				<!-- The app's own glyphs beside the tint, so colour is never the only signal. -->
				<text x={-CARD.w / 2 + 11} y={-CARD.h / 2 + 13} class="glyph" text-anchor="middle"
					>{card.look.glyph}</text
				>
			{/if}
			<text y="-1" text-anchor="middle" class="name">{card.name}</text>
			<text y="16" text-anchor="middle" class="dates">{card.dates}</text>
		</g>
	{/each}
</svg>

<style>
	svg {
		display: block;
		width: 100%;
		height: auto;
		font-family: var(--sans);
	}

	.name {
		font-size: 16px;
		font-weight: 600;
		fill: var(--stone-ink);
	}

	.dates {
		font-size: 12px;
		fill: var(--stone-strong);
		font-variant-numeric: tabular-nums;
	}

	.glyph {
		font-size: 12px;
		fill: var(--stone-strong);
	}

	.union-label {
		font-size: 12px;
		fill: #8a5a14;
		font-variant-numeric: tabular-nums;
	}

	.tab {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.04em;
		fill: #fff;
	}

	/* Outside the line: faded and grey, as the lens leaves them, still there and one click away. */
	.outside {
		opacity: 0.3;
		filter: grayscale(1);
	}

	/* The one moment: the whole family arrives, then the lens sets the rest aside. The timeline is
	the figure's (SubtreeFigure names it --lens), because a bare view() would bind to the sideways scroller and never run.
	Without scroll timelines, and under reduced motion, it is simply drawn with the lens on. */
	@supports (animation-timeline: view()) {
		@media (prefers-reduced-motion: no-preference) {
			.outside {
				animation: lens linear both;
				animation-timeline: --lens;
				animation-range: entry 70% cover 50%;
			}
		}
	}

	@keyframes lens {
		from {
			opacity: 1;
			filter: grayscale(0);
		}
		to {
			opacity: 0.3;
			filter: grayscale(1);
		}
	}
</style>
