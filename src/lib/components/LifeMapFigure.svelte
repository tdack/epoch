<script lang="ts">
	// Ellen Marsh's life from the sample family, as the person page maps it: numbered stops in date
	// order joined by a line. The towns are real and at their real positions, drawn on a plain
	// graticule rather than OpenStreetMap's tiles, so the page fetches nothing from a map server.
	interface Stop {
		place: string;
		event: string;
		lat: number;
		lon: number;
		/** Which side of the marker the label sits, so no two labels meet. */
		side: 'left' | 'right';
	}
	const STOPS: Stop[] = [
		{ place: 'Whitby', event: 'Born about 1874', lat: 54.486, lon: -0.615, side: 'left' },
		{ place: 'York', event: 'Married 1898', lat: 53.958, lon: -1.08, side: 'right' },
		{ place: 'Leeds', event: 'Married 1907', lat: 53.8, lon: -1.549, side: 'right' },
		{ place: 'Harrogate', event: 'Died 1951', lat: 53.992, lon: -1.541, side: 'left' }
	];

	// An equirectangular projection narrowed by cos 54°, close enough across one county.
	const BOUNDS = { west: -2.3, east: -0.3, north: 54.62, south: 53.6 } as const;
	const SCALE = 340;
	const NARROW = Math.cos((54 * Math.PI) / 180);
	const W = Math.round((BOUNDS.east - BOUNDS.west) * NARROW * SCALE);
	const H = Math.round((BOUNDS.north - BOUNDS.south) * SCALE);
	const x = (lon: number) => (lon - BOUNDS.west) * NARROW * SCALE;
	const y = (lat: number) => (BOUNDS.north - lat) * SCALE;

	const LATS = [53.75, 54, 54.25, 54.5];
	const LONS = [-2, -1.5, -1, -0.5];
	const degrees = (value: number, positive: string, negative: string) =>
		`${Math.abs(value)}°${value >= 0 ? positive : negative}`;

	const stops = STOPS.map((stop, i) => ({ ...stop, n: i + 1, x: x(stop.lon), y: y(stop.lat) }));
	const route = stops
		.map((s, i) => `${i === 0 ? 'M' : 'L'}${s.x.toFixed(1)} ${s.y.toFixed(1)}`)
		.join('');
</script>

<figure class="life">
	<div class="frame">
		<svg viewBox="0 0 {W} {H}" role="img" aria-labelledby="life-caption">
			<g class="graticule">
				{#each LATS as lat (lat)}
					<line x1="0" x2={W} y1={y(lat)} y2={y(lat)} />
					<text x="8" y={y(lat) - 6}>{degrees(lat, 'N', 'S')}</text>
				{/each}
				{#each LONS as lon (lon)}
					<line y1="0" y2={H} x1={x(lon)} x2={x(lon)} />
					<text x={x(lon) + 6} y={H - 10}>{degrees(lon, 'E', 'W')}</text>
				{/each}
			</g>
			<path class="route" d={route} />
			{#each stops as stop (stop.n)}
				<g transform="translate({stop.x} {stop.y})">
					<circle r="13" class="stop" />
					<text class="n" y="4.5" text-anchor="middle">{stop.n}</text>
					<g
						class="label"
						transform="translate({stop.side === 'left' ? -22 : 22} 0)"
						text-anchor={stop.side === 'left' ? 'end' : 'start'}
					>
						<text class="place" y="-2">{stop.place}</text>
						<text class="event" y="15">{stop.event}</text>
					</g>
				</g>
			{/each}
		</svg>
	</div>
	<figcaption id="life-caption">
		Ellen Marsh from the sample family, as her page maps her life: born at Whitby about 1874,
		married at York in 1898 and at Leeds in 1907, and died at Harrogate in 1951. Drawn here on a
		plain grid; the app draws it over OpenStreetMap.
	</figcaption>
</figure>

<style>
	/* Capped, because the labels scale with the drawing: past this they outgrow the page's h3. */
	.life {
		max-width: 480px;
		width: 100%;
		justify-self: center;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.frame {
		border: 1px solid var(--stone-rule);
		border-radius: 16px;
		background: var(--tree-paper);
		overflow: hidden;
	}

	svg {
		display: block;
		width: 100%;
		height: auto;
		font-family: var(--sans);
	}

	.graticule line {
		stroke: var(--tree-dot);
		stroke-width: 1;
	}

	.graticule text {
		font-size: 11px;
		fill: var(--stone-text);
		font-variant-numeric: tabular-nums;
	}

	.route {
		fill: none;
		stroke: var(--emerald-800);
		stroke-width: 2.5;
		stroke-linejoin: round;
	}

	.stop {
		fill: var(--emerald-800);
		stroke: var(--tree-paper);
		stroke-width: 3;
	}

	.n {
		font-size: 13px;
		font-weight: 700;
		fill: var(--vellum);
	}

	.place {
		font-size: 16px;
		font-weight: 600;
		fill: var(--stone-ink);
	}

	.event {
		font-size: 13px;
		fill: var(--stone-strong);
		font-variant-numeric: tabular-nums;
	}

	/* A halo of the paper behind each label, so the route and the grid never cut through a word. */
	.label text {
		paint-order: stroke;
		stroke: var(--tree-paper);
		stroke-width: 5px;
		stroke-linejoin: round;
	}

	figcaption {
		font-size: var(--site-small);
		line-height: 1.55;
		color: var(--stone-text);
		max-width: 62ch;
	}
</style>
