import { ChevronsDown, ChevronsUp, Hourglass, Rainbow } from '@lucide/svelte';
import type { Component } from 'svelte';
import type { ChartStyle } from '#lib/shared/charts.js';

/** Each chart's icon draws its shape: up for ancestors, down for descendants, arcs for the fan. */
export const CHART_ICONS: Record<ChartStyle, Component> = {
	pedigree: ChevronsUp,
	fan: Rainbow,
	descendants: ChevronsDown,
	hourglass: Hourglass
};
