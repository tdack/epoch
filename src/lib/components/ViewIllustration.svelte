<script lang="ts">
	import type { View3d } from '#lib/site.js';

	interface Props {
		/** Which 3D view to suggest. */
		view: View3d['id'];
		/** False under reduced motion: the drawing is shown at rest. */
		isAnimated: boolean;
	}

	let { view, isAnimated }: Props = $props();

	// Ring geometry for the Rings view: one ellipse per generation, youngest at the top.
	const RINGS = [
		{ cy: 70, rx: 90, ry: 18, dur: '14s' },
		{ cy: 140, rx: 150, ry: 30, dur: '20s' },
		{ cy: 220, rx: 210, ry: 42, dur: '28s' }
	];
	const ellipse = (cy: number, rx: number, ry: number) =>
		`M${320 - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0`;
</script>

<!-- A drawing that suggests the view until a recording of the app replaces it; the panel says so. -->
<svg viewBox="0 0 640 300" aria-hidden="true" class="art">
	{#if view === 'rings'}
		<g fill="none" stroke="#6ee7b7" stroke-opacity="0.35" stroke-width="1.5">
			{#each RINGS as ring (ring.cy)}
				<path d={ellipse(ring.cy, ring.rx, ring.ry)} />
			{/each}
			<path d="M320 88V110M260 165L290 110M380 165L350 110" stroke-opacity="0.25" />
		</g>
		{#each RINGS as ring, r (ring.cy)}
			{#each Array.from({ length: r * 2 + 1 }, (_, i) => i) as i (i)}
				{@const share = i / (r * 2 + 1)}
				{@const fill = r === 0 ? '#fbbf24' : '#fffbeb'}
				{#if isAnimated}
					<circle r={r === 0 ? 7 : 5} {fill}>
						<animateMotion
							dur={ring.dur}
							repeatCount="indefinite"
							path={ellipse(ring.cy, ring.rx, ring.ry)}
							begin="-{(share * Number.parseFloat(ring.dur)).toFixed(2)}s"
						/>
					</circle>
				{:else}
					<circle
						r={r === 0 ? 7 : 5}
						{fill}
						cx={320 + ring.rx * Math.cos(Math.PI + share * 2 * Math.PI)}
						cy={ring.cy + ring.ry * Math.sin(Math.PI + share * 2 * Math.PI)}
					/>
				{/if}
			{/each}
		{/each}
	{:else if view === 'ball'}
		<circle cx="320" cy="150" r="128" fill="none" stroke="#a7f3d0" stroke-opacity="0.4" />
		<g fill="none" stroke="#6ee7b7" stroke-opacity="0.18">
			<ellipse cx="320" cy="70" rx="100" ry="14" />
			<ellipse cx="320" cy="120" rx="125" ry="18" />
			<ellipse cx="320" cy="180" rx="124" ry="18" />
			<ellipse cx="320" cy="232" rx="96" ry="13" />
		</g>
		<g class:drift={isAnimated}>
			<circle cx="300" cy="66" r="5" fill="#fffbeb" />
			<circle cx="342" cy="72" r="5" fill="#fffbeb" />
			<circle cx="236" cy="118" r="5" fill="#fffbeb" />
			<circle cx="318" cy="124" r="5" fill="#fffbeb" />
			<circle cx="404" cy="116" r="5" fill="#fffbeb" />
			<circle cx="212" cy="182" r="5" fill="#fffbeb" />
			<circle cx="292" cy="178" r="6" fill="#fbbf24" />
			<circle cx="386" cy="184" r="5" fill="#fffbeb" />
			<circle cx="430" cy="178" r="5" fill="#fffbeb" />
			<circle cx="276" cy="232" r="5" fill="#fffbeb" />
			<circle cx="360" cy="230" r="5" fill="#fffbeb" />
		</g>
		<ellipse cx="282" cy="96" rx="34" ry="14" fill="#fffbeb" fill-opacity="0.06" />
	{:else if view === 'ribbons'}
		<g fill="none" stroke-width="5" stroke-linecap="round" class:flow={isAnimated}>
			<path d="M60 40C200 40 240 150 320 150" stroke="#6ee7b7" stroke-opacity="0.7" />
			<path d="M580 40C440 40 400 150 320 150" stroke="#a7f3d0" stroke-opacity="0.7" />
			<path d="M320 150C360 190 380 260 520 270" stroke="#fffbeb" stroke-opacity="0.75" />
			<path d="M320 150C320 200 330 250 330 280" stroke="#fffbeb" stroke-opacity="0.75" />
			<path d="M320 150C280 190 260 260 120 270" stroke="#fffbeb" stroke-opacity="0.75" />
		</g>
		<circle cx="320" cy="150" r="22" fill="#fbbf24" fill-opacity="0.18" />
		<circle cx="320" cy="150" r="9" fill="#fbbf24" />
	{:else}
		<g fill="none" stroke="#6ee7b7" stroke-opacity="0.2">
			<circle cx="320" cy="150" r="34" />
			<circle cx="320" cy="150" r="96" />
			<circle cx="320" cy="150" r="132" />
		</g>
		<g class:spin={isAnimated} style="--period: 9s">
			<circle cx="286" cy="150" r="9" fill="#fffbeb" />
			<circle cx="354" cy="150" r="9" fill="#fffbeb" />
		</g>
		<g class:spin={isAnimated} style="--period: 26s">
			<circle cx="320" cy="54" r="6" fill="#fbbf24" />
			<circle cx="403" cy="198" r="6" fill="#fffbeb" />
			<circle cx="237" cy="198" r="6" fill="#fffbeb" />
		</g>
		<g class:spin={isAnimated} style="--period: 40s; --direction: reverse">
			<circle cx="452" cy="150" r="4" fill="#a7f3d0" />
			<circle cx="188" cy="150" r="4" fill="#a7f3d0" />
			<circle cx="320" cy="282" r="4" fill="#a7f3d0" />
		</g>
	{/if}
</svg>

<style>
	.art {
		display: block;
		width: 100%;
		height: 100%;
	}

	.spin {
		transform-origin: 320px 150px;
		animation: spin var(--period) linear infinite var(--direction, normal);
	}

	.drift {
		transform-origin: 320px 150px;
		animation: drift 9s ease-in-out infinite alternate;
	}

	.flow path {
		stroke-dasharray: 14 10;
		animation: flow 2.4s linear infinite;
	}

	@keyframes spin {
		to {
			rotate: 360deg;
		}
	}

	@keyframes drift {
		to {
			transform: scaleX(-1);
		}
	}

	@keyframes flow {
		to {
			stroke-dashoffset: -48;
		}
	}
</style>
