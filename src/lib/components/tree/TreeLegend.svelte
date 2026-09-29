<script lang="ts">
	import { RELATIONSHIP_STYLES, MIXED_STYLE, SEX_SYMBOLS, DEATH_MARK, type LineStyle } from './tree-view.js';

	const lineStyles: LineStyle[] = [...Object.values(RELATIONSHIP_STYLES), MIXED_STYLE];
	const sexes = [
		{ name: 'Male', cls: 'm', symbol: SEX_SYMBOLS.M },
		{ name: 'Female', cls: 'f', symbol: SEX_SYMBOLS.F },
		{ name: 'Other', cls: 'u', symbol: SEX_SYMBOLS.X },
		{ name: 'Unknown', cls: 'u', symbol: SEX_SYMBOLS.neutral }
	];
</script>

<details class="legend">
	<summary>Legend</summary>

	<p class="heading">Sex</p>
	{#each sexes as sex (sex.cls)}
		<div class="row">
			<span class="chip {sex.cls}" aria-hidden="true">{sex.symbol}</span>
			<span>{sex.name}</span>
		</div>
	{/each}
	<div class="row">
		<span class="chip dagger" aria-hidden="true">{DEATH_MARK}</span>
		<span>Deceased (with dates)</span>
	</div>

	<p class="heading">Parent and child</p>
	{#each lineStyles as style (style.label)}
		<div class="row">
			<svg width="34" height="8" aria-hidden="true">
				<line
					x1="2"
					y1="4"
					x2="32"
					y2="4"
					stroke={`var(${style.colorVar})`}
					stroke-width="2"
					stroke-dasharray={style.dash ?? undefined}
					stroke-linecap={style.isRound ? 'round' : undefined}
				/>
			</svg>
			<span>{style.label}</span>
		</div>
	{/each}

	<p class="heading">Partnership</p>
	<div class="row">
		<svg width="34" height="8" aria-hidden="true">
			<line x1="2" y1="4" x2="32" y2="4" stroke="var(--partner-line)" stroke-width="2.25" />
		</svg>
		<span>Together</span>
	</div>
	<div class="row">
		<svg width="34" height="8" aria-hidden="true">
			<line x1="2" y1="4" x2="32" y2="4" stroke="var(--partner-line)" stroke-width="2.25" stroke-dasharray="7 5" />
		</svg>
		<span>Separated, divorced or ended</span>
	</div>
	<div class="row">
		<span class="chip stub" aria-hidden="true">+3</span>
		<span>More relatives; click to expand</span>
	</div>
</details>

<style>
	.legend {
		background: color-mix(in srgb, var(--tree-panel) 96%, transparent);
		border: 1px solid var(--tree-panel-border);
		border-radius: 12px;
		padding: 8px 12px;
		font-size: 11px;
		color: var(--tree-ink);
		box-shadow: 0 1px 4px rgb(0 0 0 / 0.12);
		max-height: 100%;
		overflow-y: auto;
	}
	summary {
		cursor: pointer;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-size: 10px;
		color: var(--tree-ink-muted);
	}
	.heading {
		margin: 8px 0 3px;
		font-weight: 700;
		color: var(--tree-ink-muted);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		line-height: 1.6;
	}
	.chip {
		display: inline-flex;
		width: 34px;
		height: 18px;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		border: 1.5px solid;
		font-size: 13px;
	}
	.chip.m {
		background: var(--sex-m);
		border-color: var(--sex-m-border);
	}
	.chip.f {
		background: var(--sex-f);
		border-color: var(--sex-f-border);
	}
	.chip.u {
		background: var(--sex-u);
		border-color: var(--sex-u-border);
	}
	.chip.dagger,
	.chip.stub {
		border-color: var(--tree-panel-border);
		background: var(--tree-panel);
		font-size: 12px;
	}
	.chip.stub {
		border-radius: 9px;
		font-weight: 600;
	}
</style>
