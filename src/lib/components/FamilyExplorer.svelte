<script lang="ts">
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
	/** Lenses of scroll after the last arrives, so it holds before the page moves on. */
	const TAIL_LENSES = 0.45;
	/** The share of each lens's scroll spent moving; the rest holds the lens still to be read. */
	const MOVE = { from: 0.22, to: 0.82 } as const;
	const TAB_MORPH_MS = 1100;

	let runway = $state<HTMLElement>();
	let pin = $state<HTMLElement>();
	let scroller = $state<HTMLElement>();

	/** Whether scrolling drives the lenses; off on narrow or short screens and under reduced motion. */
	let isPinned = $state(false);
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
	let unitPx = $state(0);
	/** Lenses scrolled through, 0 to LAST; whole numbers are a lens at rest. */
	let progress = $state(0);
	/** Tab mode: the morph between two lenses, driven by time instead of scroll. */
	let tab = $state<{ from: number; to: number; t: number }>({ from: 0, to: 0, t: 1 });
	let measure = $state<Measure>();

	const frame = $derived.by(() => {
		if (!isPinned) return { from: tab.from, to: tab.to, t: tab.t };
		const unit = Math.min(LAST, Math.floor(progress));
		if (unit >= LAST) return { from: LAST, to: LAST, t: 1 };
		return {
			from: unit,
			to: unit + 1,
			t: window01(progress - unit, MOVE.from, MOVE.to)
		};
	});
	const active = $derived(frame.t < 0.5 ? frame.from : frame.to);
	const fromId = $derived(LENS_IDS[frame.from]!);
	const toId = $derived(LENS_IDS[frame.to]!);
	const people = $derived(drawAll(fromId, toId, frame.t, measure));

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
		if (!runway || !pin) return;
		const wide = matchMedia('(min-width: 900px) and (min-height: 640px)');
		const still = matchMedia('(prefers-reduced-motion: reduce)');
		const runwayEl = runway;
		const pinEl = pin;
		let raf = 0;
		let pinTopPx = 0;

		const update = () => {
			raf = 0;
			if (!isPinned) return;
			const scrolled = pinTopPx - runwayEl.getBoundingClientRect().top;
			progress = Math.min(LAST, Math.max(0, scrolled / unitPx));
		};
		const measureRunway = () => {
			isStill = still.matches;
			const wasPinned = isPinned;
			isPinned = wide.matches && !still.matches;
			pinTopPx = Number.parseFloat(getComputedStyle(pinEl).top) || 0;
			unitPx = Math.round(innerHeight * 0.7);
			// Leaving the pin keeps whichever lens was showing, and entering it starts from the scroll.
			if (wasPinned && !isPinned) tab = { from: active, to: active, t: 1 };
			update();
		};
		const onScroll = () => {
			if (!raf) raf = requestAnimationFrame(update);
		};

		measureRunway();
		if (!isPinned) centreOn(active, true);
		// The browser jumps to an address's #section before this runway (and the 3D views' one
		// after it) grow, which leaves a section below them far off screen; jump again once they have.
		const hashTimer = setTimeout(() => {
			const id = decodeURIComponent(location.hash.slice(1));
			const target = id ? document.getElementById(id) : null;
			if (target && runwayEl.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING)
				target.scrollIntoView({ behavior: 'instant' });
		}, 0);
		const resize = new ResizeObserver(measureRunway);
		resize.observe(document.documentElement);
		wide.addEventListener('change', measureRunway);
		still.addEventListener('change', measureRunway);
		addEventListener('scroll', onScroll, { passive: true });
		return () => {
			resize.disconnect();
			wide.removeEventListener('change', measureRunway);
			still.removeEventListener('change', measureRunway);
			removeEventListener('scroll', onScroll);
			cancelAnimationFrame(raf);
			clearTimeout(hashTimer);
		};
	});

	let tabRaf = 0;
	function choose(index: number, event?: MouseEvent) {
		// The chip row scrolls sideways on narrow screens; keep the chosen one in sight there.
		if (!isPinned)
			(event?.currentTarget as HTMLElement | undefined)?.scrollIntoView({
				block: 'nearest',
				inline: 'nearest',
				behavior: isStill ? 'auto' : 'smooth'
			});
		if (isPinned && runway && pin) {
			// Scroll to the lens at rest; the morph plays on the way, through the lenses between.
			const pinTopPx = Number.parseFloat(getComputedStyle(pin).top) || 0;
			const top = scrollY + runway.getBoundingClientRect().top - pinTopPx + index * unitPx;
			scrollTo({ top: Math.ceil(top), behavior: 'smooth' });
			return;
		}
		cancelAnimationFrame(tabRaf);
		const from = active;
		if (from === index) return;
		if (isStill) {
			tab = { from: index, to: index, t: 1 };
			return;
		}
		const started = performance.now();
		const step = (now: number) => {
			const t = Math.min(1, (now - started) / TAB_MORPH_MS);
			tab = { from, to: index, t };
			if (t < 1) tabRaf = requestAnimationFrame(step);
		};
		tabRaf = requestAnimationFrame(step);
		centreOn(index);
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
		const left =
			lens === 'descendants' || lens === 'pedigree'
				? (focus.x - focus.w / 2 - 12) * scale
				: (index === LAST ? ROUTE_ROWS.x + 200 : focus.x) * scale - scroller.clientWidth / 2;
		scroller.scrollTo({ left, behavior: isStill || isInstant ? 'auto' : 'smooth' });
		measureOverflow();
	}
</script>

<section id="explore" class="explore" class:is-pinned={isPinned} aria-labelledby="explore-title">
	<div class="head">
		<Descent origin="union" />
		<h2 id="explore-title">One family, drawn six ways</h2>
		<p>
			The same people as a family view, four charts and a relationship finder. Every chart also
			comes as a text outline. {isPinned
				? 'Scroll to move between them, or pick one.'
				: 'Pick one to redraw the family.'}
		</p>
	</div>

	<!-- While pinned, the runway is taller than the space under the nav bar by exactly the lenses'
	scroll, so the page moves on once the last lens has held. -->
	<div
		class="runway"
		bind:this={runway}
		style:height={isPinned
			? `calc(100vh - var(--nav-height) + ${Math.round((LAST + TAIL_LENSES) * unitPx)}px)`
			: undefined}
	>
		<div class="pin" bind:this={pin}>
			<div class="bar">
				<ul class="lenses" aria-label="Ways to see the family">
					{#each LENSES as lens, i (lens.id)}
						<li>
							<button
								type="button"
								aria-pressed={active === i}
								onclick={(event) => choose(i, event)}
							>
								{lens.name}
							</button>
						</li>
					{/each}
					<li><a class="onward" href="#views">3D views</a></li>
				</ul>
				{#if isPinned}
					<span class="track" aria-hidden="true">
						<span class="fill" style:scale="{progress / LAST} 1"></span>
					</span>
				{/if}
			</div>

			<div
				class="frame"
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
					onscroll={measureOverflow}
					tabindex={isPinned ? undefined : 0}
					role={isPinned ? undefined : 'region'}
					aria-label={isPinned ? undefined : `${LENSES[active]!.name} drawing, scrolls sideways`}
				>
					<svg class="stage" viewBox="0 0 {STAGE.width} {STAGE.height}" aria-hidden="true">
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
								<text x={ROUTE_ROWS.x} y="258" class="route-note amber"
									>Includes adoptive links.</text
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
											<text x={line.x} y={line.y} opacity={line.alpha} class="line"
												>{line.text}</text
											>
										{/each}
									</g>
								</g>
							{/if}
						{/each}
					</svg>
				</div>
			</div>

			<div class="captions">
				{#each LENSES as lens, i (lens.id)}
					<div class="caption" class:is-active={active === i} aria-hidden={active !== i}>
						<h3>{lens.name}</h3>
						<p>{lens.text}</p>
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
		font-size: clamp(2rem, 4.2vw, 2.875rem);
		line-height: 1.1;
		letter-spacing: -0.02em;
		text-wrap: balance;
	}

	.head p {
		margin: 0 auto;
		max-width: 58ch;
		color: var(--stone-text);
		font-size: clamp(1.0625rem, 1.5vw, 1.1875rem);
		line-height: 1.6;
	}

	.pin {
		--stage-w: min(calc(var(--measure) - 2 * var(--gutter)), calc(100vw - 2 * var(--gutter)));
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 14px;
		max-width: var(--measure);
		margin: 0 auto;
		padding: 0 var(--gutter) var(--section-gap);
	}

	.is-pinned .pin {
		position: sticky;
		top: var(--nav-height);
		height: calc(100vh - var(--nav-height));
		/* The stage takes what the bar and the caption leave, at the drawing's own proportions. */
		--stage-w: min(
			calc(var(--measure) - 2 * var(--gutter)),
			calc(100vw - 2 * var(--gutter)),
			calc((100vh - var(--nav-height) - 200px) * 1040 / 640)
		);
		grid-template-columns: var(--stage-w);
		justify-content: center;
		align-content: center;
		padding-bottom: 16px;
	}

	.bar {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.lenses {
		display: flex;
		gap: 6px;
		margin: 0;
		padding: 0 0 4px;
		list-style: none;
		overflow-x: auto;
		scrollbar-width: none;
	}

	/* The app's chart style links: a rounded outline, the current one filled emerald. */
	.lenses button,
	.onward {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 16px;
		border: 1px solid var(--stone-edge);
		border-radius: 8px;
		background: var(--field-white);
		color: var(--emerald-900);
		font: inherit;
		font-size: 0.9375rem;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color 200ms var(--ease-out),
			color 200ms var(--ease-out),
			border-color 200ms var(--ease-out);
	}

	.lenses button:hover {
		background: var(--stone-shelf);
	}

	.lenses button[aria-pressed='true'] {
		border-color: var(--emerald-700);
		background: var(--emerald-700);
		color: var(--field-white);
	}

	.onward {
		margin-left: auto;
		border-color: transparent;
		background: transparent;
		text-decoration: underline;
		text-underline-offset: 4px;
		text-decoration-color: rgb(6 95 70 / 0.35);
	}

	.onward:hover {
		text-decoration-color: currentColor;
	}

	/* The line of descent again, filling as the family is redrawn. */
	.track {
		position: relative;
		height: 3px;
		border-radius: 9999px;
		background: var(--stone-rule);
	}

	.fill {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: var(--emerald-800);
		transform-origin: left center;
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
		fill: #92400e;
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
		font-size: 0.8125rem;
		font-style: italic;
		color: var(--stone-text);
		pointer-events: none;
	}

	/* Every caption shares one cell, so changing lens never moves the page. */
	.captions {
		display: grid;
	}

	.caption {
		grid-area: 1 / 1;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: baseline;
		align-content: start;
		gap: 4px 20px;
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
			opacity 320ms var(--ease-out) 60ms,
			translate 320ms var(--ease-out) 60ms;
	}

	.caption h3 {
		margin: 0;
		font-size: 1.25rem;
		color: var(--stone-ink);
	}

	.caption p {
		margin: 0;
		max-width: 70ch;
		color: var(--stone-strong);
	}

	.key {
		grid-column: 2;
		display: flex;
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
		/* The drawing scrolls under a floating label here, so it would cover a union's date. */
		.synthetic {
			position: static;
			display: block;
			padding: 8px 14px 0;
			border-radius: 0;
			background: none;
			text-align: right;
		}

		.caption {
			grid-template-columns: minmax(0, 1fr);
		}

		.key {
			grid-column: 1;
		}

		.onward {
			margin-left: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.caption,
		.caption.is-active {
			transition: none;
		}
	}
</style>
