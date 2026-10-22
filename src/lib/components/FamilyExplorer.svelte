<script lang="ts">
	import { untrack } from 'svelte';
	import Descent from './Descent.svelte';
	import {
		CHART_EDGES,
		FAMILY_ROW_Y,
		FAMILY_X,
		LAYOUTS,
		LENS_IDS,
		OUTLINES,
		PEOPLE,
		ROUTE,
		ROUTE_ROWS,
		STAGE,
		TREE_CARD,
		type LensId
	} from '#lib/family.js';
	import { drawAll, window01, type Measure } from '#lib/morph.js';
	import { LENSES } from '#lib/site.js';

	const LAST = LENS_IDS.length - 1;
	const MORPH_MS = 1100;
	/** How long each view holds while playing, its morph included: long enough to read its caption. */
	const DWELL_MS = 7000;
	/** A frame later than this was the tab hidden or throttled, and does not count as watching. */
	const MAX_FRAME_MS = 100;

	let section = $state<HTMLElement>();
	let frameEl = $state<HTMLElement>();
	let scroller = $state<HTMLElement>();

	let isStill = $state(false);
	let hasMoreLeft = $state(false);
	let hasMoreRight = $state(false);

	/** Which sides of the sideways-scrolling drawing have more of it out of view. */
	function measureOverflow() {
		if (!scroller) return;
		const hidden = scroller.scrollWidth - scroller.clientWidth;
		hasMoreLeft = scroller.scrollLeft > 2;
		hasMoreRight = scroller.scrollLeft < hidden - 2;
	}
	/** The morph between two lenses; `t` runs 0 to 1 over `MORPH_MS`. */
	let tab = $state<{ from: number; to: number; t: number }>({ from: 0, to: 0, t: 1 });
	let measure = $state<Measure>();

	/** Whether the views advance by themselves. The clock still waits while the drawing is off screen. */
	let isPlaying = $state(false);
	let isInView = $state(false);
	/** The showing view's share of its dwell, 0 to 1; the clock moves it and its pill fills with it. */
	let dwell = $state(0);
	/** Started once, on first sight; after that only the visitor's Play starts it. */
	let hasStarted = $state(false);
	/** The drawing is being scrolled by `centreOn`, not by a reader. */
	let isAutoScrolling = false;

	const frame = $derived(tab);
	/** The view the drawing looks most like; the caption and the ground follow it. */
	const active = $derived(frame.t < 0.5 ? frame.from : frame.to);
	/** The view the drawing is becoming; the pills, the clock and Replay follow it at once. */
	const shown = $derived(frame.to);
	const fromId = $derived(LENS_IDS[frame.from]!);
	const toId = $derived(LENS_IDS[frame.to]!);
	const people = $derived(drawAll(fromId, toId, frame.t, measure));
	const isAtEnd = $derived(!isPlaying && shown === LAST && dwell >= 1);
	/** A view picked while paused shows its pill full, one paused part way how far it got, and the
	first view waits empty until it starts playing. */
	const fill = $derived(isPlaying || dwell > 0 ? dwell : hasStarted || isStill ? 1 : 0);

	/** How present a lens's own lines and labels are: they leave early and arrive late. */
	const weightOf = (lens: LensId) => {
		if (fromId === toId) return lens === fromId ? 1 : 0;
		if (lens === fromId) return 1 - window01(frame.t, 0, 0.35);
		if (lens === toId) return window01(frame.t, 0.65, 1);
		return 0;
	};

	/** The app's chart link (`ChartCanvas`): an elbow between the facing edges of two cards. */
	const elbow = (lens: LensId, from: string, to: string) => {
		const a = LAYOUTS[lens][from]!;
		const b = LAYOUTS[lens][to]!;
		const isLeftward = b.x < a.x;
		const x1 = a.x + (isLeftward ? -a.w / 2 : a.w / 2);
		const x2 = b.x + (isLeftward ? b.w / 2 : -b.w / 2);
		const mid = (x1 + x2) / 2;
		return `M${x1} ${a.y}H${mid}V${b.y}H${x2}`;
	};
	const CHART_LENSES = (Object.keys(CHART_EDGES) as LensId[]).map((lens) => ({
		lens,
		paths: CHART_EDGES[lens]!.map(([a, b]) => elbow(lens, a, b))
	}));

	// The family view's links, in the app's line inks and dashes (`tree-view.ts`): line style
	// first, colour second.
	const INK = {
		biological: '#44403c',
		adoptive: '#4d7c4f',
		foster: '#a16207',
		union: '#8a5a14'
	} as const;
	const KEY = [
		{ label: 'Biological', ink: INK.biological, dash: '' },
		{ label: 'Adoptive', ink: INK.adoptive, dash: '12 6' },
		{ label: 'Foster', ink: INK.foster, dash: '5 4' },
		{ label: 'Partnership', ink: INK.union, dash: '' }
	];
	const UNION_R = 13;
	const middleOf = (row: number) => row + TREE_CARD.h / 2;
	interface Union {
		x: number;
		y: number;
		label: string;
		isEnded: boolean;
	}
	const UNIONS: Union[] = [
		{ x: FAMILY_X.ellen, y: middleOf(FAMILY_ROW_Y.parents), label: '1866', isEnded: false },
		{
			x: (FAMILY_X.thomas + FAMILY_X.ellen) / 2,
			y: middleOf(FAMILY_ROW_Y.partners),
			label: '1898 – div. 1904',
			isEnded: true
		},
		{
			x: (FAMILY_X.ellen + FAMILY_X.arthur) / 2,
			y: middleOf(FAMILY_ROW_Y.partners),
			label: '1907',
			isEnded: false
		}
	];
	const left = (x: number) => x - TREE_CARD.w / 2;
	const right = (x: number) => x + TREE_CARD.w / 2;
	/** The app's child link: a curve from under the union marker, or the parent, to the child's top. */
	const curve = (x1: number, y1: number, x2: number, y2: number) => {
		const mid = (y1 + y2) / 2;
		return `M${x1} ${y1}C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`;
	};
	const [parents, first, second] = UNIONS as [Union, Union, Union];
	const PARTNER_LINES = [
		{ x1: right(FAMILY_X.william), x2: left(FAMILY_X.mary), union: parents },
		{ x1: right(FAMILY_X.thomas), x2: left(FAMILY_X.ellen), union: first },
		{ x1: right(FAMILY_X.ellen), x2: left(FAMILY_X.arthur), union: second }
	].flatMap(({ x1, x2, union }) =>
		// Each partner's line runs from their card to the marker, so the marker sits on a gap.
		[`M${x1} ${union.y}H${union.x - UNION_R}`, `M${x2} ${union.y}H${union.x + UNION_R}`].map(
			(d) => ({ d, isEnded: union.isEnded })
		)
	);
	const CHILD_TOP = FAMILY_ROW_Y.children;
	const GRANDCHILD_TOP = FAMILY_ROW_Y.grandchildren;
	type LinkKind = 'biological' | 'adoptive' | 'foster';
	const CHILD_LINES: Array<{ kind: LinkKind; d: string }> = [
		{
			kind: 'biological',
			d: curve(parents.x, parents.y + UNION_R, FAMILY_X.ellen, FAMILY_ROW_Y.partners)
		},
		{ kind: 'biological', d: curve(first.x, first.y + UNION_R, FAMILY_X.rose, CHILD_TOP) },
		{ kind: 'adoptive', d: curve(first.x, first.y + UNION_R, FAMILY_X.henry, CHILD_TOP) },
		{ kind: 'biological', d: curve(second.x, second.y + UNION_R, FAMILY_X.jack, CHILD_TOP) },
		{ kind: 'foster', d: curve(second.x, second.y + UNION_R, FAMILY_X.nell, CHILD_TOP) },
		...[FAMILY_X.rose, FAMILY_X.henry, FAMILY_X.jack, FAMILY_X.nell].map(
			(x): { kind: LinkKind; d: string } => ({
				kind: 'biological',
				d: curve(x, CHILD_TOP + TREE_CARD.h, x, GRANDCHILD_TOP)
			})
		)
	];
	const kindOf = (kind: LinkKind) => KEY.find((k) => k.label.toLowerCase() === kind)!;

	const nameOf = (id: string) => PEOPLE.find((p) => p.id === id)!.name;
	const routeNameWidth = (name: string) =>
		measure ? measure(name, 15, 500) : name.length * 15 * 0.56;

	$effect(() => {
		// Measured once fonts are ready, so centred fan labels sit on their wedges.
		const context = document.createElement('canvas').getContext('2d');
		if (!context || !scroller) return;
		const family = getComputedStyle(scroller).fontFamily;
		const cache = new Map<string, number>();
		void document.fonts.ready.then(() => {
			measure = (text, size, weight) => {
				const key = `${weight} ${size} ${text}`;
				let width = cache.get(key);
				if (width === undefined) {
					context.font = `${weight} ${size}px ${family}`;
					width = context.measureText(text).width;
					cache.set(key, width);
				}
				return width;
			};
		});
	});

	$effect(() => {
		if (!section || !frameEl) return;
		const sectionEl = section;
		const still = matchMedia('(prefers-reduced-motion: reduce)');
		const readStill = () => {
			isStill = still.matches;
			if (isStill) isPlaying = false;
		};
		readStill();
		untrack(() => centreOn(active, true));
		// The clock waits whenever none of the drawing is in sight. It starts by itself once, when
		// most of the drawing is, or most of a screen too short to hold it; reduced motion waits for
		// the visitor's Play.
		const sight = new IntersectionObserver(
			([entry]) => {
				isInView = entry!.isIntersecting;
				const isMostlySeen =
					entry!.intersectionRatio >= 0.6 ||
					entry!.intersectionRect.height >= 0.6 * (entry!.rootBounds?.height ?? Infinity);
				if (isMostlySeen && !hasStarted && !isStill) {
					hasStarted = true;
					isPlaying = true;
				}
			},
			{ threshold: [0, 0.3, 0.6] }
		);
		sight.observe(frameEl);
		// The browser jumps to an address's #section before the 3D views' runway below grows, which
		// leaves a section after it far off screen; jump again once it has.
		const hashTimer = setTimeout(() => {
			const id = decodeURIComponent(location.hash.slice(1));
			const target = id ? document.getElementById(id) : null;
			if (target && sectionEl.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING)
				target.scrollIntoView({ behavior: 'instant' });
		}, 0);
		// A new width moves the drawing's middle, so the view is brought back into sight.
		const resize = new ResizeObserver(() => untrack(() => centreOn(shown, true)));
		resize.observe(frameEl);
		still.addEventListener('change', readStill);
		return () => {
			cancelAnimationFrame(morphRaf);
			sight.disconnect();
			resize.disconnect();
			still.removeEventListener('change', readStill);
			clearTimeout(hashTimer);
		};
	});

	// The clock: it runs only while playing and in sight, and a hidden tab draws no frames, so a
	// view never moves on while nobody can see it.
	$effect(() => {
		if (!isPlaying || !isInView) return;
		let raf = 0;
		let last = performance.now();
		const step = (now: number) => {
			dwell = Math.min(1, dwell + Math.min(now - last, MAX_FRAME_MS) / DWELL_MS);
			last = now;
			if (dwell >= 1) {
				// The last view holds, and the button offers to play them again.
				if (shown === LAST) {
					isPlaying = false;
					return;
				}
				go(shown + 1);
			}
			raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	});

	let morphRaf = 0;
	/** Redraw the family as another view, and start that view's dwell from nothing. */
	function go(index: number) {
		dwell = 0;
		centreOn(index);
		// Already there or on its way: let a morph in flight finish rather than freeze it part way.
		if (index === shown) return;
		cancelAnimationFrame(morphRaf);
		const from = active;
		if (isStill) {
			tab = { from: index, to: index, t: 1 };
			return;
		}
		const started = performance.now();
		const step = (now: number) => {
			const t = Math.min(1, (now - started) / MORPH_MS);
			tab = { from, to: index, t };
			if (t < 1) morphRaf = requestAnimationFrame(step);
		};
		morphRaf = requestAnimationFrame(step);
	}

	function togglePlay() {
		if (isPlaying) {
			isPlaying = false;
			return;
		}
		hasStarted = true;
		if (isAtEnd) go(0);
		isPlaying = true;
	}

	/** Someone panning the drawing is reading it, so it stops moving under them; the scrolls
	`centreOn` makes are not theirs. */
	function onDrawingScroll() {
		measureOverflow();
		if (!isAutoScrolling && scroller && scroller.scrollWidth > scroller.clientWidth)
			isPlaying = false;
	}

	/** The frame's edge fade, in pixels: a name under it is dimmed, so it counts as cut. */
	const FADE_PX = 28;
	/** Breathing room kept between a card and the fade it is snapped beside. */
	const SNAP_GAP_PX = 6;

	/**
	 * Nudge a scroll position so no card is cut by the frame's edge or hidden under its fade:
	 * a card is either wholly in sight or wholly out of it. Of the positions that line a card up
	 * with an edge, it takes the one that cuts fewest cards (and keeps Ellen whole), nearest the
	 * `ideal`. Where the drawing is wider than the frame some card is always partly out of sight
	 * at one end, and this finds the least bad place to stop.
	 */
	function clearOfEdges(
		lens: LensId,
		ideal: number,
		scale: number,
		view: number,
		total: number
	): number {
		const max = Math.max(0, total - view);
		const clamp = (x: number) => Math.min(max, Math.max(0, x));
		const cards = Object.values(LAYOUTS[lens]).map((p) => ({
			l: (p.x - p.w / 2) * scale,
			r: (p.x + p.w / 2) * scale
		}));
		const focus = LAYOUTS[lens].ellen!;
		const focusL = (focus.x - focus.w / 2) * scale;
		const focusR = (focus.x + focus.w / 2) * scale;
		const cost = (at: number) => {
			let cut = 0;
			// An edge only fades when there is more drawing beyond it.
			const hasFadeLeft = at > 2;
			const hasFadeRight = at < max - 2;
			for (const { l, r } of cards) {
				if (hasFadeLeft && l < at + FADE_PX && r > at) cut++;
				if (hasFadeRight && l < at + view && r > at + view - FADE_PX) cut++;
			}
			if (focusL < at || focusR > at + view) cut++;
			return cut * 1000 + Math.abs(at - ideal);
		};
		const aim = clamp(ideal);
		const options = [aim];
		for (const { l, r } of cards) {
			// A card just clear of the left fade, just off the left edge, or the same at the right.
			options.push(
				clamp(l - FADE_PX - SNAP_GAP_PX),
				clamp(r + SNAP_GAP_PX),
				clamp(r + FADE_PX + SNAP_GAP_PX - view),
				clamp(l - SNAP_GAP_PX - view)
			);
		}
		return options.reduce((best, at) => (cost(at) < cost(best) ? at : best), aim);
	}

	/** On a narrow screen the drawing scrolls sideways; bring the lens's middle into view. */
	function centreOn(index: number, isInstant = false) {
		if (!scroller) return;
		if (scroller.scrollWidth <= scroller.clientWidth) return measureOverflow();
		const lens = LENS_IDS[index]!;
		const focus = LAYOUTS[lens].ellen!;
		const scale = scroller.scrollWidth / STAGE.width;
		// The charts that grow rightwards start at the person, so centring them would cut the next
		// generation's names in half; they open with the person at the left edge instead.
		let left =
			lens === 'descendants' || lens === 'pedigree'
				? (focus.x - focus.w / 2 - 12) * scale
				: (index === LAST ? ROUTE_ROWS.x + 200 : focus.x) * scale - scroller.clientWidth / 2;
		// The fan's wedges and the relationship page are not rows of cards, so only the cards snap.
		if (lens !== 'fan' && lens !== 'relationship')
			left = clearOfEdges(lens, left, scale, scroller.clientWidth, scroller.scrollWidth);
		if (Math.abs(scroller.scrollLeft - left) > 1) {
			isAutoScrolling = true;
			const done = () => (isAutoScrolling = false);
			scroller.addEventListener('scrollend', done, { once: true });
			// Browsers without `scrollend` still let the reader take over once the move is done.
			setTimeout(done, 900);
		}
		scroller.scrollTo({ left, behavior: isStill || isInstant ? 'auto' : 'smooth' });
		measureOverflow();
	}
</script>

<section id="explore" class="explore" bind:this={section} aria-labelledby="explore-title">
	<div class="head">
		<Descent origin="union" />
		<h2 id="explore-title">One family, drawn six ways</h2>
		<p>
			The same people as a family view, four charts and a relationship finder. Every chart also
			comes as a text outline.
		</p>
	</div>

	<div class="show">
		<!-- The view's name, said aloud when the view changes: the pills are dots on a phone and the
			inactive captions are hidden from assistive tech, so a reader would not hear a change.
			Seen, the caption already opens with the same name, so this is for screen readers only.
			Polite, so it waits for a reader to finish rather than cutting in. -->
		<p class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
			Now showing: {LENSES[active]!.name}
		</p>

		<!-- Every caption shares one cell, so changing view never moves the drawing. -->
		<div class="captions">
			{#each LENSES as lens, i (lens.id)}
				<div class="caption" class:is-active={active === i} aria-hidden={active !== i}>
					<p><strong>{lens.name}.</strong> {lens.text}</p>
					{#if lens.id === 'family'}
						<ul class="key" aria-label="Kinds of link">
							{#each KEY as kind (kind.label)}
								<li>
									<svg width="30" height="8" aria-hidden="true">
										<path
											d="M2 4H28"
											stroke={kind.ink}
											stroke-width="2.5"
											stroke-linecap="round"
											stroke-dasharray={kind.dash || undefined}
										/>
									</svg>
									{kind.label}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/each}
		</div>

		<div
			class="frame"
			bind:this={frameEl}
			class:has-more-left={hasMoreLeft}
			class:has-more-right={hasMoreRight}
			style:--ground={active === 0 ? 'var(--tree-paper)' : 'var(--field-white)'}
		>
			<span class="synthetic">A sample family, invented for illustration.</span>
			<!-- Focusable only while it scrolls, so a keyboard can pan it with the arrow keys; a
				scrolling region is the one non-control that should take focus. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="scroller"
				bind:this={scroller}
				onscroll={onDrawingScroll}
				tabindex={hasMoreLeft || hasMoreRight ? 0 : undefined}
				role={hasMoreLeft || hasMoreRight ? 'region' : undefined}
				aria-label={hasMoreLeft || hasMoreRight
					? `${LENSES[active]!.name} drawing, scrolls sideways`
					: undefined}
			>
				<!-- A picture, not a document: its names and dates are drawn as text that would be read
					out in a jumble while the cards morph, so it is one image with a name. The people it
					shows are in words in the outline after the controls, and the caption above says what
					the view is for. -->
				<svg
					class="stage"
					viewBox="0 0 {STAGE.width} {STAGE.height}"
					role="img"
					aria-label="{LENSES[active]!
						.name} view of a sample family, invented for illustration; the outline after the controls describes every view in words."
				>
					<defs>
						<pattern id="explore-dots" width="18" height="18" patternUnits="userSpaceOnUse">
							<circle cx="2" cy="2" r="1.3" fill="var(--tree-dot)" />
						</pattern>
					</defs>
					<!-- The charts sit on white; the family view on the tree's dotted chart paper. -->
					<g style:opacity={weightOf('family')}>
						<rect width={STAGE.width} height={STAGE.height} fill="var(--tree-paper)" />
						<rect width={STAGE.width} height={STAGE.height} fill="url(#explore-dots)" />
					</g>

					<g fill="none" style:opacity={weightOf('family')}>
						{#each PARTNER_LINES as line (line.d)}
							<path
								d={line.d}
								stroke={INK.union}
								stroke-width="2.25"
								stroke-dasharray={line.isEnded ? '7 5' : undefined}
							/>
						{/each}
						{#each CHILD_LINES as line (line.d)}
							<path
								d={line.d}
								stroke={kindOf(line.kind).ink}
								stroke-width="2"
								stroke-dasharray={kindOf(line.kind).dash || undefined}
							/>
						{/each}
						<!-- The app's union marker (UnionMarker.svelte): a disc holding two linked rings,
							dashed and slashed through for a partnership that ended, its date above. -->
						{#each UNIONS as union (union.x + union.y)}
							<g transform="translate({union.x} {union.y})">
								<circle
									r={UNION_R}
									fill="#fdfbf7"
									stroke={INK.union}
									stroke-width="2"
									stroke-dasharray={union.isEnded ? '4 3' : undefined}
								/>
								<circle cx="-3.2" r="4.6" stroke={INK.union} stroke-width="1.5" />
								<circle cx="3.2" r="4.6" stroke={INK.union} stroke-width="1.5" />
								{#if union.isEnded}
									<line
										x1={-UNION_R * 0.7}
										y1={UNION_R * 0.7}
										x2={UNION_R * 0.7}
										y2={-UNION_R * 0.7}
										stroke={INK.union}
										stroke-width="2"
										stroke-linecap="round"
									/>
								{/if}
								<text y={-TREE_CARD.h / 2 - 6} text-anchor="middle" class="union-label"
									>{union.label}</text
								>
							</g>
						{/each}
					</g>

					{#each CHART_LENSES as chart (chart.lens)}
						{@const weight = weightOf(chart.lens)}
						{#if weight > 0}
							<g fill="none" stroke="#d6d3d1" stroke-width="2" style:opacity={weight}>
								{#each chart.paths as d (d)}
									<path {d} />
								{/each}
							</g>
						{/if}
					{/each}

					{#if weightOf('relationship') > 0}
						<!-- The relationship page's answer: the sentence, the common ancestors, the link
							types, then the steps beside a rule. -->
						<g style:opacity={weightOf('relationship')}>
							{#each [{ x: ROUTE_ROWS.x - 24, label: 'First person', picked: 'Alice Dunn' }, { x: ROUTE_ROWS.x + 216, label: 'Second person', picked: 'Tom Reed' }] as picker (picker.label)}
								<text x={picker.x} y="84" class="route-label">{picker.label}</text>
								<text x={picker.x} y="106" class="route-picked">{picker.picked}</text>
								<rect
									x={picker.x}
									y="116"
									width="220"
									height="32"
									rx="8"
									fill="#fff"
									stroke="#d6d3d1"
								/>
								<text x={picker.x + 10} y="137" class="route-search">Search by name</text>
							{/each}
							<rect
								x={ROUTE_ROWS.x - 24}
								y="160"
								width="520"
								height={ROUTE_ROWS.y0 + ROUTE.length * ROUTE_ROWS.step + 26 - 160}
								rx="12"
								fill="#fff"
								stroke="#e7e5e4"
							/>
							<text x={ROUTE_ROWS.x} y="204" class="route-title"
								>Tom Reed is Alice Dunn’s 1st cousin.</text
							>
							<text x={ROUTE_ROWS.x} y="234" class="route-note"
								>Through Thomas Reed and Ellen Marsh.</text
							>
							<text x={ROUTE_ROWS.x} y="258" class="route-note amber">Includes adoptive links.</text
							>
							<path
								d="M{ROUTE_ROWS.x} {ROUTE_ROWS.y0}V{ROUTE_ROWS.y0 +
									ROUTE.length * ROUTE_ROWS.step -
									6}"
								stroke="#a7f3d0"
								stroke-width="2"
							/>
							{#each ROUTE as step, i (step.id)}
								{@const width = routeNameWidth(nameOf(step.id))}
								{@const baseline = ROUTE_ROWS.y0 + i * ROUTE_ROWS.step + ROUTE_ROWS.h / 2 + 5}
								<path
									d="M{ROUTE_ROWS.x + 14} {baseline + 3}h{width}"
									stroke="#065f46"
									stroke-width="1"
								/>
								{#if step.relation}
									<text x={ROUTE_ROWS.x + 14 + width + 6} y={baseline} class="route-step"
										>— {step.relation}</text
									>
								{/if}
							{/each}
						</g>
					{/if}

					{#each people as person (person.id)}
						{#if person.opacity > 0.005}
							<!-- A private placeholder as the app draws it: faded, dashed, its name in italic. -->
							<g style:opacity={person.isPrivate ? person.opacity * 0.7 : person.opacity}>
								{#if person.ringPath}
									<g opacity={person.ringAlpha}>
										<path d={person.ringPath} fill="none" stroke="#1c1917" stroke-width="1.25" />
										<g transform="translate({person.textX} {person.textY + person.ringTop})">
											<rect x="-34" y="-17" width="68" height="20" rx="4" fill="#1c1917" />
											<text y="-3" text-anchor="middle" class="focus-tab">Focus</text>
										</g>
									</g>
								{/if}
								<path
									d={person.path}
									fill={person.fill}
									fill-opacity={person.fillAlpha}
									stroke={person.edge}
									stroke-opacity={person.edgeAlpha}
									stroke-width={person.edgeWidth}
									stroke-dasharray={person.isPrivate ? '6 4' : undefined}
								/>
								<g
									transform="translate({person.textX} {person.textY}) rotate({person.textTurn})"
									opacity={person.textAlpha}
								>
									{#if person.symbolAlpha > 0.01 && person.sex !== 'u'}
										<!-- The app's own glyphs beside the tint, so colour is never the only signal. -->
										<text
											x={person.symbolX}
											y="-7"
											text-anchor="middle"
											class="symbol"
											opacity={person.symbolAlpha}>{person.sex === 'f' ? '♀' : '♂'}</text
										>
									{/if}
									<text
										x={person.nameX}
										y={person.nameY}
										fill={person.nameFill}
										font-size={person.nameSize}
										font-weight={person.nameWeight}
										font-style={person.isPrivate ? 'italic' : undefined}>{person.name}</text
									>
									{#each person.lines as line, i (i)}
										<text x={line.x} y={line.y} opacity={line.alpha} class="line">{line.text}</text>
									{/each}
								</g>
							</g>
						{/if}
					{/each}
				</svg>
			</div>
		</div>

		<div class="controls">
			<ul class="pills" aria-label="Ways to see the family">
				{#each LENSES as lens, i (lens.id)}
					<li>
						<button
							type="button"
							class="pill"
							aria-label={lens.name}
							aria-pressed={shown === i}
							onclick={() => go(i)}
							style:--fill={shown === i ? fill : 0}
						>
							<span class="track">
								<span class="label">{lens.name}</span>
								<!-- The same label again in the fill's ink, clipped to how far the view has
								played, so the name turns over as the fill passes it. -->
								<span class="filled" aria-hidden="true"><span>{lens.name}</span></span>
							</span>
						</button>
					</li>
				{/each}
			</ul>
			<button
				type="button"
				class="play"
				onclick={togglePlay}
				aria-label={isPlaying
					? 'Pause the views'
					: isAtEnd
						? 'Play the views again'
						: 'Play the views'}
			>
				<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
					{#if isPlaying}
						<rect x="6" y="5" width="4" height="14" rx="1.5" />
						<rect x="14" y="5" width="4" height="14" rx="1.5" />
					{:else if isAtEnd}
						<path
							d="M4 12a8 8 0 1 0 2.6-5.9M4 4v5h5"
							fill="none"
							stroke="currentColor"
							stroke-width="2.4"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					{:else}
						<path
							d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"
						/>
					{/if}
				</svg>
			</button>
		</div>
	</div>

	<div class="visually-hidden">
		<h3>What each view shows</h3>
		<dl>
			{#each LENSES as lens (lens.id)}
				<dt>{lens.name}</dt>
				<dd>{OUTLINES[lens.id]}</dd>
			{/each}
		</dl>
	</div>
</section>

<style>
	.explore {
		background: var(--page-cream);
	}

	.head {
		max-width: 760px;
		margin: 0 auto;
		padding: 0 var(--gutter) clamp(32px, 4vw, 48px);
		text-align: center;
	}

	h2 {
		margin: 0 0 14px;
		font-size: var(--site-display);
		line-height: 1.1;
		letter-spacing: -0.02em;
		text-wrap: balance;
	}

	.head p {
		margin: 0 auto;
		max-width: 58ch;
		color: var(--stone-text);
		font-size: var(--site-lede);
		line-height: 1.6;
	}

	/* The stage is as wide as the page allows and short enough that the caption, the drawing and
	its controls fit one screen together, at the drawing's own proportions. */
	.show {
		--stage-w: min(
			calc(var(--measure) - 2 * var(--gutter)),
			calc(100vw - 2 * var(--gutter)),
			calc((100svh - var(--nav-height) - 260px) * 1040 / 640)
		);
		display: grid;
		grid-template-columns: max(var(--stage-w), min(720px, calc(100vw - 2 * var(--gutter))));
		justify-content: center;
		gap: 20px;
		padding: 0 var(--gutter) var(--section-gap);
	}

	.frame {
		position: relative;
		border: 1px solid var(--stone-rule);
		border-radius: 16px;
		background: var(--ground, var(--field-white));
		box-shadow: 0 1px 2px rgb(28 25 23 / 0.06);
		overflow: hidden;
	}

	/* Below about 720px the cards would shrink past reading size, so the drawing keeps its size
	and scrolls sideways instead. */
	/* A fade on whichever side has more drawing out of view, so it reads as scrollable. */
	.frame::before,
	.frame::after {
		content: '';
		position: absolute;
		z-index: 1;
		inset-block: 0;
		width: 28px;
		opacity: 0;
		pointer-events: none;
		transition: opacity 200ms var(--ease-out);
	}

	.frame::before {
		left: 0;
		background: linear-gradient(to right, var(--ground), transparent);
	}

	.frame::after {
		right: 0;
		background: linear-gradient(to left, var(--ground), transparent);
	}

	.frame.has-more-left::before,
	.frame.has-more-right::after {
		opacity: 1;
	}

	.scroller {
		overflow-x: auto;
		overscroll-behavior-x: contain;
		scrollbar-color: var(--stone-edge) transparent;
	}

	.stage {
		display: block;
		width: 100%;
		min-width: 720px;
		height: auto;
		font-family: var(--sans);
	}

	.line {
		font-size: 12px;
		fill: var(--stone-text);
		font-variant-numeric: tabular-nums;
	}

	.symbol {
		font-size: 20px;
		fill: var(--stone-text);
	}

	.focus-tab {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		fill: var(--tree-paper);
	}

	.union-label {
		font-size: 11px;
		font-weight: 600;
		fill: #8a5a14;
	}

	.route-label {
		font-size: 12px;
		font-weight: 600;
		fill: var(--stone-strong);
	}

	.route-picked {
		font-size: 14px;
		fill: var(--stone-ink);
	}

	.route-title {
		font-size: 19px;
		font-weight: 600;
		fill: var(--stone-ink);
	}

	/* The app's empty search field: its placeholder, never typed into. */
	.route-search {
		font-size: 13px;
		fill: #a8a29e;
	}

	.route-note {
		font-size: 14px;
		fill: var(--stone-text);
	}

	.route-note.amber {
		fill: #78350f;
	}

	.route-step {
		font-size: 14px;
		fill: #78716c;
	}

	.synthetic {
		position: absolute;
		top: 10px;
		right: 14px;
		padding: 2px 10px;
		border-radius: 9999px;
		background: rgb(253 251 247 / 0.9);
		font-size: var(--site-label);
		font-style: italic;
		color: var(--stone-text);
		pointer-events: none;
	}

	.captions {
		display: grid;
		justify-items: center;
		text-align: center;
	}

	/* A short caption sits down against the drawing it describes, not up at the top of the cell. */
	.caption {
		grid-area: 1 / 1;
		align-self: end;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		opacity: 0;
		visibility: hidden;
		translate: 0 6px;
		transition:
			opacity 260ms var(--ease-out),
			translate 260ms var(--ease-out),
			visibility 0s 260ms;
	}

	.caption.is-active {
		opacity: 1;
		visibility: visible;
		translate: 0 0;
		transition:
			opacity 360ms var(--ease-out) 120ms,
			translate 360ms var(--ease-out) 120ms;
	}

	.caption p {
		margin: 0;
		max-width: 60ch;
		font-size: var(--site-lede);
		line-height: 1.55;
		color: var(--stone-strong);
		text-wrap: balance;
	}

	.caption strong {
		color: var(--stone-ink);
	}

	/* The controls under the drawing: a tray of the views, each filling as it plays, and Play. */
	.controls {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 12px;
	}

	.pills {
		display: flex;
		gap: 2px;
		margin: 0;
		padding: 4px;
		list-style: none;
		border: 1px solid var(--stone-rule);
		border-radius: 9999px;
		background: var(--stone-shelf);
	}

	.pill {
		display: block;
		padding: 0;
		border: 0;
		border-radius: 9999px;
		background: none;
		font: inherit;
		cursor: pointer;
	}

	.track {
		position: relative;
		display: grid;
		place-items: center;
		min-height: 40px;
		padding: 0 16px;
		border-radius: 9999px;
		font-size: var(--site-small);
		font-weight: 600;
		white-space: nowrap;
		color: var(--stone-strong);
		transition: background-color 200ms var(--ease-out);
	}

	.pill:hover .track {
		background: var(--field-white);
		color: var(--emerald-900);
	}

	.pill[aria-pressed='true'] .track {
		background: var(--field-white);
		color: var(--emerald-900);
		box-shadow: 0 1px 2px rgb(28 25 23 / 0.08);
	}

	/* The fill and its own copy of the label, cut back to the share of the view played. */
	.filled {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		border-radius: inherit;
		background: var(--emerald-800);
		color: var(--vellum);
		clip-path: inset(0 calc((1 - var(--fill, 0)) * 100%) 0 0);
	}

	.play {
		display: grid;
		place-items: center;
		flex: none;
		width: 50px;
		height: 50px;
		min-width: 44px;
		min-height: 44px;
		padding: 0;
		border: 1px solid var(--stone-rule);
		border-radius: 9999px;
		background: var(--stone-shelf);
		color: var(--emerald-900);
		fill: currentColor;
		cursor: pointer;
		transition: background-color 200ms var(--ease-out);
	}

	.play:hover {
		background: var(--field-white);
	}

	.key {
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		gap: 4px 18px;
		margin: 4px 0 0;
		padding: 0;
		list-style: none;
		font-size: 0.875rem;
		color: var(--stone-text);
	}

	.key li {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.explore :focus-visible {
		outline: 2px solid var(--emerald-700);
		outline-offset: 2px;
	}

	/* The frame clips anything outside it, so the drawing's ring is drawn inside. */
	.scroller:focus-visible {
		outline-offset: -2px;
		border-radius: 16px;
	}

	@media (max-width: 720px) {
		/* The drawing keeps a size at which a card's name is about 13px and its dates 11px on screen
		(960 / 1040 of the drawing's own sizes), and the frame scrolls over it; at 720 they were 9
		and 8. Each view stops where no card is cut by the frame's edge (`clearOfEdges`). */
		.stage {
			min-width: 960px;
		}

		/* The drawing scrolls under a floating label here, so it would cover a union's date. */
		.synthetic {
			position: static;
			display: block;
			padding: 8px 14px 0;
			border-radius: 0;
			background: none;
			text-align: right;
		}
	}

	/* Six names do not fit a phone, so each view is a dot, and the playing one a capsule that fills,
	its name in the caption above. The button is a 44px target around the dot: 44 wide too wherever
	the tray and Play fit in one row (from 360px of screen), and below that each target narrows
	evenly, to about 38px at 320, rather than the row overflowing. */
	@media (max-width: 760px) {
		.controls {
			gap: 6px;
		}

		/* The tray takes the room there is, up to six 44px targets and their gaps (6 x 44 + 5 x 2),
		and the targets share it evenly. Left to size itself it shrank around the dots. */
		.pills {
			flex: 1 1 auto;
			min-width: 0;
			max-width: 274px;
			gap: 2px;
			padding: 0;
		}

		.pills li {
			display: flex;
			flex: 1 1 0;
			min-width: 0;
			max-width: 44px;
		}

		.pill {
			display: grid;
			place-items: center;
			flex: 1;
			min-width: 0;
			height: 44px;
		}

		.track {
			min-height: 0;
			width: 8px;
			/* The capsule never outgrows a target that has narrowed. */
			max-width: 100%;
			height: 8px;
			padding: 0;
			/* stone-500: a dot is the control's only mark here, so it needs 3:1 against the tray. */
			background: #78716c;
			font-size: 0;
			transition:
				width 300ms var(--ease-out),
				background-color 200ms var(--ease-out);
		}

		.pill:hover .track {
			background: var(--stone-body);
		}

		.pill[aria-pressed='true'] .track {
			width: 36px;
			background: #78716c;
			box-shadow: none;
		}

		.track .label,
		.filled span {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
		}

		.play {
			width: 44px;
			height: 44px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.caption,
		.caption.is-active,
		.track {
			transition: none;
		}
	}
</style>
