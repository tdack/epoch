<script lang="ts">
	// Inks and card tints are the app's tree tokens (DESIGN.md, Tree canvas), so the figure looks
	// like the product rather than a drawing of it.
	const KINDS = [
		{ id: 'biological', label: 'Biological', ink: '#44403c', dash: '' },
		{ id: 'adoptive', label: 'Adoptive', ink: '#4d7c4f', dash: '9 7' },
		{ id: 'foster', label: 'Foster', ink: '#a16207', dash: '2 6' },
		{ id: 'partnership', label: 'Partnership', ink: '#8a5a14', dash: '' }
	] as const;

	type Kind = (typeof KINDS)[number]['id'];

	interface Card {
		x: number;
		y: number;
		w: number;
		name: string;
		dates: string;
		sex: 'm' | 'f';
		isFocus?: boolean;
	}

	const SEX = {
		m: { fill: '#dbe8f5', edge: '#5a84b5' },
		f: { fill: '#f6dde6', edge: '#b8607f' }
	};

	const CARDS: Card[] = [
		{ x: 40, y: 48, w: 160, name: 'Thomas Reed', dates: '1871 – 1932', sex: 'm' },
		{
			x: 330,
			y: 48,
			w: 200,
			name: 'Ellen Marsh',
			dates: 'ABT 1874 – 1951',
			sex: 'f',
			isFocus: true
		},
		{ x: 660, y: 48, w: 160, name: 'Arthur Vale', dates: '1869 – 1940', sex: 'm' },
		{ x: 75, y: 262, w: 160, name: 'Rose Reed', dates: 'ABT 1900', sex: 'f' },
		{ x: 285, y: 262, w: 160, name: 'Henry Reed', dates: '1899', sex: 'm' },
		{ x: 415, y: 262, w: 160, name: 'Jack Vale', dates: 'BET 1908 AND 1910', sex: 'm' },
		{ x: 625, y: 262, w: 160, name: 'Nell Price', dates: '1912', sex: 'f' }
	];

	const LINES: { kind: Kind; d: string }[] = [
		{ kind: 'partnership', d: 'M200 80H330' },
		{ kind: 'partnership', d: 'M530 80H660' },
		{ kind: 'biological', d: 'M265 80V200H155V262' },
		{ kind: 'adoptive', d: 'M265 200H365V262' },
		{ kind: 'biological', d: 'M595 80V200H495V262' },
		{ kind: 'foster', d: 'M595 200H705V262' }
	];

	const inkOf = (kind: Kind) => KINDS.find((k) => k.id === kind)!;

	let highlighted = $state<Kind | null>(null);

	const toggle = (kind: Kind) => (highlighted = highlighted === kind ? null : kind);
</script>

<figure class="figure">
	<div class="scroller">
		<svg
			viewBox="0 0 860 390"
			role="img"
			aria-labelledby="family-title family-desc"
			class:is-filtered={highlighted !== null}
		>
			<title id="family-title">A sample family drawn the way Epoch draws it</title>
			<desc id="family-desc">
				Ellen Marsh has two partnerships. With Thomas Reed, from 1898 to 1904: a biological
				daughter, Rose, born about 1900, and an adopted son, Henry, born 1899. With Arthur Vale,
				from 1907: a biological son, Jack, born between 1908 and 1910, and a foster daughter, Nell,
				born 1912. Arthur is Rose's step-father, worked out from Ellen's partnerships.
			</desc>
			<defs>
				<pattern id="dot-grid" width="18" height="18" patternUnits="userSpaceOnUse">
					<circle cx="2" cy="2" r="1.3" fill="var(--tree-dot)" />
				</pattern>
			</defs>
			<rect width="860" height="390" fill="url(#dot-grid)" />

			<g fill="none" stroke-width="2.5" stroke-linecap="round">
				{#each LINES as line, i (i)}
					<path
						d={line.d}
						stroke={inkOf(line.kind).ink}
						stroke-dasharray={inkOf(line.kind).dash || undefined}
						class="link"
						class:is-lit={highlighted === line.kind}
					/>
				{/each}
			</g>

			<g class="link" class:is-lit={highlighted === 'partnership'}>
				<rect x="258" y="73" width="14" height="14" transform="rotate(45 265 80)" fill="#8a5a14" />
				<rect x="588" y="73" width="14" height="14" transform="rotate(45 595 80)" fill="#8a5a14" />
				<text x="265" y="120" text-anchor="middle" class="union-label"
					>1st partnership · 1898–1904</text
				>
				<text x="595" y="120" text-anchor="middle" class="union-label">2nd partnership · 1907–</text
				>
			</g>

			{#each CARDS as card (card.name)}
				<g class="card">
					{#if card.isFocus}
						<!-- The focus person's mounted-print double rule, as on the app's tree. -->
						<rect
							x={card.x - 6}
							y={card.y - 6}
							width={card.w + 12}
							height="76"
							rx="16"
							fill="none"
							stroke="#1c1917"
						/>
					{/if}
					<rect
						x={card.x}
						y={card.y}
						width={card.w}
						height="64"
						rx="12"
						fill={SEX[card.sex].fill}
						stroke={card.isFocus ? '#1c1917' : SEX[card.sex].edge}
						stroke-width={card.isFocus ? 3 : 1.75}
					/>
					<!-- A sex symbol beside the tint, so colour is never the only signal. -->
					{#if card.sex === 'f'}
						<g
							transform="translate({card.x + 14} {card.y + 15})"
							fill="none"
							stroke={SEX.f.edge}
							stroke-width="1.6"
							stroke-linecap="round"
						>
							<circle cx="5" cy="5" r="4" /><path d="M5 9v6M2.5 12.5h5" />
						</g>
					{:else}
						<g
							transform="translate({card.x + 14} {card.y + 17})"
							fill="none"
							stroke={SEX.m.edge}
							stroke-width="1.6"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<circle cx="4.5" cy="8.5" r="4" /><path d="M7.5 5.5 12 1M8 1h4v4" />
						</g>
					{/if}
					<text x={card.x + 34} y={card.y + 28} class="name">{card.name}</text>
					<text x={card.x + 34} y={card.y + 48} class="dates">{card.dates}</text>
				</g>
			{/each}

			<g class="note">
				<path d="M155 336v14" stroke="#a8a29e" stroke-width="1.5" stroke-dasharray="2 3" />
				<text x="155" y="366" text-anchor="middle">Arthur's step-daughter, worked out</text>
				<text x="155" y="382" text-anchor="middle">from Ellen's partnerships</text>
			</g>
		</svg>
	</div>

	<figcaption>
		<span class="visually-hidden">Highlight one kind of link:</span>
		<ul class="legend">
			{#each KINDS as kind (kind.id)}
				<li>
					<button
						type="button"
						aria-pressed={highlighted === kind.id}
						onclick={() => toggle(kind.id)}
					>
						<svg width="34" height="8" aria-hidden="true">
							<path
								d="M2 4H32"
								stroke={kind.ink}
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-dasharray={kind.dash || undefined}
							/>
						</svg>
						{kind.label}
					</button>
				</li>
			{/each}
		</ul>
		<span class="synthetic">A sample family, invented for illustration.</span>
	</figcaption>
</figure>

<style>
	.figure {
		margin: 0 auto;
		max-width: 940px;
		background: var(--tree-paper);
		border: 1px solid var(--stone-rule);
		border-radius: 16px;
		box-shadow: 0 1px 2px rgb(28 25 23 / 0.06);
		overflow: hidden;
	}

	/* Below about 700px the cards would shrink past reading size, so the drawing keeps its size
	and scrolls sideways instead. */
	.scroller {
		overflow-x: auto;
		padding: clamp(16px, 3vw, 28px);
		scrollbar-color: var(--stone-edge) transparent;
	}

	svg[role='img'] {
		display: block;
		width: 100%;
		min-width: 680px;
		height: auto;
		font-family: var(--sans);
	}

	.link {
		transition: opacity 220ms var(--ease-out);
	}

	.is-filtered .link:not(.is-lit) {
		opacity: 0.15;
	}

	.is-filtered path.link.is-lit {
		stroke-width: 4;
	}

	.union-label {
		font-size: 12px;
		font-weight: 600;
		fill: #8a5a14;
	}

	.name {
		font-size: 14px;
		font-weight: 700;
		fill: var(--stone-ink);
	}

	.dates {
		font-size: 12px;
		fill: var(--stone-text);
		font-variant-numeric: tabular-nums;
	}

	.note text {
		font-size: 12px;
		fill: var(--stone-text);
	}

	figcaption {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 16px;
		padding: 12px clamp(16px, 3vw, 28px) 16px;
		border-top: 1px solid var(--stone-rule);
		background: rgb(253 251 247 / 0.7);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.legend button {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		padding: 0 12px;
		border: 1px solid transparent;
		border-radius: 8px;
		background: transparent;
		color: var(--stone-strong);
		font: inherit;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
	}

	.legend button:hover {
		background: var(--stone-shelf);
	}

	.legend button[aria-pressed='true'] {
		background: var(--field-white);
		border-color: var(--stone-edge);
		color: var(--stone-ink);
	}

	.synthetic {
		margin-left: auto;
		font-size: 0.8125rem;
		font-style: italic;
		color: var(--stone-text);
	}
</style>
